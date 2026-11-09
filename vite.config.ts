import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "path";

const lucideEntryPath = path.resolve(
  __dirname,
  "node_modules/lucide-react/dist/esm/lucide-react.js",
);
const lucideEntry = readFileSync(lucideEntryPath, "utf8");
const lucideIconFiles = new Map<string, string>();
const lucideExportPattern =
  /export\s+\{([^}]+)\}\s+from\s+['"]\.\/icons\/([^'"]+)['"]/g;

for (const match of lucideEntry.matchAll(lucideExportPattern)) {
  for (const specifier of match[1].split(",")) {
    const exportName = specifier.trim().match(/^default\s+as\s+([\w$]+)$/)?.[1];
    if (exportName) {
      lucideIconFiles.set(exportName, match[2]);
    }
  }
}

function lucideDeepImports() {
  const importPattern =
    /import\s*\{([^}]+)\}\s*from\s*(['"])lucide-react\2\s*;?/g;

  return {
    name: "lucide-deep-imports",
    enforce: "pre" as const,
    transform(code: string) {
      if (!code.includes("lucide-react")) return null;

      let changed = false;
      const transformed = code.replace(
        importPattern,
        (_statement, bindings: string) => {
          const iconImports: string[] = [];
          const remainingImports: string[] = [];

          for (const rawSpecifier of bindings.split(",")) {
            const specifier = rawSpecifier.trim();
            const parsed = specifier.match(
              /^(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/,
            );
            const isTypeOnly = parsed?.[1] !== undefined;
            const importedName = parsed?.[2];
            const localName = parsed?.[3] ?? importedName;
            const iconFile = importedName
              ? lucideIconFiles.get(importedName)
              : undefined;

            if (!parsed || isTypeOnly || !iconFile || !localName) {
              remainingImports.push(specifier);
              continue;
            }

            iconImports.push(
              `import { default as ${localName} } from "lucide-react/dist/esm/icons/${iconFile}";`,
            );
          }

          if (iconImports.length === 0) return _statement;

          changed = true;
          if (remainingImports.length > 0) {
            iconImports.push(
              `import { ${remainingImports.join(", ")} } from "lucide-react";`,
            );
          }
          return iconImports.join("\n");
        },
      );

      return changed ? { code: transformed, map: null } : null;
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    lucideDeepImports(),
    react({
      babel: {
        plugins:
          command === "serve"
            ? [["babel-plugin-react-compiler", { target: "19" }]]
            : [],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // The browser E2E lifecycle harness sets this to stop Vite from firing a
    // full page reload when the Firestore emulator writes its debug log into
    // the project root mid-test (which wipes in-progress modal forms). Normal
    // `npm run dev` leaves this unset and keeps hot reload intact.
    hmr: process.env.E2E_NO_HMR ? false : undefined,
    // hmr:false alone does NOT stop chokidar's watcher from emitting a
    // full-reload when a NON-module file (firestore-debug.log, the E2E
    // screenshot/log artifacts under tmp/) changes in the project root. Ignore
    // those explicitly, but only for the throwaway E2E server, so a real dev
    // session still hot-reloads on any file change.
    watch: process.env.E2E_NO_HMR
      ? null
      : undefined,
  },
  build: {
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf") || id.includes("html2canvas")) {
              return "vendor-pdf";
            }
            if (id.includes("recharts") || id.includes("d3-")) {
              return "vendor-charts";
            }
            if (id.includes("firebase")) {
              return "vendor-firebase";
            }
            if (id.includes("@heroui") || id.includes("framer-motion")) {
              return "vendor-heroui";
            }
            if (id.includes("react-dom") || id.includes("react-router-dom") || id.includes("/react/")) {
              return "vendor-react";
            }
            if (id.includes("@tanstack")) {
              return "vendor-tanstack";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
          }
        },
      },
    },
  },
}));
