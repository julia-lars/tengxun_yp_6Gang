import { describe, expect, it } from "vitest";
import { normalizeTagSpec, tagSpecToFeatures, tagSpecToPrompt } from "./tag-spec.js";

// ---- 数据：种子画像 C1 的旧扁平格式 ----
const C1_FLAT = {
  "诉求": ["竞技证明", "策略掌控", "能力成长"],
  "能力": "高手",
  "风格": ["主动求战/刚枪", "情境切换", "个人能力取胜", "操作技巧对抗", "均可"],
  "平台": "PC",
  "模式": "PVP为主",
};

const C2_FLAT = {
  "诉求": ["社交归属", "团队协作"],
  "风格": ["灵活平衡", "情境切换", "团队协作取胜", "混合", "熟人开黑"],
  "平台": "多平台均衡",
  "模式": "PVP/PVE均衡",
};

const C3_FLAT = {
  "诉求": ["放松逃避"],
  "能力": "入门",
  "风格": ["苟活避战", "本能快速反应", "团队个人平衡", "混合", "均可"],
  "平台": "手机",
  "模式": "PVE为主",
};

// ---- normalizeTagSpec ----

describe("normalizeTagSpec", () => {
  it("v1 扁平格式（C1）→ v2 嵌套", () => {
    const t = normalizeTagSpec(C1_FLAT);
    expect(t.version).toBe(2);
    expect(t.needs).toEqual(["竞技证明", "策略掌控", "能力成长"]);
    expect(t.ability.level).toBe("高手");
    expect(t.ability.strengths).toEqual([]);
    expect(t.ability.weaknesses).toEqual([]);
    expect(t.style.combat).toBe("主动求战/刚枪");
    expect(t.style.decision).toBe("情境切换");
    expect(t.style.victory).toBe("个人能力取胜");
    expect(t.style.growth).toBe("操作技巧对抗");
    expect(t.style.social).toBe("均可");
    expect(t.platform.primary).toBe("PC");
    expect(t.platform.secondary).toBeNull();
    expect(t.mode.structure).toBe("PVP为主");
    expect(t.mode.submodes).toEqual({});
  });

  it("v1 扁平格式（C2，无能力等级）→ ability.level 为 null", () => {
    const t = normalizeTagSpec(C2_FLAT);
    expect(t.ability.level).toBeNull();
    expect(t.needs).toEqual(["社交归属", "团队协作"]);
    expect(t.style.combat).toBe("灵活平衡");
    expect(t.style.victory).toBe("团队协作取胜");
  });

  it("v1 扁平格式（C3）→ 正确映射", () => {
    const t = normalizeTagSpec(C3_FLAT);
    expect(t.ability.level).toBe("入门");
    expect(t.style.combat).toBe("苟活避战");
    expect(t.platform.primary).toBe("手机");
    expect(t.mode.structure).toBe("PVE为主");
  });

  it("v2 嵌套格式原样通过", () => {
    const v2 = {
      version: 2 as const,
      needs: ["放松逃避"],
      ability: { level: "入门", strengths: ["枪法"], weaknesses: [] },
      style: { combat: null, decision: null, victory: null, growth: null, social: null },
      platform: { primary: "手机", secondary: null },
      mode: { structure: "PVE为主", submodes: {} },
    };
    const t = normalizeTagSpec(v2);
    expect(t.ability.level).toBe("入门");
    expect(t.ability.strengths).toEqual(["枪法"]);
    expect(t.platform.primary).toBe("手机");
  });

  it("v2 嵌套格式（缺失字段）→ 用默认值补齐", () => {
    const t = normalizeTagSpec({ version: 2, needs: ["竞技证明"] });
    expect(t.version).toBe(2);
    expect(t.needs).toEqual(["竞技证明"]);
    expect(t.ability.level).toBeNull();
    expect(t.style.combat).toBeNull();
    expect(t.platform.primary).toBeNull();
  });

  it("null 输入 → 全默认", () => {
    const t = normalizeTagSpec(null);
    expect(t.version).toBe(2);
    expect(t.needs).toEqual([]);
    expect(t.ability.level).toBeNull();
    expect(t.style.combat).toBeNull();
    expect(t.platform.primary).toBeNull();
  });

  it("undefined / 空对象 → 全默认", () => {
    const t1 = normalizeTagSpec(undefined);
    expect(t1.needs).toEqual([]);
    const t2 = normalizeTagSpec({});
    expect(t2.needs).toEqual([]);
  });

  it("chat fallback 格式（扁平但有部分新字段名）→ 兼容", () => {
    const t = normalizeTagSpec({
      诉求: ["竞技证明"],
      能力: "进阶",
      风格: ["主动求战刚枪"],
      平台: "PC端",
      模式: "PVP为主",
    });
    expect(t.ability.level).toBe("进阶");
    expect(t.platform.primary).toBe("PC端");
    // 风格值 "主动求战刚枪" 不在轴值域中，不映射到任何轴
    expect(t.style.combat).toBeNull();
  });
});

// ---- tagSpecToPrompt ----

describe("tagSpecToPrompt", () => {
  it("C1 画像 → 自然语言包含关键信息", () => {
    const prompt = tagSpecToPrompt(normalizeTagSpec(C1_FLAT));
    expect(prompt).toContain("高手水平");
    expect(prompt).toContain("PC");
    expect(prompt).toContain("PVP为主");
    expect(prompt).toContain("竞技证明");
    expect(prompt).toContain("策略掌控");
    expect(prompt).toContain("能力成长");
    expect(prompt).toContain("战斗倾向");
    expect(prompt).toContain("主动求战/刚枪");
  });

  it("C2 画像（无能力等级）→ 不包含水平描述", () => {
    const prompt = tagSpecToPrompt(normalizeTagSpec(C2_FLAT));
    expect(prompt).not.toContain("水平");
    expect(prompt).toContain("社交归属");
    expect(prompt).toContain("团队协作");
    expect(prompt).toContain("多平台均衡");
  });

  it("空画像 → 空字符串", () => {
    expect(tagSpecToPrompt(normalizeTagSpec(null))).toBe("");
  });

  it("仅平台 → 只有身份行", () => {
    const t = normalizeTagSpec({ 平台: "PC" });
    const prompt = tagSpecToPrompt(t);
    expect(prompt).toContain("PC");
    expect(prompt).not.toContain("诉求");
    expect(prompt).not.toContain("风格");
  });
});

// ---- tagSpecToFeatures ----

describe("tagSpecToFeatures", () => {
  it("C1 画像 → 特征向量", () => {
    const f = tagSpecToFeatures(normalizeTagSpec(C1_FLAT));
    expect(f["need:竞技证明"]).toBe(1);
    expect(f["need:策略掌控"]).toBe(1);
    expect(f["need:能力成长"]).toBe(1);
    expect(f["ability.level"]).toBe("高手");
    expect(f["style.combat"]).toBe("主动求战/刚枪");
    expect(f["style.decision"]).toBe("情境切换");
    expect(f["platform.primary"]).toBe("PC");
    expect(f["mode.structure"]).toBe("PVP为主");
  });

  it("空画像 → 空特征", () => {
    const f = tagSpecToFeatures(normalizeTagSpec(null));
    expect(Object.keys(f).length).toBe(0);
  });
});