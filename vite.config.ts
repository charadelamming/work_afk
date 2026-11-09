import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// Tauri 期望一个固定端口，失败时不要自动换端口
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      // 这些目录里是编译产物 / 测试临时文件，随时被写或被锁，
      // 一旦被 Vite 监听就会抛 EBUSY 让 dev server 崩掉，必须忽略
      ignored: [
        "**/src-tauri/**",
        "**/.*.tmpdir/**",
        "**/*.tmpdir/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/.check/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
});
