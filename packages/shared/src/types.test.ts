import { describe, expect, it } from "vitest";
import { chatRequestSchema, personaSummarySchema } from "./types.js";

describe("personaSummarySchema", () => {
  it("合法画像", () => {
    expect(personaSummarySchema.safeParse({
      id: 1, name: "测试", description: "描述",
      tagSpec: { "诉求": ["竞技证明"] }, sampleCount: 10, createdAt: "2024-01-01T00:00:00.000Z",
    }).success).toBe(true);
  });
  it("缺少必填字段不通过", () => {
    expect(personaSummarySchema.safeParse({ id: 1 }).success).toBe(false);
  });
});

describe("chatRequestSchema", () => {
  it("合法请求", () => {
    expect(chatRequestSchema.safeParse({ personaId: 1, message: "你好" }).success).toBe(true);
  });
  it("空消息不通过", () => {
    expect(chatRequestSchema.safeParse({ personaId: 1, message: "" }).success).toBe(false);
  });
  it("超长消息不通过", () => {
    expect(chatRequestSchema.safeParse({ personaId: 1, message: "x".repeat(2001) }).success).toBe(false);
  });
});
