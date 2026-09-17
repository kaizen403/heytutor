import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { seoPlugin } from "./vite-plugin-seo.ts";

export default defineConfig({
  plugins: [react(), seoPlugin()],
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
