/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("流水线 API", () => {
  // ---- 基础端点测试 ----

  it("启动作业返回 jobId 和 status", async () => {
    const r = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "personas",
        fileNames: ["test.json"],
        enableClustering: false,
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { jobId: string; status: unknown };
    expect(body).toHaveProperty("jobId");
    expect(body.jobId).toMatch(/^pipeline-/);
    expect(body).toHaveProperty("status");
  });

  it("查询不存在的作业返回 404", async () => {
    const r = await app.request("/api/pipeline/status/unknown-job");
    expect(r.status).toBe(404);
  });

  it("查询已启动的作业返回状态", async () => {
    // 启动作业
    const startR = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "personas",
        fileNames: ["test.json"],
        enableClustering: false,
      }),
    });
    const { jobId } = (await startR.json()) as { jobId: string };

    // 查询状态
    const statusR = await app.request(`/api/pipeline/status/${jobId}`);
    expect(statusR.status).toBe(200);
    const status = (await statusR.json()) as Record<string, unknown>;
    expect(status).toHaveProperty("stage");
    expect(status).toHaveProperty("progress");
    expect(status).toHaveProperty("stats");
    expect(status).toHaveProperty("startedAt");
  });

  it("启动作业时文件名为空处理", async () => {
    const r = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "personas",
        enableClustering: false,
      }),
    });
    // 即使没有 fileNames 也应该能启动（fileNames 现在是 optional）
    expect(r.status).toBe(200);
    const body = (await r.json()) as { jobId: string };
    expect(body).toHaveProperty("jobId");
  });

  it("启动作业时启用聚类", async () => {
    const r = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "personas",
        fileNames: ["test.json"],
        enableClustering: true,
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { jobId: string };
    expect(body).toHaveProperty("jobId");
  });

  it("KOL 目标启动作业", async () => {
    const r = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "kol",
        kolId: 1,
        fileNames: ["test.json"],
        enableClustering: false,
        enableKol: true,
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { jobId: string };
    expect(body).toHaveProperty("jobId");
  });

  it("拒绝无效的 target", async () => {
    const r = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "invalid",
        fileNames: ["test.json"],
      }),
    });
    // Zod 验证应该拒绝
    expect(r.status).toBe(400);
  });

  it("作业状态中的 stats 包含所有字段", async () => {
    const startR = await app.request("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "personas",
        fileNames: ["test.json"],
        enableClustering: false,
      }),
    });
    const { jobId } = (await startR.json()) as { jobId: string };

    const statusR = await app.request(`/api/pipeline/status/${jobId}`);
    const status = (await statusR.json()) as Record<string, unknown>;
    const stats = status.stats as Record<string, unknown>;

    expect(stats).toHaveProperty("filesTotal");
    expect(stats).toHaveProperty("filesProcessed");
    expect(stats).toHaveProperty("segmentsExtracted");
    expect(stats).toHaveProperty("segmentsCleaned");
    expect(stats).toHaveProperty("segmentsTagged");
    expect(stats).toHaveProperty("segmentsEmbedded");
    expect(stats).toHaveProperty("errors");
    expect(Array.isArray(stats.errors)).toBe(true);
  });
});