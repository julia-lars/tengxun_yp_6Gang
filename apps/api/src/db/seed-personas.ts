// --------------------------------------------------------------
// 种子脚本：8 个射击品类画像假设（来自 docs/画像假设.md v1.1）
// 运行: bun run apps/api/src/db/seed-personas.ts
// 重灌: bun run apps/api/src/db/seed-personas.ts --force
// --------------------------------------------------------------

import { db } from "./client.js";
import { personas } from "./schema.js";

const PERSONAS = [
  // ── H1 排位证明型竞技者 ──
  {
    name: "排位证明型竞技者",
    description: "把段位、排行榜和击败强者当作能力证明；可接受练习和高压力，只要竞争结果清晰且公平。",
    tagSpec: {
      诉求: ["竞技证明"],
      能力: "高手",
      风格: ["主动求战刚枪", "个人能力取胜", "本能快速反应"],
      平台: "PC端",
      模式: "PVP为主",
    },
    motivationChain: {
      M1_motivation: "通过战胜他人和上升排名证明能力与价值",
      M2_expectation: "竞技规则应公平，胜负应主要由技术决定；进步应可被段位看见",
      M3_perception: "更高段位说明我更强；失败说明表现不够好或系统不公平",
      M4_feeling: "获胜、晋级和压制带来强成就；连败可能带来愤怒或羞耻",
      M5_behavior: "持续排位、刻意练习、看攻略、追排行榜；极端时对队友发火",
    },
    sampleCount: 50,
    clusterId: "H1",
  },

  // ── H2 知识成长型战术家 ──
  {
    name: "知识成长型战术家",
    description: "享受「理解系统—掌握地图—做出正确决策—变强」的过程，更愿意用知识和策略而非纯反应取胜。",
    tagSpec: {
      诉求: ["探索收集", "角色沉浸"],
      能力: "进阶",
      风格: ["仔细思考决策", "团队协作取胜"],
      平台: "PC端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "通过理解复杂系统和做出正确决策获得胜任与掌控",
      M2_expectation: "知识、准备和战术应能稳定转化为优势",
      M3_perception: "反应会下降，但地图和知识可以积累；赢应来自更好的判断",
      M4_feeling: "破解系统和验证战术带来成就；纯反应对抗容易疲惫",
      M5_behavior: "背地图、看攻略、复盘、规划路线、练配合",
    },
    sampleCount: 40,
    clusterId: "H2",
  },

  // ── H3 社交连接型协作者 ──
  // 内含三个子型：H3-A 熟人固定队 / H3-B 路人协作 / H3-C 公会归属
  {
    name: "社交连接型协作者",
    description: "游戏首先是建立或维持关系的空间。内含熟人固定队、路人协作和公会归属三种社交结构，朋友在不在决定玩不玩。",
    tagSpec: {
      诉求: ["社交归属"],
      能力: "进阶",
      风格: ["团队协作取胜"],
      平台: "手游端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "维持关系、结识可靠伙伴或获得组织归属，共享游戏经历",
      M2_expectation: "不同水平的人应能顺畅组队；沟通、匹配和组织机制应可靠",
      M3_perception: "朋友不玩会失去主要价值；一个人打路人局没意思",
      M4_feeling: "共同成功带来快乐和归属；落单、恶意队友带来失落",
      M5_behavior: "固定组排、路人匹配、公会活动、跟随关系迁移；关系断裂后降低频率",
    },
    sampleCount: 45,
    clusterId: "H3",
  },

  // ── H4 低压休闲解压者 ──
  {
    name: "低压休闲解压者",
    description: "希望游戏轻松、易进入、可随时退出；高压力、长对局、强协作负担和持续挫败会迅速消耗其时间与情绪资产。",
    tagSpec: {
      诉求: ["放松逃避"],
      能力: "新手",
      风格: ["苟活避战"],
      平台: "手游端",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "从现实压力中抽离，获得轻松和可控的休息",
      M2_expectation: "游戏应尊重时间、容易上手，不应制造额外压力",
      M3_perception: "玩久了太累；PVE 和朋友一起更放松",
      M4_feeling: "低压时放松，高压、连败或沟通失败时疲惫或焦虑",
      M5_behavior: "玩短局、单排、转娱乐/PVE、累了就停、选择更低负担产品",
    },
    sampleCount: 50,
    clusterId: "H4",
  },

  // ── H5 纯战斗爽感追求者 ──
  {
    name: "纯战斗爽感追求者",
    description: "由枪感、打击反馈、战斗节奏和击败反馈驱动；是否「第一时间爽到」直接影响下载、迁移和新手期留存。",
    tagSpec: {
      诉求: ["竞技证明"],
      能力: "进阶",
      风格: ["主动求战刚枪", "本能快速反应"],
      平台: "PC端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "追求强烈、即时的射击与战斗回报",
      M2_expectation: "命中、击杀、移动和受击反馈应明确，节奏应顺畅",
      M3_perception: "战斗爽就值得入坑；枪感比包装更重要",
      M4_feeling: "兴奋、爽快、紧张、释放",
      M5_behavior: "因实机战斗入坑，爽感下降后冷却，活动视频可能触发短期回流",
    },
    sampleCount: 35,
    clusterId: "H5",
  },

  // ── H6 叙事氛围沉浸者 ──
  {
    name: "叙事氛围沉浸者",
    description: "希望进入一个可信、有情绪张力的游戏世界；世界观、角色、环境叙事和临场氛围比单纯击杀反馈更能决定长期记忆与体验价值。",
    tagSpec: {
      诉求: ["角色沉浸", "探索收集"],
      能力: "进阶",
      风格: ["仔细思考决策"],
      平台: "主机端",
      模式: "PVE为主",
    },
    motivationChain: {
      M1_motivation: "进入另一个可信世界，体验角色、环境和情绪",
      M2_expectation: "题材、美术、音效、规则和叙事应一致，不能频繁破坏代入",
      M3_perception: "氛围使它区别于普通射击游戏；世界是否可信比纯数值更重要",
      M4_feeling: "沉浸、紧张、好奇、敬畏、情感投入",
      M5_behavior: "探索环境、关注故事和细节、选择剧情/氛围型模式；沉浸被破坏时退出",
    },
    sampleCount: 30,
    clusterId: "H6",
  },

  // ── H7 搜撤资源博弈者 ──
  // 内含两子型：H7-A 收藏经营型 / H7-B 击杀掠夺型
  {
    name: "搜撤资源博弈者",
    description: "在搜打撤循环中通过资源获得价值。内含收藏经营型（安全撤离、积累成长）和击杀掠夺型（主动猎杀、高风险收益）两种路径。",
    tagSpec: {
      诉求: ["探索收集"],
      能力: "进阶",
      风格: ["仔细思考决策", "主动求战刚枪"],
      平台: "PC端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "收藏经营型追求积累和掌控；击杀掠夺型追求风险回报和刺激",
      M2_expectation: "资源循环应清晰且风险收益对等；收藏型期待努力可保留",
      M3_perception: "仓库成长比段位有价值（收藏型）；最有价值的资源应通过战斗夺取（掠夺型）",
      M4_feeling: "成功撤离带来满足；以小博大带来兴奋；高价值损失带来剧烈挫败",
      M5_behavior: "收藏型搜索、撤离、扩容和装饰；掠夺型主动找人、伏击、追击和夺取装备",
    },
    sampleCount: 35,
    clusterId: "H7",
  },

  // ── H8 时间受限情境切换者 ──
  {
    name: "时间受限情境切换者",
    description: "没有单一稳定玩法：平台、朋友是否在线、学业工作和可用时间共同决定当下选择，偏好具有明确条件性。",
    tagSpec: {
      诉求: ["社交归属", "放松逃避"],
      能力: "进阶",
      风格: ["团队协作取胜"],
      平台: "PC端",
      模式: "PVP+PVE",
    },
    motivationChain: {
      M1_motivation: "不是单一动机，而是用不同产品满足不同场景需求",
      M2_expectation: "产品应适配可用时间、设备和社交条件",
      M3_perception: "某平台适合放松，另一平台适合竞技；朋友在不在决定节奏",
      M4_feeling: "条件匹配时轻松或投入；条件不匹配时压力、疲惫",
      M5_behavior: "跨平台、跨品类、跨节奏切换",
    },
    sampleCount: 40,
    clusterId: "H8",
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
}

main().catch((e) => {
  console.error("种子数据失败:", e);
  process.exit(1);
});
