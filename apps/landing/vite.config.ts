import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { seoPlugin } from "./vite-plugin-seo.ts";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), seoPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../tutor/', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        record: "record.html",
      },
    },
  },
  server: {
    port: 5173,
  },
});
