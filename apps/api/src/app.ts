// --------------------------------------------------------------
// Hono app 定义（无 server 启动逻辑）
// 拆出来单独 export 是为了让测试能 import 它调 app.request(...)，
// 而不启动一个真的 HTTP server
// --------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chaptersRoute } from "./routes/chapters.js";
import { chatRoute } from "./routes/chat.js";
import { coursesRoute } from "./routes/courses.js";
import { demoRoute } from "./routes/demo-sandbox.js";
import { personasRoute } from "./routes/personas.js";

export const app = new Hono();

// middleware：请求日志（学生能在终端看到每次请求）
app.use("*", logger());

// middleware：允许前端跨域访问
// 开发时 Vite 跑在 5173、API 跑在 3000，浏览器会拦这种跨域请求，除非后端明确 allow
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// 挂子路由
// 标签查询
app.get("/api/tags", (c) => {
  const TAG_DIMENSIONS = [
    { name: "诉求", label: "游戏诉求", values: [{ value: "竞技证明", label: "竞技证明" }, { value: "社交归属", label: "社交归属" }, { value: "放松逃避", label: "放松/逃避" }] },
    { name: "能力", label: "游戏能力", values: [{ value: "新手", label: "新手" }, { value: "进阶", label: "进阶" }, { value: "高手", label: "高手" }] },
    { name: "风格", label: "游戏风格", values: [{ value: "主动求战", label: "主动求战/刚枪" }, { value: "苟活避战", label: "苟活避战" }] },
    { name: "平台", label: "平台偏好", values: [{ value: "PC端", label: "PC端" }, { value: "主机端", label: "主机端" }, { value: "手游端", label: "手游端" }] },
    { name: "模式", label: "游戏模式", values: [{ value: "PVP为主", label: "PVP为主" }, { value: "PVE为主", label: "PVE为主" }, { value: "PVP+PVE", label: "PVP+PVE都玩" }] },
  ];
  return c.json({ dimensions: TAG_DIMENSIONS });
});

app.route("/api/personas", personasRoute);     // /api/personas, /api/personas/:id
app.route("/api/courses", coursesRoute);
app.route("/api/chapters", chaptersRoute);
app.route("/api/chat", chatRoute);
app.route("/api/demo", demoRoute);

// 全局错误兜底
app.onError((err, c) => {
  console.error("💥 服务端异常：", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, 404));
