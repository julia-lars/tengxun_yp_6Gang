// --------------------------------------------------------------
// Boundary Engine Test Suite — V0.3 游戏相关性边界检测
//
// 测试原则:
//   "相关性决定是否进入，证据决定能否可靠回答"
//
// Boundary Engine 只负责判断问题是否属于射击游戏领域。
// 不负责：证据充分性、数据库覆盖度、回答置信度。
//
// 7 大测试类别:
//   A. Clear Game IN — 明确游戏相关，必须 IN
//   B. Game-related / Evidence-uncertain IN — 游戏相关但证据可能不足，仍应 IN
//   C. Clear Non-game OUT — 明确非游戏领域，必须 OUT
//   D. Cross-game Boundary — 游戏领域之间的边界
//   E. Ambiguous / Context-dependent — 模糊问题，依赖上下文
//   F. Boundary Flip — 边界翻转测试
//   G. Implicit Game Context — 隐式游戏语境
//
// 注意: 基于关键词的边界引擎有固有局限。对于真正模糊的问题，
// 默认策略是偏宽松（IN 或 AMBIGUOUS），由下游 Evidence Chain 过滤。
// --------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { checkBoundary } from "./boundary-engine.js";

// 测试辅助函数：跳过缓存，直接测试规则
async function testQuery(query: string, context?: string) {
  const result = await checkBoundary(query, { skipCache: true, context });
  return {
    final: result.final,
    method: result.method,
    domain: result.B1_domain,
  };
}

// ============================================================================
// A. 明确游戏相关 —— 必须 IN
// ============================================================================

describe("A. Clear Game IN", () => {
  const cases = [
    "CS2 里面 AK 好用吗？",
    "AK 和 M4 哪个更适合新手？",
    "你喜欢什么射击游戏？",
    "你喜欢什么游戏？",
    "你平时玩 FPS 吗？",
    "你最喜欢哪张地图？",
    "你平时多久打一次 FPS？",
    "你一般喜欢玩什么模式？",
    "你喜欢单排还是组队？",
    "为什么很多人喜欢玩 CS2？",
    "AWP 的手感怎么样？",
    "你觉得 AK 后坐力大吗？",
    "新手应该怎么玩 FPS？",
    "你玩游戏的时候喜欢听脚步吗？",
    "你更喜欢进攻还是防守？",
    "你觉得排位好玩吗？",
    "CS2 AK 使用率是多少？",
    "CS2 下一版本会有什么变化？",
    "AK 和 M4 哪个更好用？",
    "PUBG 和 Apex 哪个更好玩？",
    "守望先锋现在环境怎么样？",
    "你为什么喜欢玩永劫无间？",
    "永劫无间怎么连招？",
    // 纯社交问候（对话入口放行）
    "你好",
    "早",
    "早上好",
    "晚上好",
    "晚安",
    "嗨",
    "哈喽",
    "Hello",
    "Hi",
  ];

  for (const q of cases) {
    it(`IN: ${q}`, async () => {
      const result = await testQuery(q);
      expect(result.final).toBe("IN");
    });
  }
});

// ============================================================================
// B. 游戏相关但"证据可能不足"——仍然 IN
// ============================================================================

describe("B. Game-related / Evidence-uncertain IN", () => {
  const cases = [
    "CS2 玩家为什么喜欢 AK？",
    "为什么玩家喜欢 Dust2？",
    "玩家为什么喜欢 FPS？",
    "下一版本 AK 会不会削弱？",
    "下个赛季什么枪会成为主流？",
    "CS2 玩家为什么喜欢竞技模式？",
    "职业玩家为什么更喜欢 AWP？",
    "玩 FPS 的人是不是反应更快？",
    "喜欢单排的人是不是更独立？",
    "为什么年轻玩家喜欢 FPS？",
    "CS2 玩家和 Valorant 玩家在武器偏好上有什么不同？",
    "三角洲行动会不会取代 CS2？",
    "CS2 玩家为什么喜欢 AK？",
    "为什么玩家喜欢 FPS？",
    "CS2 下一版本 AK 会不会削弱？",
    "CS2 玩家为什么喜欢竞技模式？",
    "职业玩家为什么更喜欢 AWP？",
    "玩 FPS 的人是不是反应更快？",
    "喜欢单排的人是不是更独立？",
    "为什么年轻玩家喜欢 FPS？",
  ];

  for (const q of cases) {
    it(`IN (evidence-uncertain): ${q}`, async () => {
      // 即使数据库没有这些问题的证据，Boundary 仍然应该是 IN
      const result = await testQuery(q);
      expect(result.final).toBe("IN");
    });
  }
});

