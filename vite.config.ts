import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
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
});
