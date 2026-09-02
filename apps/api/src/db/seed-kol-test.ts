// --------------------------------------------------------------
// 测试用 KOL 种子数据（无需外部数据文件）
// 运行: bun run db:seed-kol-test
// --------------------------------------------------------------

import { db } from "./client.js";
import { kolProfiles, kolSegments } from "./schema.js";

const TEST_KOLS = [
  {
    name: "鬼王陆行",
    bilibiliUid: "1628647",
    personaCard: {
      identity: "硬核游戏测评UP主，以深度分析和犀利点评著称",
      contentFocus: ["射击游戏", "动作游戏", "独立游戏"],
      evaluationFramework: {
        玩法深度: "核心关注点，重视机制创新和系统复杂度",
        手感操作: "高度重视，枪感和操作反馈是评分关键",
        画面表现: "参考维度，不强求顶级画质",
        叙事氛围: "加分项，好的世界观能提升沉浸感",
      },
      platformPreference: "PC",
      specialty: "善于从游戏设计角度分析产品，能指出机制层面的优劣势",
      toneSummary: "批判性、专业、直接",
      representativeTopics: ["武器平衡", "匹配机制", "操作手感", "新手引导"],
      audiencePositioning: "核心FPS玩家和追求竞技深度的硬核用户",
      contentFormats: ["深度测评", "赛季点评"],
    },
    styleProfile: {
      catchphrases: ["不是哥们", "说句实话", "这东西本质上是"],
      tone: "偏批判",
      avgSentenceLength: 35,
      firstPersonStyle: "我觉得",
      signaturePatterns: ["进来，告诉你XXX", "XXX这点我得说道说道"],
      videoCount: 42,
      totalPlayCount: 3500000,
      pacingStyle: "快节奏直切主题",
      vocabularyStyle: "专业术语与口语化表达结合",
    },
    sourceTexts: [
      "这款射击游戏的手感确实不错，枪械的反馈很到位。但是匹配机制真的有问题，经常遇到实力差距很大的对局。",
      "我觉得很多厂商把精力都花在画面上了，核心玩法反而没什么创新。玩家不是傻子，玩久了就知道这游戏有没有深度。",
      "新版本的武器平衡做得还可以，至少不像上赛季那样一把枪统治天梯。但是地图设计还需要打磨。",
    ],
  },
  {
    name: "冷面叶星星IKGN",
    bilibiliUid: "518045432",
    personaCard: {
      identity: "游戏杂谈UP主，以轻松幽默的风格解读游戏文化",
      contentFocus: ["射击游戏", "RPG", "游戏文化"],
      evaluationFramework: {
        玩法乐趣: "最重要，游戏首先要好玩",
        上手门槛: "关注新手体验，难度曲线要合理",
        画面美术: "风格比画质重要",
        社区氛围: "多人游戏的社区环境影响留存",
      },
      platformPreference: "多平台",
      specialty: "擅长用生活化的比喻解释游戏设计，让硬核内容变得通俗易懂",
      toneSummary: "幽默、亲切、接地气",
      representativeTopics: ["上手门槛", "游戏文化", "玩家心理", "版本更新"],
      audiencePositioning: "广泛的休闲玩家和游戏文化爱好者",
      contentFormats: ["游戏杂谈", "文化解读"],
    },
    styleProfile: {
      catchphrases: ["说实话", "有意思的是", "你知道吧"],
      tone: "幽默调侃",
      avgSentenceLength: 28,
      firstPersonStyle: "我",
      signaturePatterns: ["这游戏吧，有意思的地方在于", "你想想看"],
      videoCount: 56,
      totalPlayCount: 4200000,
      pacingStyle: "娓娓道来，善用铺垫",
      vocabularyStyle: "通俗易懂，善用生活化比喻",
    },
    sourceTexts: [
      "说实话，这游戏的上手难度真的劝退了不少人。但是一旦你熬过新手期，后面的内容还是挺丰富的。",
      "有意思的是，很多玩家其实说不清楚自己为什么喜欢一款游戏。可能就是某个瞬间的感觉对了。",
      "我觉得射击游戏最重要的一点是，你得让玩家有掌控感。被虐不可怕，可怕的是不知道自己为什么被虐。",
    ],
  },
];

async function main() {
  const force = process.argv.includes("--force");

  if (force) {
    console.log("🧹 --force: 清空现有 KOL 数据...");
    await db.delete(kolSegments);
    await db.delete(kolProfiles);
  }

  const existing = await db.select().from(kolProfiles);
  if (existing.length > 0 && !force) {
    console.log(`已有 ${existing.length} 个 KOL，跳过。加 --force 重灌`);
    return;
  }

  for (const kol of TEST_KOLS) {
    const [profile] = await db.insert(kolProfiles).values({
      name: kol.name,
      bilibiliUid: kol.bilibiliUid,
      personaCard: kol.personaCard,
      styleProfile: kol.styleProfile,
      sourceTexts: kol.sourceTexts,
    }).returning();

    console.log(`  ✅ ${kol.name} (id=${profile!.id})`);

    // 插入语料片段
    for (const text of kol.sourceTexts) {
      await db.insert(kolSegments).values({
        kolId: profile!.id,
        bvid: `BVtest${kol.bilibiliUid.slice(0, 6)}`,
        title: `${kol.name}测试视频`,
        originalText: text,
        sourceUrl: `https://www.bilibili.com/video/BVtest`,
      });
    }
  }

  console.log(`\n✅ KOL 测试种子完成: ${TEST_KOLS.length} 个`);
}

main().catch((e) => {
  console.error("KOL 种子失败:", e);
  process.exit(1);
});