// ============================================================================
// C. 明确非游戏领域 —— 必须 OUT
// ============================================================================

describe("C. Clear Non-game OUT", () => {
  const cases = [
    "今天天气怎么样？",
    "明天会不会下雨？",
    "苹果股票现在多少钱？",
    "帮我写 Python 程序",
    "帮我翻译这句话",
    "推荐一家餐厅",
    "NBA 谁最强？",
    "英超谁会夺冠？",
    "怎么做红烧肉？",
    "帮我写一封求职邮件",
    "推荐一只股票",
    "帮我写一个排序算法",
    "天气预报是什么？",
    "苹果和微软哪个股票更值得买？",
    "iPhone 下一版本会有什么变化？",
    "为什么年轻人喜欢喝咖啡？",
    "这台相机的手感怎么样？",
    "高考怎么上分？",
    "你喜欢打麻将吗？",
    "新手应该怎么练字？",
    "你喜欢吃什么？",
    "你喜欢喝什么？",
    "你平时喜欢点什么外卖？",
    "睡了吗？",
    "在吗？",
    "吃了吗？",
  ];

  for (const q of cases) {
    it(`OUT: ${q}`, async () => {
      const result = await testQuery(q);
      expect(result.final).toBe("OUT");
    });
  }
});

// ============================================================================
// D. 游戏领域之间的边界
// ============================================================================

describe("D. Cross-game Boundary", () => {
  describe("D1. Other games → OUT", () => {
    const cases = [
      // MOBA
      "王者荣耀哪个英雄最强？",
      "LOL 哪个英雄适合上分？",
      "DOTA2 怎么玩？",
      // 二游 / 开放世界
      "原神哪个角色最好用？",
      "崩坏星穹铁道哪个角色值得抽？",
      "绝区零怎么配队？",
      "鸣潮哪个角色强？",
      "幻塔怎么玩？",
      "明日方舟什么干员最强？",
      "碧蓝航线哪个船好用？",
      "蔚蓝档案怎么抽卡？",
      "少女前线怎么配队？",
      "赛马娘怎么养马？",
      "战双帕弥什什么角色好？",
      "重返未来1999怎么玩？",
      "无期迷途什么阵容好？",
      "阴阳师怎么配阵容？",
      // 乙女
      "恋与制作人哪个男主好？",
      "光与夜之恋怎么玩？",
      // MMORPG
      "魔兽世界什么职业最强？",
      "剑网三什么门派好玩？",
      "FF14 怎么练级？",
      "逆水寒怎么样？",
      // 沙盒 / 生存
      "Minecraft 怎么建房子？",
      "星露谷物语怎么种地？",
      "动物森友会怎么玩？",
      // 格斗 / 动作
      "鬼泣哪个角色最强？",
      "怪物猎人用什么武器好？",
      "塞尔达怎么过神庙？",
      "宝可梦什么精灵最强？",
      // 策略 / 卡牌
      "炉石传说什么卡组强？",
      "云顶之弈什么阵容好？",
      "三国杀怎么玩？",
      // 载具战斗
      "坦克世界哪个坦克好用？",
      "战舰世界怎么玩？",
      // 体育 / 竞速
      "FIFA 怎么玩？",
      "NBA2K 怎么投篮？",
      // 社交 / 派对
      "狼人杀怎么玩？",
      "第五人格什么角色强？",
      "蛋仔派对怎么玩？",
      // 二游泛称
      "最近有什么好玩的二游？",
      "二次元游戏推荐一下？",
      // 游戏类型泛称
      "格斗游戏有什么推荐？",
      "音游哪个好玩？",
      "养成游戏推荐一下？",
    ];

    for (const q of cases) {
      it(`OUT (other game): ${q}`, async () => {
        const result = await testQuery(q);
        expect(result.final).toBe("OUT");
      });
    }
  });

  describe("D2. Cross-game with shooting reference → IN", () => {
    const cases = [
      "CS2 和 Valorant 哪个更好玩？",
      "FPS 和 MOBA 有什么区别？",
      "为什么有人从 CS2 转 Valorant？",
      "CS2 玩家也玩 Valorant 吗？",
      "CS2 和 LOL 哪个更考验反应？",
      "Valorant 和守望先锋有什么不同？",
    ];

    for (const q of cases) {
      it(`IN (cross-game with shooting ref): ${q}`, async () => {
        const result = await testQuery(q);
        expect(result.final).toBe("IN");
      });
    }
  });
});

