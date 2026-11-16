import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repositoryRoot, "catalogue"),
  base: "./",
  plugins: [react()],
  publicDir: false,
  server: { host: "127.0.0.1", port: 4183, strictPort: true },
  preview: { host: "127.0.0.1", port: 4183, strictPort: true },
  build: {
    outDir: path.join(repositoryRoot, "private-fixtures", "catalogue-dist"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.join(repositoryRoot, "catalogue", "index.html") },
  },
});
