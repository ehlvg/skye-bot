import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2020",
    cssMinify: "lightningcss",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep names short — they're cached behind the panel's auth gate.
        entryFileNames: "assets/app.[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
