import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/PWA-AI-Meeting-Memo-BYOK/",
  define: {
    __BUILD_ID__: JSON.stringify(
      process.env.VITE_BUILD_ID || `local-${Date.now()}`,
    ),
  },
  build: { target: "es2022", sourcemap: false },
});
