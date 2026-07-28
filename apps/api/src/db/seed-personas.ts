// --------------------------------------------------------------
// 种子脚本：插入示例画像数据（用于开发测试）
// 运行: bun run apps/api/src/db/seed-personas.ts
// --------------------------------------------------------------

import { db } from "./client.js";
import { personas } from "./schema.js";

const SAMPLE_PERSONAS = [
  {
    name: "竞技核心 · 高能力 · PC端",
    description:
      "追求竞技水平提升的硬核FPS玩家，享受排位上分的成就感。PC是唯一选择，对手机射击不屑一顾。",
    tagSpec: {
      诉求: ["竞技证明"],
      能力: "高手",
      风格: ["主动求战", "本能快速反应", "个人能力取胜"],
      平台: "PC端",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "竞技证明——通过击败对手获得自我价值确认",
      M2_expectation: "游戏应该公平、技术导向，付费不该影响竞技平衡",
      M3_perception: "手游不算真正的射击游戏，PC端的技术天花板更高",
      M4_feeling: "打赢有成就感，连败会复盘自己的操作问题",
      M5_behavior: "每天固定训练枪法，关注版本更新和meta变化",
    },
    sampleCount: 120,
    clusterId: "cluster_1",
  },
  {
    name: "社交陪伴 · 中等能力 · 多平台",
    description: "玩游戏主要是为了和朋友一起，输赢在其次，重要的是大家一起玩的氛围。",
    tagSpec: {
      诉求: ["社交归属", "放松逃避"],
      能力: "进阶",
      风格: ["团队协作取胜", "苟活避战"],
      平台: "手游端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "归属感——游戏是和朋友保持联系的方式",
      M2_expectation: "游戏应该让大家一起开心，不应该有太多压力",
      M3_perception: "一个人打路人局没意思，开黑才是真正的游戏体验",
      M4_feeling: "和朋友一起赢的时候最开心，自己打容易烦躁",
      M5_behavior: "只在朋友在线时才玩，会为了迁就朋友换游戏",
    },
    sampleCount: 85,
    clusterId: "cluster_2",
  },
  {
    name: "休闲解压 · 低能力 · 手游端",
    description: "利用碎片时间玩射击游戏放松，不追求技术提升，希望能快速获得爽快感。",
    tagSpec: {
      诉求: ["放松逃避"],
      能力: "新手",
      风格: ["苟活避战"],
      平台: "手游端",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "放松解压——在碎片时间找到片刻的逃离",
      M2_expectation: "游戏应该易上手、节奏快、不花太多时间",
      M3_perception: "我手速不行，跟高手对抗太累",
      M4_feeling: "打PVE杀怪有爽快感，打PVP被虐会焦虑",
      M5_behavior: "只玩PVE模式，每天玩1-2局，不关注竞技内容",
    },
    sampleCount: 65,
    clusterId: "cluster_3",
  },
  {
    name: "硬核拟真 · 高能力 · PC端",
    description: "偏好战术拟真射击（如塔科夫、彩六），享受深度策略和真实感。对休闲射击无感。",
    tagSpec: {
      诉求: ["探索收集", "角色沉浸"],
      能力: "高手",
      风格: ["仔细思考决策", "团队协作取胜"],
      平台: "PC端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "掌控感——在复杂系统中做出正确决策的满足",
      M2_expectation: "游戏应该有深度，真实感比爽快感更重要",
      M3_perception: "主流射击游戏太简单，缺乏战术深度",
      M4_feeling: "成功撤离的紧张感和成就感是其他游戏无法给予的",
      M5_behavior: "花大量时间研究装备搭配和地图点位",
    },
    sampleCount: 45,
    clusterId: "cluster_4",
  },
];

async function main() {
  const existing = await db.select().from(personas);
  if (existing.length > 0) {
    console.log(`已有 ${existing.length} 个画像，跳过种子数据。`);
    console.log("如需重灌，先 TRUNCATE personas CASCADE");
    return;
  }

  for (const p of SAMPLE_PERSONAS) {
    await db.insert(personas).values(p);
    console.log(`  ✅ ${p.name}`);
  }

  console.log(`\n✅ 种子数据完成: ${SAMPLE_PERSONAS.length} 个画像`);
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});