// ============================================================================
// E. 模糊问题——测试上下文能力
// ============================================================================

describe("E. Ambiguous / Context-dependent", () => {
  describe("E1. No context → AMBIGUOUS", () => {
    const cases = [
      "你平时玩什么？",
      "你最喜欢什么？",
      "你平常多久玩一次？",
      "你喜欢什么？",
      "你一般和朋友一起玩吗？",
      "你更喜欢单人还是多人？",
      "你平时多久玩一次？",
      "你觉得这个好用吗？",
      // 简单打招呼（第一轮不拦截，已在 A 类中测试为 IN）
      "最近怎么样？",
      "好久不见",
    ];

    for (const q of cases) {
      it(`AMBIGUOUS (no context): ${q}`, async () => {
        const result = await testQuery(q);
        expect(result.final).toBe("AMBIGUOUS");
      });
    }
  });

  describe("E2. With shooting game context → IN", () => {
    const shootingContext = "我们正在讨论你的射击游戏经历。";

    const cases: Array<[string, string]> = [
      ["你平时玩什么？", shootingContext],
      ["你最喜欢什么？", shootingContext],
      ["你平常多久玩一次？", shootingContext],
      ["你喜欢什么枪？", shootingContext],
      ["你喜欢什么？", shootingContext],
      ["你一般和朋友一起玩吗？", shootingContext],
      ["你更喜欢单人还是多人？", shootingContext],
      // 简单打招呼 + 射击游戏上下文 → IN
      ["你好", shootingContext],
      ["最近怎么样", shootingContext],
    ];

    for (const [q, ctx] of cases) {
      it(`IN (with context): ${q}`, async () => {
        const result = await testQuery(q, ctx);
        expect(result.final).toBe("IN");
      });
    }
  });

  describe("E3. With non-game context → stays AMBIGUOUS", () => {
    const nonGameContext = "我们正在讨论你的饮食习惯。";

    const cases: Array<[string, string]> = [
      ["你喜欢什么？", nonGameContext],
      ["你平时多久玩一次？", nonGameContext],
    ];

    for (const [q, ctx] of cases) {
      it(`AMBIGUOUS (non-game context): ${q}`, async () => {
        const result = await testQuery(q, ctx);
        expect(result.final).toBe("AMBIGUOUS");
      });
    }
  });

  describe("E4. LLM Judge — non-shooting game → OUT", () => {
    // 这些问題的关键词不在规则引擎的 other_game 列表中，
    // 但 LLM Judge 应该能识别出它们属于非射击游戏
    const cases = [
      "你喜欢阿瓦隆吗？",
      "阿瓦隆怎么玩？",
    ];

    for (const q of cases) {
      it(`LLM Judge OUT: ${q}`, async () => {
        const result = await checkBoundary(q, {
          skipCache: true,
          useLLMJudge: true,
        });
        // 确定性规则返回 AMBIGUOUS，LLM Judge 应判定为 OUT
        expect(result.final).toBe("OUT");
        expect(result.method).toBe("llm_ambiguity_judge");
      });
    }
  });
});

