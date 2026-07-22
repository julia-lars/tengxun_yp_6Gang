// --------------------------------------------------------------
// apps/api 的 vitest 配置
// - node 环境
// - 单 fork：pglite 是全局单例，避免多 worker 抢
// - setup 里起 pglite + 通过 setTestDb 注入生产 db client
// --------------------------------------------------------------

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/routes/chapters.test.ts",
      "src/routes/demo-sandbox.test.ts",
    ],
    setupFiles: ["./test/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15_000,
    env: {
      DATABASE_URL: "postgres://ci@localhost/x",
      NODE_ENV: "test",
    },
  },
});
