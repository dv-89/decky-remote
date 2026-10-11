import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ root: fileURLToPath(new URL(".", import.meta.url)), resolve: { alias: { "@decky/api": fileURLToPath(new URL("api.ts", import.meta.url)), "@decky/ui": fileURLToPath(new URL("ui.tsx", import.meta.url)) } }, server: { host: "127.0.0.1", port: 8767, strictPort: true } });
