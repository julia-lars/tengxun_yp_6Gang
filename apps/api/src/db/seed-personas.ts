// --------------------------------------------------------------
// 种子脚本：5 个数据驱动画像（来自 cluster_personas.py 聚类结果）
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
    description: "以变强和证明自己为核心，追求段位、策略博弈与击败强者；可接受高压力和刻意练习，只要竞争公平、成长可见",
    tagSpec: {
      诉求: ["竞技证明", "策略掌控", "能力成长"],
      能力: "高手",
      风格: ["主动求战/刚枪", "情境切换", "个人能力取胜", "操作技巧对抗", "均可"],
      平台: "PC",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "策略掌控、能力成长、竞技证明",
      M4_emotion: "失望失落、快乐、愤怒挫败",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "输了排位赛会复盘半小时，想清楚哪里出了问题",
        "段位掉了我能难受一整天，必须打回来才睡得着",
        "每天至少练枪两小时，手感不好就不打排位",
        "看到自己排名上升比赢一局还开心",
      ],
    },
    evidenceIds: [1041, 867, 1574, 884, 4119, 4364, 299, 8825, 8737, 1621],
    sampleCount: 42,
    clusterId: "C1",
  },

  // ── C2 社交归属型（53人，2,514条语料）──
  {
    name: "社交归属型",
    description: "游戏首先是和朋友建立或维持关系、共同完成挑战的空间；社交关系是其进入与留存的核心驱动力",
    tagSpec: {
      诉求: ["社交归属", "团队协作"],
      风格: ["灵活平衡", "情境切换", "团队协作取胜", "混合", "熟人开黑"],
      平台: "多平台均衡",
      模式: "PVP/PVE均衡",
    },
    motivationChain: {
      M1_motivation: "社交归属、团队协作",
      M4_emotion: "快乐、失望失落、无聊倦怠、兴奋",
      M5_behavior: "社交开黑、休闲匹配、退坑休息、消费氪金",
      causal_paths: [
        "朋友不上线我根本不想开游戏，一个人打太没意思了",
        "跟固定队约好时间开黑，这是我每天最期待的事",
        "朋友退游了我也跟着不怎么玩了，游戏哪有朋友重要",
        "认识新队友比上分更让我开心，玩得好就加好友",
      ],
    },
    evidenceIds: [5671, 9650, 11632, 6225, 12974, 10352, 6338, 3774, 8820, 2573],
    sampleCount: 53,
    clusterId: "C2",
  },

  // ── C3 低压解压型（8人，118条语料，6来源）──
  {
    name: "低压解压型",
    description: "希望游戏轻松、易进入、可随时退出；偏好短局、PVE 和低压力体验，高压、长对局和强协作负担会迅速劝退",
    tagSpec: {
      诉求: ["放松逃避"],
      能力: "入门",
      风格: ["苟活避战", "本能快速反应", "团队个人平衡", "混合", "均可"],
      平台: "手机",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "放松逃避",
      M4_emotion: "快乐、无聊倦怠、失望失落",
      M5_behavior: "休闲匹配、社交开黑、退坑休息",
      causal_paths: [
        "下班回家只想躺着打两把PVE，脑子都不想动",
        "太累的时候连游戏都不想开，宁可刷手机",
        "周末有空才玩久一点，平时就随便打打娱乐模式",
        "玩游戏就是为了放松，打排位太累了我不碰",
      ],
    },
    evidenceIds: [5814, 3549, 5736, 5750, 5691, 5689, 6337, 5695, 3328, 5693],
    sampleCount: 8,
    clusterId: "C3",
  },

  // ── C4 战斗刺激型（21人，529条语料，10来源）──
  {
    name: "战斗刺激型",
    description: "由枪感、打击反馈、战斗节奏和击杀爽感驱动；是否第一时间获得爽感决定去留，世界观和叙事不是必要条件",
    tagSpec: {
      诉求: ["射击爽感"],
      风格: ["主动求战/刚枪", "本能快速反应", "个人能力取胜", "操作技巧对抗", "均可"],
      平台: "多平台均衡",
      模式: "PVP/PVE均衡",
    },
    motivationChain: {
      M1_motivation: "射击爽感",
      M4_emotion: "失望失落、快乐、兴奋",
      M5_behavior: "休闲匹配、社交开黑、切换模式产品",
      causal_paths: [
        "枪感不好的游戏我十分钟就删了，手感是第一位",
        "击杀反馈那一下的爽感最重要，没有这个玩不下去",
        "新赛季出新枪我就回来玩，打完新鲜劲过了就A了",
        "画面差一点无所谓，只要打起来爽就行",
      ],
    },
    evidenceIds: [519, 13133, 13137, 13130, 2949, 1689, 1584, 1832, 13088, 1565],
    sampleCount: 21,
    clusterId: "C4",
  },

  // ── C5 沉浸探索型（117人，2,029条语料）──
  {
    name: "沉浸探索型",
    description: "希望进入可信、有情绪张力的游戏世界，或通过收集经营获得长期成长；世界观、氛围与资源积累的价值高于单纯胜负",
    tagSpec: {
      诉求: ["叙事沉浸", "探索收集", "视听审美"],
      能力: "进阶",
      风格: ["苟活避战", "仔细思考/策略", "个人能力取胜", "数值养成", "陌生人/单人"],
      平台: "主机",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "探索收集、叙事沉浸、视听审美",
      M4_emotion: "快乐、兴奋、失望失落、焦虑紧张",
      M5_behavior: "休闲匹配、社交开黑、消费氪金、刻意练习",
      causal_paths: [
        "我会把地图每个角落都走一遍，看看有没有隐藏的东西",
        "世界观设定好的游戏我能玩几百小时，跟看一部好电影一样",
        "出新地图比出新枪更让我兴奋，我第一件事就是去探索",
        "皮肤不好看我不买，但限定收集品我肯定要拿到手",
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
  console.log("   聚类方法: 半监督 M1 归桶 → HDBSCAN (Gower 距离)");
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});