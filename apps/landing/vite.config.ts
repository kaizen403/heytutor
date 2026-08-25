import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
