// --------------------------------------------------------------
// apps/web 的 vitest 配置
// - jsdom 环境（React 组件需要 DOM）
// - 复用 vite.config.ts 的 alias（@/* → src/*）
// - setup 里 stub 掉 jsdom 缺失的 API
// --------------------------------------------------------------

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [
      "src/components/demos/**",
      "src/components/Sidebar.test.tsx",
      "src/components/TableOfContents.test.tsx",
      "src/lib/toc.test.ts",
    ],
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
