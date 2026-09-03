// --------------------------------------------------------------
// lib/utils.ts 的 cn 测试
// - clsx 语法 + tailwind-merge 冲突去重
// --------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cn, computePersonaConfidence } from "./utils.js";

describe("cn", () => {
  it("多个字符串合并", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("过滤 falsy 值", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("条件类名", () => {
    const active = true;
    expect(cn("base", active && "active")).toBe("base active");
  });

  it("tailwind 冲突后者覆盖前者", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("接受数组", () => {
    expect(cn(["a", "b"])).toBe("a b");
  });

  it("接受对象条件", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("空调用返回空串", () => {
    expect(cn()).toBe("");
  });
});

describe("computePersonaConfidence", () => {
  it("大样本 + 完整标签 + 动机链 → 高分", () => {
    const score = computePersonaConfidence({
      sampleCount: 150,
      evidenceCount: 30,
      tagSpec: { 诉求: "竞技", 能力: "高级", 风格: ["激进"], 平台: "移动端", 模式: "单排" },
      motivationChain: { causal_paths: ["M1:achievement→M5:deliberate_practice"] },
    });
    // 样本 ~1.0, 证据 1.0, 标签 1.0, 动机 +0.10 → 0.95
    expect(score).toBeGreaterThanOrEqual(0.85);
    expect(score).toBeLessThanOrEqual(0.95);
  });

  it("中等样本 + 部分标签 + 无动机链 → 中等分", () => {
    const score = computePersonaConfidence({
      sampleCount: 30,
      evidenceCount: 5,
      tagSpec: { 诉求: "社交", 能力: "中级", 平台: "PC" },
      motivationChain: null,
    });
    // 样本 ~0.67, 证据 0.33, 标签 0.6, 动机 0 → ~0.52
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(score).toBeLessThanOrEqual(0.65);
  });

  it("小样本 + 少标签 → 低分", () => {
    const score = computePersonaConfidence({
      sampleCount: 5,
      evidenceCount: 1,
      tagSpec: { 诉求: "休闲" },
      motivationChain: null,
    });
    // 样本 ~0.39, 证据 0.07, 标签 0.2, 动机 0 → ~0.25
    expect(score).toBeGreaterThanOrEqual(0.1);
    expect(score).toBeLessThanOrEqual(0.45);
  });

  it("样本为 0 → 最低分边界", () => {
    const score = computePersonaConfidence({
      sampleCount: 0,
      evidenceCount: 0,
      tagSpec: {},
      motivationChain: null,
    });
    // 样本 0, 证据 0, 标签 0, 动机 0 → 0, 但会被 clamp 到 0.10
    expect(score).toBe(0.1);
  });

  it("所有维度满分 → 封顶 0.95", () => {
    const score = computePersonaConfidence({
      sampleCount: 500,
      evidenceCount: 100,
      tagSpec: { 诉求: "竞技", 能力: "高级", 风格: ["激进"], 平台: "移动端", 模式: "单排" },
      motivationChain: { causal_paths: ["M1:achievement"] },
    });
    expect(score).toBe(0.95);
  });

  it("不同样本量产生不同分数", () => {
    const base = { evidenceCount: 10, tagSpec: { 诉求: "竞技", 能力: "高级", 风格: ["激进"], 平台: "移动端", 模式: "单排" }, motivationChain: null as Record<string, unknown> | null };
    const s10 = computePersonaConfidence({ ...base, sampleCount: 10 });
    const s50 = computePersonaConfidence({ ...base, sampleCount: 50 });
    const s200 = computePersonaConfidence({ ...base, sampleCount: 200 });
    // 样本量越大分数越高
    expect(s10).toBeLessThan(s50);
    expect(s50).toBeLessThan(s200);
  });
});
