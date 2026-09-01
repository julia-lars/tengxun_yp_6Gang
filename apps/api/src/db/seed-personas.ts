// --------------------------------------------------------------
// 种子脚本：5 个群体画像 — 标签重构 v2.1
// 数据来源：cluster_personas.py 聚类输出（DB） + 画像假设文档补充
// 证据分级：
//   - 强：DB 聚类输出（framework annotation 聚合，加权众数）
//   - 中：个体 tag_spec 非默认值分布（map_tags_v2.py 输出）
//   - 弱：docs/画像假设.md v1.2 定义（C3/C5 缺失维度补充）
// 详情见 docs/2.0标签重新对应方案.md
//
// 运行: bun run apps/api/src/db/seed-personas.ts
// 重灌: bun run apps/api/src/db/seed-personas.ts --force
// --------------------------------------------------------------

import { db } from "./client.js";
import { personas } from "./schema.js";

const PERSONAS = [
  // ── C1 竞技成长型（165人，DB聚类输出）──
  {
    name: "竞技成长型",
    description: "以变强和证明自己为核心，追求段位、策略博弈与击败强者；可接受高压力和刻意练习，只要竞争公平、成长可见",
    tagSpec: {
      诉求: ["策略掌控", "能力成长", "竞技证明"],
      能力: "进阶",
      风格: ["灵活平衡", "仔细思考/策略", "团队协作取胜", "操作技巧对抗", "熟人开黑"],
      平台: "PC",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "策略掌控、能力成长、竞技证明",
      M2_expectation: "丰富内容、低门槛、技术决定",
      M3_cognition: "品质感知: 信息不透明、视觉反馈缺失；难度感知: 学习曲线陡峭、过于复杂；深度感知: 多层讽刺、后期信息不足",
      M4_feeling: "失望失落、愤怒挫败、快乐",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "M1:ability_growth→M5:deliberate_practice",
        "M1:competitive_proof→M5:ranked_grind",
        "M1:ability_growth→M5:watch_guides",
        "M1:social_belonging→M5:social_play",
        "M1:exploration_collection→M5:casual_play",
      ],
    },
    evidenceIds: [1041, 867, 1574, 884, 4119, 4364, 299, 8825, 8737, 1621],
    sampleCount: 165,
    clusterId: "C1",
  },

  // ── C2 社交归属型（304人，DB聚类输出）──
  {
    name: "社交归属型",
    description: "游戏首先是和朋友建立或维持关系、共同完成挑战的空间；社交关系是其进入与留存的核心驱动力",
    tagSpec: {
      诉求: ["社交归属", "团队协作"],
      能力: "未知",
      风格: ["灵活平衡", "情境切换", "团队协作取胜", "混合", "熟人开黑"],
      平台: "PC",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "社交归属、团队协作",
      M2_expectation: "丰富内容、低门槛、社交便利",
      M3_cognition: "品质感知: 缺乏新鲜感、画面过时；自我能力: 技术水平低、技术水平高；自我认同: 休闲玩家、社交型玩家",
      M4_feeling: "失望失落、快乐、无聊倦怠",
      M5_behavior: "社交开黑、休闲匹配、退坑休息",
      causal_paths: [
        "M1:social_belonging→M5:social_play",
        "M1:relaxation_escape→M5:casual_play",
        "M1:exploration_collection→M5:casual_play",
        "M1:competitive_proof→M5:ranked_grind",
        "M1:ability_growth→M5:deliberate_practice",
      ],
    },
    evidenceIds: [5671, 9650, 11632, 6225, 12974, 10352, 6338, 3774, 8820, 2573],
    sampleCount: 304,
    clusterId: "C2",
  },

  // ── C3 低压解压型（65人，DB诉求+画像假设补充）──
  {
    name: "低压解压型",
    description: "希望游戏轻松、易进入、可随时退出；偏好短局、PVE 和低压力体验，高压、长对局和强协作负担会迅速劝退",
    tagSpec: {
      诉求: ["放松逃避"],
      能力: "入门",
      风格: ["苟活避战", "情境切换", "团队个人平衡", "混合", "陌生人/单人"],
      平台: "手机",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "放松逃避",
      M2_expectation: "低门槛、丰富内容、技术决定",
      M3_cognition: "自我认同: 休闲玩家、娱乐寻求者；品质感知: 内容单调、画质差/扁平；难度感知: 复活降低压力、需要团队配合",
      M4_feeling: "快乐、无聊倦怠、失望失落",
      M5_behavior: "休闲匹配、社交开黑、退坑休息",
      causal_paths: [
        "M1:relaxation_escape→M5:casual_play",
        "M1:social_belonging→M5:social_play",
        "M1:ability_growth→M5:deliberate_practice",
        "M3:self_limitation→M5:casual_play",
        "M3:monotonous_content→M5:quit_break",
      ],
    },
    evidenceIds: [5814, 3549, 5736, 5750, 5691, 5689, 6337, 5695, 3328, 5693],
    sampleCount: 65,
    clusterId: "C3",
  },

  // ── C4 战斗刺激型（165人，DB聚类+个体数据补充）──
  {
    name: "战斗刺激型",
    description: "由枪感、打击反馈、战斗节奏和击杀爽感驱动；是否第一时间获得爽感决定去留，世界观和叙事不是必要条件",
    tagSpec: {
      诉求: ["射击爽感"],
      能力: "高手",
      风格: ["主动求战/刚枪", "本能快速反应", "个人能力取胜", "混合", "熟人开黑"],
      平台: "多平台均衡",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "射击爽感",
      M2_expectation: "丰富内容、低门槛、公平竞技",
      M3_cognition: "品质感知: 英雄反馈不一致、制作质量低；难度感知: 翻盘困难、排位靠肝；深度感知: 连招主导、过于复杂",
      M4_feeling: "失望失落、快乐、兴奋",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "M1:stimulation→M5:casual_play",
        "M1:social_belonging→M5:social_play",
        "M1:ability_growth→M5:deliberate_practice",
        "M4:anger_frustration→M5:quit_break",
        "M4:boredom_burnout→M5:switch_mode",
      ],
    },
    evidenceIds: [519, 13133, 13137, 13130, 2949, 1689, 1584, 1832, 13088, 1565],
    sampleCount: 165,
    clusterId: "C4",
  },

  // ── C5 沉浸探索型（199人，DB诉求+画像假设补充）──
  {
    name: "沉浸探索型",
    description: "希望进入可信、有情绪张力的游戏世界，或通过收集经营获得长期成长；世界观、氛围与资源积累的价值高于单纯胜负",
    tagSpec: {
      诉求: ["探索收集", "叙事沉浸"],
      能力: "进阶",
      风格: ["苟活避战", "仔细思考/策略", "个人能力取胜", "数值养成", "陌生人/单人"],
      平台: "PC",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "探索收集、叙事沉浸",
      M2_expectation: "丰富内容、低门槛、沉浸体验",
      M3_cognition: "品质感知: 联动破坏沉浸感、角色有趣；自我认同: 怪物猎人粉丝、兴趣驱动购买；付费感知: 免费游戏吸引人、免费游玩",
      M4_feeling: "兴奋、快乐、失望失落",
      M5_behavior: "休闲匹配、社交开黑、消费氪金",
      causal_paths: [
        "M1:exploration_collection→M5:casual_play",
        "M1:exploration_collection→M5:spending",
        "M1:narrative_immersion→M5:spending",
        "M1:social_belonging→M5:social_play",
        "M1:relaxation_escape→M5:casual_play",
      ],
    },
    evidenceIds: [6361, 6391, 3581, 3392, 11332, 2966, 10013, 13087, 9397, 10720],
    sampleCount: 199,
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
  console.log("   聚类方法: 半监督 M1 归桶 → HDBSCAN (Gower 距离)");
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});