// ============================================================================
// F. 边界翻转测试
// ============================================================================

describe("F. Boundary Flip", () => {
  describe("F1. Keyword-distinguishable flips (IN → OUT)", () => {
    const flipPairs: Array<[string, string, string]> = [
      // [IN question, OUT question, label]
      [
        "AK 和 M4 哪个更好用？",
        "苹果和微软哪个股票更值得买？",
        "Flip: 武器对比 → 股票对比",
      ],
      [
        "CS2 下一版本会有什么变化？",
        "iPhone 下一版本会有什么变化？",
        "Flip: 游戏更新 → 手机更新",
      ],
      [
        "CS2 排位怎么上分？",
        "NBA 谁最强？",
        "Flip: 游戏排位 → 体育",
      ],
      [
        "你喜欢打 CS2 吗？",
        "你喜欢打麻将吗？",
        "Flip: 射击游戏 → 棋牌",
      ],
      [
        "新手应该怎么练枪？",
        "怎么做红烧肉？",
        "Flip: 练枪 → 烹饪",
      ],
      [
        "AWP 手感怎么样？",
        "为什么年轻人喜欢喝咖啡？",
        "Flip: 武器手感 → 饮食偏好",
      ],
      [
        "CS2 玩家平时喜欢玩什么？",
        "王者荣耀哪个英雄最强？",
        "Flip: 射击游戏 → 其他游戏",
      ],
      [
        "为什么玩家喜欢 FPS？",
        "帮我写 Python 程序",
        "Flip: 游戏动机 → 编程",
      ],
      [
        "你平时喜欢玩什么射击游戏？",
        "你平时喜欢看什么电影？",
        "Flip: 射击游戏 → 电影",
      ],
      [
        "你更喜欢进攻还是防守？",
        "今天天气怎么样？",
        "Flip: 游戏战术 → 天气",
      ],
    ];

    for (const [inQ, outQ, label] of flipPairs) {
      it(`${label}`, async () => {
        const inResult = await testQuery(inQ);
        const outResult = await testQuery(outQ);
        expect(inResult.final).toBe("IN");
        expect(outResult.final).toBe("OUT");
      });
    }
  });

  describe("F2. Semantic flips (keyword-based limitation — IN → AMBIGUOUS)", () => {
    // 这些翻转超出了纯关键词匹配的能力范围。
    // 对于真正语义模糊的问题，引擎默认为宽松策略（IN 或 AMBIGUOUS），
    // 由下游 Evidence Chain 做最终判断。
    const semanticFlips: Array<[string, string, string, string]> = [
      // [IN question, flip question, label, expected flip result]
      [
        "CS2 玩家平时喜欢玩什么？",
        "CS2 玩家平时喜欢吃什么？",
        "Semantic Flip: 游戏活动 → 饮食",
        // 包含 "CS2" → IN，关键词无法区分"玩什么"和"吃什么"
        "IN",
      ],
      [
        "新手应该怎么练枪？",
        "新手应该怎么练字？",
        "Semantic Flip: 练枪 → 练字",
        // "练字" 在非游戏关键词中 → OUT
        "OUT",
      ],
      [
        "你觉得 AK 伤害够吗？",
        "你觉得这药效果够吗？",
        "Semantic Flip: 武器伤害 → 药效",
        // "药效" 在非游戏关键词中 → OUT
        "OUT",
      ],
    ];

    for (const [inQ, flipQ, label, expected] of semanticFlips) {
      it(`${label}`, async () => {
        const inResult = await testQuery(inQ);
        const flipResult = await testQuery(flipQ);
        expect(inResult.final).toBe("IN");
        // 关键词引擎的局限：语义翻转可能无法被检测
        if (expected === "AMBIGUOUS") {
          expect(flipResult.final).toBe("AMBIGUOUS");
        } else if (expected === "IN") {
          // 含游戏关键词 → 仍然 IN（关键词引擎局限）
          expect(flipResult.final).toBe("IN");
        } else if (expected === "OUT") {
          // 含非游戏关键词 → OUT
          expect(flipResult.final).toBe("OUT");
        }
      });
    }
  });
});

