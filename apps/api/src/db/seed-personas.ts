// --------------------------------------------------------------
// 种子脚本：5 个数据驱动画像（来自 cluster_personas.py 聚类结果，已合并子型和噪声边缘）
// 基于 docs/画像假设.md v1.2 的 C1–C5 半监督框架
// 数据来源：241 个受访者、7,225 条已标注+已嵌入片段
//
// 运行: bun run apps/api/src/db/seed-personas.ts
// 重灌: bun run apps/api/src/db/seed-personas.ts --force
// --------------------------------------------------------------

import { db } from "./client.js";
import { personas } from "./schema.js";

const PERSONAS = [
  // ── C1 竞技成长型（42人，2,035条语料，17来源）──
  {
    name: "竞技成长型",
    description: "核心诉求为策略掌控、能力成长；偏好PC端，PVP为主；行为包括休闲匹配、社交开黑、切换模式",
    tagSpec: {
      诉求: ["策略掌控", "能力成长", "竞技证明"],
      能力: "进阶",
      风格: ["灵活", "团队取胜", "策略", "操作", "熟人"],
      平台: "PC端",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "策略掌控、能力成长、竞技证明",
      M4_emotion: "失望失落、快乐、愤怒挫败",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:ability_growth→M5:deliberate_practice",
        "M1:competitive_proof→M5:ranked_grind",
        "M4:boredom_burnout→M5:switch_mode",
        "M1:exploration_collection→M5:casual_play",
      ],
    },
    evidenceIds: [1041, 867, 1574, 884, 4119, 4364, 299, 8825, 8737, 1621],
    sampleCount: 42,
    clusterId: "C1",
  },

  // ── C2 社交归属型（53人，2,514条语料）──
  // 合并自 C2-1(28人) + C2-2(16人) + C2-noise(9人)
  {
    name: "社交归属型",
    description: "核心诉求为社交归属、团队协作；涵盖PC和主机端，PVP为主；行为包括社交开黑、休闲匹配、退坑、消费氪金",
    tagSpec: {
      诉求: ["社交归属", "团队协作"],
      能力: "新手",
      风格: ["灵活", "团队取胜", "情境", "混合", "熟人", "本能", "操作"],
      平台: "PC端、主机端",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "社交归属、团队协作",
      M4_emotion: "快乐、失望失落、无聊倦怠、兴奋",
      M5_behavior: "社交开黑、休闲匹配、退坑休息、消费氪金",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:relaxation_escape→M5:casual_play",
        "M1:competitive_proof→M5:ranked_grind",
        "M4:boredom_burnout→M5:quit_break",
        "M1:exploration_collection→M5:casual_play",
      ],
    },
    evidenceIds: [5671, 9650, 11632, 6225, 12974, 10352, 6338, 3774, 8820, 2573],
    sampleCount: 53,
    clusterId: "C2",
  },

  // ── C3 低压解压型（8人，118条语料，6来源）──
  {
    name: "低压解压型",
    description: "核心诉求为放松逃避；行为包括休闲匹配、社交开黑；情绪以快乐、无聊倦怠为主",
    tagSpec: {
      诉求: ["放松逃避"],
      风格: [],
    },
    motivationChain: {
      M1_motivation: "放松逃避",
      M4_emotion: "快乐、无聊倦怠、失望失落",
      M5_behavior: "休闲匹配、社交开黑、退坑休息",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:ability_growth→M5:deliberate_practice",
        "M3:self_limitation→M5:casual_play",
        "M3:self_limitation→M5:switch_mode",
        "M1:exploration_collection→M5:switch_mode",
      ],
    },
    evidenceIds: [5814, 3549, 5736, 5750, 5691, 5689, 6337, 5695, 3328, 5693],
    sampleCount: 8,
    clusterId: "C3",
  },

  // ── C4 战斗刺激型（21人，529条语料，10来源）──
  {
    name: "战斗刺激型",
    description: "核心诉求为射击爽感；PVP为主，偏好刚枪、个人取胜；行为包括休闲匹配、社交开黑",
    tagSpec: {
      诉求: ["射击爽感"],
      模式: "PVP为主",
      风格: ["刚枪", "个人取胜", "本能", "混合"],
    },
    motivationChain: {
      M1_motivation: "射击爽感",
      M4_emotion: "失望失落、快乐、兴奋",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:ability_growth→M5:deliberate_practice",
        "M4:anger_frustration→M5:quit_break",
        "M1:stimulation→M4:excitement",
        "M1:dominance→M4:excitement",
      ],
    },
    evidenceIds: [519, 13133, 13137, 13130, 2949, 1689, 1584, 1832, 13088, 1565],
    sampleCount: 21,
    clusterId: "C4",
  },

  // ── C5 沉浸探索型（117人，2,029条语料）──
  // 合并自 C5-1(5人) + C5-2(90人) + C5-noise(22人)
  {
    name: "沉浸探索型",
    description: "核心诉求为探索收集、叙事沉浸、视听审美；涵盖PC和主机端；行为包括休闲匹配、社交开黑、消费氪金、刻意练习",
    tagSpec: {
      诉求: ["探索收集", "叙事沉浸", "视听审美"],
      能力: "进阶",
      风格: ["苟活", "个人取胜", "策略", "混合", "单人", "灵活", "情境", "操作", "熟人"],
      平台: "PC端、主机端",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "探索收集、叙事沉浸、视听审美",
      M4_emotion: "快乐、兴奋、失望失落、焦虑紧张",
      M5_behavior: "休闲匹配、社交开黑、消费氪金、刻意练习",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:exploration_collection→M5:casual_play",
        "M1:exploration_collection→M5:spending",
        "M1:strategy_mastery→M5:deliberate_practice",
        "M1:narrative_immersion→M5:spending",
      ],
    },
    evidenceIds: [6361, 6391, 3581, 3392, 11332, 2966, 10013, 13087, 9397, 10720],
    sampleCount: 117,
    clusterId: "C5",
  },
];

async function main() {
  const force = process.argv.includes("--force");

  if (force) {
    console.log("🧹 --force: 清空现有画像数据...");
    await db.delete(personas);
  } else {
    const existing = await db.select().from(personas);
    if (existing.length > 0) {
      console.log(`已有 ${existing.length} 个画像，跳过种子数据。`);
      console.log("如需重灌，加 --force 参数");
      return;
    }
  }

  for (const p of PERSONAS) {
    await db.insert(personas).values(p);
    console.log(`  ✅ ${p.name}`);
  }

  console.log(`\n✅ 种子数据完成: ${PERSONAS.length} 个画像`);
  console.log("   数据来源: 241 个受访者、7,225 条已标注+已嵌入片段");
  console.log("   聚类方法: 半监督 M1 归桶 → HDBSCAN 子型 (Gower 距离)");
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});