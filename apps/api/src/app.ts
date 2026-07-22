// Hono app — AI 模拟用户系统 API
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chatRoute } from "./routes/chat.js";
import { personasRoute } from "./routes/personas.js";

export const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: (origin) => origin ?? "*", credentials: true }));

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// 标签维度
app.get("/api/tags", (c) => {
  const dims = [
    { name: "诉求", label: "游戏诉求", values: [{ value: "竞技证明", label: "竞技证明" }, { value: "社交归属", label: "社交归属" }, { value: "放松逃避", label: "放松/逃避" }, { value: "探索收集", label: "探索/收集" }] },
    { name: "能力", label: "游戏能力", values: [{ value: "新手", label: "新手" }, { value: "进阶", label: "进阶" }, { value: "高手", label: "高手" }] },
    { name: "风格", label: "游戏风格", values: [{ value: "主动求战", label: "主动求战/刚枪" }, { value: "苟活避战", label: "苟活避战" }, { value: "团队协作", label: "团队协作" }, { value: "个人能力", label: "个人能力" }] },
    { name: "平台", label: "平台偏好", values: [{ value: "PC端", label: "PC端" }, { value: "主机端", label: "主机端" }, { value: "手游端", label: "手游端" }] },
    { name: "模式", label: "游戏模式", values: [{ value: "PVP为主", label: "PVP为主" }, { value: "PVE为主", label: "PVE为主" }, { value: "PVP+PVE", label: "PVP+PVE都玩" }] },
  ];
  return c.json({ dimensions: dims });
});

app.route("/api/personas", personasRoute);
app.route("/api/chat", chatRoute);

app.onError((err, c) => { console.error("服务端异常:", err); return c.json({ error: "Internal Server Error" }, 500); });
app.notFound((c) => c.json({ error: "Not Found", path: c.req.path }, 404));