// ============================================================================
// G. 最危险的"伪非游戏问题"——隐式游戏语境
// ============================================================================

describe("G. Implicit Game Context", () => {
  describe("G1. Without context → AMBIGUOUS (no game keywords)", () => {
    const cases = [
      "你平时多久玩一次？",
      "你更喜欢单人还是多人？",
      "你喜欢近距离还是远距离？",
      "你喜欢冲还是稳一点？",
      "你最常用哪一个？",
      "你觉得这个好用吗？",
      "你一般选哪个？",
      "你现在玩得怎么样？",
      "你更喜欢竞技还是休闲？",
    ];

    for (const q of cases) {
      it(`AMBIGUOUS (implicit, no context): ${q}`, async () => {
        const result = await testQuery(q);
        expect(result.final).toBe("AMBIGUOUS");
      });
    }
  });

  describe("G2. With shooting game context → IN", () => {
    const gameContext = "我们正在讨论你的射击游戏经历。";

    const cases: Array<[string, string]> = [
      ["你平时多久玩一次？", gameContext],
      ["你一般和朋友一起玩吗？", gameContext],
      ["你更喜欢单人还是多人？", gameContext],
      ["你喜欢进攻还是防守？", gameContext],
      ["你更喜欢近距离还是远距离？", gameContext],
      ["你喜欢冲还是稳一点？", gameContext],
      ["你更喜欢竞技还是休闲？", gameContext],
      ["你最常用哪一个？", gameContext],
    ];

    for (const [q, ctx] of cases) {
      it(`IN (implicit, with context): ${q}`, async () => {
        const result = await testQuery(q, ctx);
        expect(result.final).toBe("IN");
      });
    }
  });
});

// ============================================================================
// 附加：边界情况测试
// ============================================================================

describe("Edge Cases", () => {
  it("空字符串应该是 AMBIGUOUS", async () => {
    const result = await testQuery("");
    expect(result.final).toBe("AMBIGUOUS");
  });

  it("纯标点符号应该是 AMBIGUOUS", async () => {
    const result = await testQuery("？？？");
    expect(result.final).toBe("AMBIGUOUS");
  });

  it("单字 '枪' 应该是 IN", async () => {
    const result = await testQuery("枪");
    expect(result.final).toBe("IN");
  });

  it("'你玩 CS2 吗' 应该是 IN", async () => {
    const result = await testQuery("你玩 CS2 吗");
    expect(result.final).toBe("IN");
  });

  it("'你玩王者荣耀吗' 应该是 OUT (其他游戏)", async () => {
    const result = await testQuery("你玩王者荣耀吗");
    expect(result.final).toBe("OUT");
  });

  it("'你玩 CS2 还是王者荣耀' 应该是 IN (有射击游戏引用)", async () => {
    const result = await testQuery("你玩 CS2 还是王者荣耀");
    expect(result.final).toBe("IN");
  });

  it("包含'游戏'但不特指射击游戏 → IN", async () => {
    const result = await testQuery("游戏好玩吗");
    expect(result.final).toBe("IN");
  });

  it("'你喜欢什么射击游戏' 应该是 IN", async () => {
    const result = await testQuery("你喜欢什么射击游戏");
    expect(result.final).toBe("IN");
  });

  it("'你喜欢看电影吗' 应该是 OUT", async () => {
    const result = await testQuery("你喜欢看电影吗");
    expect(result.final).toBe("OUT");
  });

  it("'你喜欢什么电影' 应该是 OUT", async () => {
    const result = await testQuery("你喜欢什么电影");
    expect(result.final).toBe("OUT");
  });
});