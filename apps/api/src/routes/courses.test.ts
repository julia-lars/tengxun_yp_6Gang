import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("API 基础", () => {
  it("健康检查", async () => {
    const r = await app.request("/api/health");
    expect(r.status).toBe(200);
  });
  it("标签接口", async () => {
    const r = await app.request("/api/tags");
    expect(r.status).toBe(200);
    const body = await r.json() as { dimensions: unknown };
    expect(body).toHaveProperty("dimensions");
  });
  it("404 路由", async () => {
    const r = await app.request("/api/not-found");
    expect(r.status).toBe(404);
  });
});
