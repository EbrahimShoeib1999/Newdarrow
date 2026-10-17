import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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
