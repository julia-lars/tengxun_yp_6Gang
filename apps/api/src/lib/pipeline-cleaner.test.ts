/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import {
  isNoise,
  isConversationFlow,
  normalizeText,
  trigramSimilarity,
  cleanSegments,
  dedupSegments,
  getCleaningStats,
  type CleanedSegment,
} from "./pipeline-cleaner.js";
import type { RawSegment } from "./file-parser.js";

function makeSegment(
  originalText: string,
  speakerId = "speaker_1",
  precedingQuestion: string | null = null,
): RawSegment {
  return {
    sourceFile: "test.json",
    segmentIndex: 1,
    speakerId,
    speakerRole: "interviewee",
    precedingQuestion,
    originalText,
  };
}

// ---- isNoise 测试 ----

describe("isNoise", () => {
  it("识别中文噪声", () => {
    expect(isNoise("嗯")).toBe(true);
    expect(isNoise("对")).toBe(true);
    expect(isNoise("好的好的")).toBe(true);
    expect(isNoise("可以")).toBe(true);
    expect(isNoise("不行")).toBe(true);
    expect(isNoise("啊")).toBe(true);
    expect(isNoise("哦")).toBe(true);
  });

  it("识别英文噪声", () => {
    expect(isNoise("Yeah")).toBe(true);
    expect(isNoise("Cool")).toBe(true);
    expect(isNoise("Okay")).toBe(true);
    expect(isNoise("Yes")).toBe(true);
    expect(isNoise("No")).toBe(true);
    expect(isNoise("Sure")).toBe(true);
    expect(isNoise("Thanks")).toBe(true);
    expect(isNoise("Mmm")).toBe(true);
    expect(isNoise("Mhmm")).toBe(true);
  });

  it("不误判正常文本", () => {
    expect(isNoise("我觉得这个游戏非常好玩，射击手感很爽")).toBe(false);
    expect(isNoise("I really enjoy playing this game with friends")).toBe(false);
    expect(isNoise("排位赛的匹配机制需要改进")).toBe(false);
  });
});

// ---- isConversationFlow 测试 ----

describe("isConversationFlow", () => {
  it("识别对话流程内容", () => {
    expect(isConversationFlow("I'll start.")).toBe(true);
    expect(isConversationFlow("Go ahead.")).toBe(true);
    expect(isConversationFlow("Sorry.")).toBe(true);
    expect(isConversationFlow("Thank you.")).toBe(true);
    expect(isConversationFlow("That's great.")).toBe(true);
    expect(isConversationFlow("All right.")).toBe(true);
  });

  it("不误判正常文本", () => {
    expect(isConversationFlow("The game is great and I love the mechanics")).toBe(false);
    expect(isConversationFlow("游戏很好玩")).toBe(false);
  });
});

// ---- normalizeText 测试 ----

describe("normalizeText", () => {
  it("合并多余空格", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
    expect(normalizeText("hello    world   test")).toBe("hello world test");
  });

  it("去除首尾空白", () => {
    expect(normalizeText("  hello world  ")).toBe("hello world");
  });
});

// ---- trigramSimilarity 测试 ----

describe("trigramSimilarity", () => {
  it("相同文本返回 1", () => {
    expect(trigramSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("完全不同文本返回 0", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });

  it("相似文本返回高相似度", () => {
    const sim = trigramSimilarity(
      "I really enjoy playing Apex Legends with my friends",
      "I really enjoy playing Apex Legends with friends",
    );
    expect(sim).toBeGreaterThan(0.8);
  });

  it("空文本处理", () => {
    expect(trigramSimilarity("", "")).toBe(1.0);
    expect(trigramSimilarity("hello", "")).toBe(0);
  });
});

// ---- cleanSegments 测试 ----

describe("cleanSegments", () => {
  it("过滤噪声片段", () => {
    const segments = [
      makeSegment("嗯"),
      makeSegment("我觉得这个游戏手感非常好，画面也很精美"),
      makeSegment("Yeah"),
    ];
    const result = cleanSegments(segments);
    expect(result).toHaveLength(1);
    expect(result[0]!.originalText).toBe("我觉得这个游戏手感非常好，画面也很精美");
  });

  it("过滤过短片段 (< 15 字符)", () => {
    const segments = [
      makeSegment("太短了"),
      makeSegment("这个片段足够长，包含了有意义的游戏讨论内容"),
    ];
    const result = cleanSegments(segments);
    expect(result).toHaveLength(1);
    expect(result[0]!.originalText).toBe("这个片段足够长，包含了有意义的游戏讨论内容");
  });

  it("过滤对话流程内容", () => {
    const segments = [
      makeSegment("I'll start."),
      makeSegment("Let me tell you about my gaming experience"),
    ];
    const result = cleanSegments(segments);
    expect(result).toHaveLength(1);
  });

  it("设置 cleanedText 和 charCount", () => {
    const segments = [makeSegment("  这个游戏手感很好，我非常喜欢玩  ")];
    const result = cleanSegments(segments);
    expect(result).toHaveLength(1);
    expect(result[0]!.cleanedText).toBe("这个游戏手感很好，我非常喜欢玩");
    expect(result[0]!.charCount).toBeGreaterThan(0);
  });

  it("去重相似片段", () => {
    const segments = [
      makeSegment(
        "I really enjoy playing Apex Legends with my friends on weekends",
        "speaker_1",
        "What games do you play?",
      ),
      makeSegment(
        "I really enjoy playing Apex Legends with friends on weekends",
        "speaker_1",
        "What games do you play?",
      ),
    ];
    const result = cleanSegments(segments);
    // 高相似度 (>90%) 的片段应被去重
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ---- dedupSegments 测试 ----

describe("dedupSegments", () => {
  function makeCleaned(originalText: string, speakerId = "s1", precedingQuestion: string | null = null): CleanedSegment {
    return {
      sourceFile: "test.json",
      segmentIndex: 1,
      speakerId,
      speakerRole: "interviewee",
      precedingQuestion,
      originalText,
      cleanedText: originalText.trim(),
      charCount: originalText.trim().length,
    };
  }

  it("不同 speaker 的相同文本不去重", () => {
    const segments = [
      makeCleaned("I love this game", "speaker_1"),
      makeCleaned("I love this game", "speaker_2"),
    ];
    const result = dedupSegments(segments);
    expect(result).toHaveLength(2);
  });

  it("不同 preceding_question 的相同文本不去重", () => {
    const segments = [
      makeCleaned("I love this game", "speaker_1", "What do you think?"),
      makeCleaned("I love this game", "speaker_1", "Anything else?"),
    ];
    const result = dedupSegments(segments);
    expect(result).toHaveLength(2);
  });
});

// ---- getCleaningStats 测试 ----

describe("getCleaningStats", () => {
  it("计算正确的清洗统计", () => {
    const stats = getCleaningStats(100, 85);
    expect(stats.removed).toBe(15);
    expect(stats.kept).toBe(85);
    expect(stats.removalRate).toBe(15);
  });

  it("处理空输入", () => {
    const stats = getCleaningStats(0, 0);
    expect(stats.removed).toBe(0);
    expect(stats.kept).toBe(0);
    expect(stats.removalRate).toBe(0);
  });
});