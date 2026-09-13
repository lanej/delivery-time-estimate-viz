import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          map: ["./src/data/oakland.json"],
          three: ["three"],
          d3: ["d3"],
        },
      },
    },
  },
});
