// --------------------------------------------------------------
// Deterministic Normalization — 确定性标准化（规则/词典/实体映射，不用 LLM）
// V0.2 Boundary Engine Layer 2
// --------------------------------------------------------------

// ---- 标准化字段类型 ----

export type TopicType =
  | "weapon"
  | "map"
  | "game_mechanic"
  | "player_behavior"
  | "player_preference"
  | "competitive"
  | "KOL_content"
  | "game_mode"
  | "economy"
  | "meta";

export type QuestionType =
  | "what"
  | "how_to"
  | "why"
  | "compare"
  | "predict"
  | "evaluate";

export type DomainType = "shooting_game" | "non_game" | "other_game" | "ambiguous";

export interface CanonicalQuery {
  domain: DomainType;
  game: string | null;
  entity: string | null;
  topic: TopicType | null;
  intent: string | null;
  question_type: QuestionType;
}

// ---- Answerability Signature (V0.2 C3) ----

export interface AnswerabilitySignature {
  domain: string;
  game: string | null;
  entity: string | null;
  topic: string | null;
  intent: string | null;
  question_type: string;
  entity_type: string | null;
  question_subtype: string | null;
  has_modifier_keywords: boolean;
  has_temporal_condition: boolean;
  has_quantitative_condition: boolean;
}

// ============================================================================
// Step 1: 实体词典
// ============================================================================

/** 游戏名称标准化映射 */
const GAME_NAME_MAP: Record<string, string> = {
  // CS 系列
  "cs2": "CS2", "csgo": "CSGO", "cs:go": "CSGO", "cs go": "CSGO",
  "cs1.6": "CS1.6", "cs 1.6": "CS1.6", "cs": "CS2",
  // Valorant
  "val": "Valorant", "valorant": "Valorant", "瓦罗兰特": "Valorant",
  "瓦": "Valorant", "无畏契约": "Valorant",
  // PUBG
  "pubg": "PUBG", "绝地求生": "PUBG", "吃鸡": "PUBG",
  // Apex
  "apex": "Apex", "apex legends": "Apex", "apex英雄": "Apex",
  // COD
  "cod": "COD", "使命召唤": "COD", "call of duty": "COD",
  // Overwatch
  "ow": "Overwatch", "overwatch": "Overwatch", "守望先锋": "Overwatch", "守望": "Overwatch",
  // CF
  "cf": "CF", "cfm": "CFM", "cfhd": "CFHD", "穿越火线": "CF",
  // Rainbow Six
  "r6": "R6", "彩虹六号": "R6", "彩六": "R6",
  // Battlefield
  "战地": "Battlefield", "bf": "Battlefield",
  // Fortnite
  "fortnite": "Fortnite", "堡垒之夜": "Fortnite",
  // Destiny
  "destiny": "Destiny", "命运2": "Destiny", "命运二": "Destiny",
  // Warzone
  "warzone": "Warzone", "战区": "Warzone",
  // 三角洲
  "三角洲": "DeltaForce", "三角洲行动": "DeltaForce", "delta force": "DeltaForce",
  // 暗区突围
  "暗区突围": "ArenaBreakout", "暗区": "ArenaBreakout",
  // 萤火突击
  "萤火突击": "Firefly",
  // 瓦洛兰特
  "瓦洛兰特": "Valorant",
  // 漫威争锋
  "漫威争锋": "MarvelRivals", "漫威": "MarvelRivals",
  // Deadlock
  "deadlock": "Deadlock", "死锁": "Deadlock",
  // Helldivers
  "helldivers": "Helldivers", "地狱潜兵": "Helldivers",
  // The Finals
  "the finals": "TheFinals",
  // 永劫无间
  "永劫无间": "Naraka",
};

/** 武器名称标准化映射 */
const WEAPON_NAME_MAP: Record<string, string> = {
  // AK 系列
  "ak": "AK-47", "ak47": "AK-47", "ak-47": "AK-47", "阿卡": "AK-47",
  "akm": "AKM",
  // M4 系列
  "m4": "M4A4", "m4a4": "M4A4", "m4a1": "M4A1-S", "m4a1-s": "M4A1-S",
  "m4a1s": "M4A1-S",
  // AWP
  "awp": "AWP", "大狙": "AWP", "狙击枪": "AWP",
  // 其他步枪
  "aug": "AUG", "sg553": "SG553", "sg 553": "SG553",
  "famas": "FAMAS", "galil": "Galil",
  // SMG
  "mp5": "MP5", "mp7": "MP7", "mp9": "MP9", "mac10": "MAC-10",
  "mac-10": "MAC-10", "ump45": "UMP-45", "ump": "UMP-45",
  "p90": "P90", "pp-bizon": "PP-Bizon", "bizon": "PP-Bizon",
  // 手枪
  "deagle": "DesertEagle", "沙漠之鹰": "DesertEagle",
  "usp": "USP-S", "usp-s": "USP-S",
  "glock": "Glock-18", "glock18": "Glock-18",
  "p250": "P250", "cz75": "CZ75", "five-seven": "Five-SeveN",
  "tec9": "Tec-9", "tec-9": "Tec-9",
  // 霰弹枪
  "xm1014": "XM1014", "mag7": "MAG-7", "mag-7": "MAG-7",
  "nova": "Nova", "sawed-off": "Sawed-Off",
  // 狙击枪
  "scout": "SSG08", "ssg08": "SSG08", "ssg 08": "SSG08",
  "scar20": "SCAR-20", "scar-20": "SCAR-20", "g3sg1": "G3SG1",
  // 机枪
  "negev": "Negev", "m249": "M249",
  // 装备
  "烟雾弹": "Smoke", "闪光弹": "Flash", "手雷": "HEGrenade",
  "燃烧弹": "Incendiary", "诱饵弹": "Decoy",
  // Valorant 武器
  "vandal": "Vandal", "phantom": "Phantom", "operator": "Operator",
  "spectre": "Spectre", "marshal": "Marshal", "sheriff": "Sheriff",
  "ghost": "Ghost", "classic": "Classic", "frenzy": "Frenzy",
  "bulldog": "Bulldog", "guardian": "Guardian", "stinger": "Stinger",
  "odin": "Odin", "ares": "Ares", "judge": "Judge", "bucky": "Bucky",
  "shorty": "Shorty",
};

/** 地图名称标准化映射 */
const MAP_NAME_MAP: Record<string, string> = {
  // CS2 地图
  "dust2": "Dust2", "dust 2": "Dust2", "沙二": "Dust2", "沙2": "Dust2",
  "mirage": "Mirage", "米垃圾": "Mirage", "荒漠迷城": "Mirage",
  "inferno": "Inferno", "炼狱小镇": "Inferno", "小镇": "Inferno",
  "nuke": "Nuke", "核子危机": "Nuke",
  "overpass": "Overpass", "死亡游乐园": "Overpass", "游乐园": "Overpass",
  "ancient": "Ancient", "远古遗迹": "Ancient",
  "anubis": "Anubis", "阿努比斯": "Anubis",
  "vertigo": "Vertigo", "殒命大厦": "Vertigo", "大厦": "Vertigo",
  "cache": "Cache", "死城之谜": "Cache",
  "train": "Train", "列车停放站": "Train", "火车": "Train",
  "cobblestone": "Cobblestone", "古堡": "Cobblestone",
  "office": "Office", "办公室": "Office",
  "italy": "Italy", "意大利": "Italy",
  // Valorant 地图
  "ascent": "Ascent", "bind": "Bind", "haven": "Haven",
  "split": "Split", "icebox": "Icebox", "breeze": "Breeze",
  "fracture": "Fracture", "pearl": "Pearl", "lotus": "Lotus",
  "sunset": "Sunset", "abyss": "Abyss",
};

/** 术语标准化映射 */
const TERM_MAP: Record<string, string> = {
  // 操作类
  "压枪": "recoil_control", "控枪": "recoil_control",
  "压枪技巧": "recoil_control", "后坐力控制": "recoil_control",
  "爆头": "headshot", "爆头率": "headshot_rate",
  "走位": "positioning", "身法": "movement",
  "预瞄": "pre_aim", "提前枪": "pre_fire",
  "拉枪": "flick", "甩枪": "flick",
  "听声辨位": "sound_awareness", "听脚步": "sound_awareness",
  // 战术类
  "rush": "rush", "rush b": "rush",
  "eco": "eco", "eco局": "eco", "经济局": "eco",
  "force buy": "force_buy", "强起": "force_buy",
  "save": "save_round", "保枪": "save_round",
  "fake": "fake", "假打": "fake",
  "rotate": "rotate", "转点": "rotate",
  "execute": "execute", "一波": "execute",
  "default": "default_play", "默认": "default_play",
  // 角色/位置
  "entry": "entry_fragger", "突破手": "entry_fragger", "突破": "entry_fragger",
  "awper": "awper", "狙击手": "awper", "主狙": "awper",
  "igl": "igl", "指挥": "igl", "队长": "igl",
  "support": "support", "辅助": "support",
  "lurker": "lurker", "自由人": "lurker",
  "anchor": "anchor", "守点": "anchor",
  // 统计类
  "使用率": "usage_rate", "使用比例": "usage_rate",
  "胜率": "win_rate", "胜率数据": "win_rate",
  "kda": "kda", "kd": "kd_ratio", "kd比": "kd_ratio",
  "adr": "adr", "rating": "rating",
  "段位": "rank", "段位分布": "rank_distribution",
  // 偏好类
  "偏好": "preference", "喜欢": "preference",
  "受欢迎": "popularity", "热门": "popularity",
  // 机制类
  "后坐力": "recoil", "弹道": "bullet_pattern",
  "伤害": "damage", "伤害值": "damage",
  "射速": "fire_rate", "弹容量": "magazine_capacity",
  "换弹": "reload", "换弹速度": "reload_speed",
  "穿透": "penetration", "穿墙": "wallbang",
  // 模式类
  "排位": "ranked", "竞技": "ranked", "天梯": "ranked",
  "休闲": "casual", "匹配": "casual",
  "死斗": "deathmatch", "军备竞赛": "arms_race",
  "爆破": "defusal", "人质": "hostage",
  // 游戏体验类
  "手感": "game_feel", "枪感": "gun_feel",
  "平衡": "balance", "平衡性": "balance",
  "机制": "mechanic", "游戏机制": "mechanic",
  "meta": "meta", "版本": "meta", "环境": "meta",
  // 社交类
  "开黑": "team_play", "组队": "team_play", "语音": "voice_chat",
  "公会": "guild", "战队": "team", "clan": "clan",
  // 付费类
  "皮肤": "skin", "饰品": "cosmetic",
  "通行证": "battle_pass", "战令": "battle_pass",
  "氪金": "pay_to_win", "付费": "monetization",
  // 预测类
  "预测": "predict", "趋势": "trend", "未来": "predict",
  "会削弱": "nerf_prediction", "会增强": "buff_prediction",
  "下赛季": "next_season", "更新": "update",
  // 原因类
  "为什么": "reason", "原因": "reason",
  "动机": "motivation", "心理": "psychology",
};

// ============================================================================
// Step 2: 规则模式匹配
// ============================================================================

/** 问题类型识别规则 */
const QUESTION_TYPE_RULES: Array<{ pattern: RegExp; type: QuestionType; priority: number }> = [
  // why — 原因/动机
  { pattern: /为什么|为何|为啥|原因|怎么.*这么|怎么.*那么/, type: "why", priority: 5 },
  // how_to — 方法/操作
  { pattern: /怎么|如何|怎样|咋|用什么.*方法|技巧|教程|攻略/, type: "how_to", priority: 4 },
  // compare — 比较
  { pattern: /vs|对比|区别|哪个.*好|哪个.*强|哪个.*厉害|比较|不同|差别|差异|和.*比|跟.*比/, type: "compare", priority: 4 },
  // predict — 预测/趋势
  { pattern: /会不会|将会|未来|下个赛季|下赛季|趋势|预测|会变|削弱|增强|加强|改版/, type: "predict", priority: 4 },
  // evaluate — 评价
  { pattern: /好不好|值不值|怎么样|如何评价|你觉得|你认为|算不算|算好吗/, type: "evaluate", priority: 3 },
  // what — 默认（事实查询）
  { pattern: /什么|多少|哪些|哪个|几|有没有|.*率|.*比例/, type: "what", priority: 2 },
];

/** 比较词识别 */
const COMPARE_PATTERN = /vs|对比|区别|哪个.*好|哪个.*强|比较|不同|差别|差异|和.*比|跟.*比/;

/** 预测词识别 */
const PREDICT_PATTERN = /会不会|将会|未来|下个赛季|下赛季|趋势|预测|会变|削弱|增强|加强|改版|下版本|下个版本/;

/** 修饰词识别（高级/最新/深度/全面等） */
const MODIFIER_KEYWORDS = /高级|进阶|最新|最全|深度|全面|详细|专业|新手|入门|基础|简单/;

/** 时间条件识别 */
const TEMPORAL_CONDITION = /202[0-9]年|20[2-9][0-9]年|上赛季|下赛季|本赛季|最近|近期|过去|将来|未来|本月|上月|这个月|今年|去年|明年|第[一二三四五六七八九十]+赛季/;

/** 量化条件识别 */
const QUANTITATIVE_CONDITION = /比例|排名|前[0-9]+|前[一二三四五六七八九十]+|占比|百分比|多少.*%|几个|多少次|多少.*次/;

// ============================================================================
// Step 3: 实体类型检测
// ============================================================================

function detectEntityType(entity: string | null): string | null {
  if (!entity) return null;
  // 根据实体名称判断类型
  if (WEAPON_NAME_MAP[entity.toLowerCase()] || Object.values(WEAPON_NAME_MAP).includes(entity)) {
    return "weapon";
  }
  if (MAP_NAME_MAP[entity.toLowerCase()] || Object.values(MAP_NAME_MAP).includes(entity)) {
    return "map";
  }
  if (GAME_NAME_MAP[entity.toLowerCase()]) {
    return "game";
  }
  return null;
}

// ============================================================================
// 主导出函数
// ============================================================================

/**
 * 对用户问题执行确定性标准化。
 * 纯函数，无副作用，不调用 LLM。
 */

/**
 * 游戏名称匹配（带词边界检查）。
 * 单字符中文关键词（如"瓦"=Valorant）需要检查是否被误匹配到其他词中（如"阿瓦隆"）。
 */
function matchGameName(query: string, key: string): boolean {
  if (!query.includes(key)) return false;

  // 多字符关键词直接匹配
  if (key.length > 1) return true;

  // 单字符关键词：检查上下文，避免误匹配到无关词中
  const idx = query.indexOf(key);
  const prevChar = idx > 0 ? query[idx - 1] : "";
  const nextChar = idx < query.length - 1 ? query[idx + 1] : "";

  // 中文字符范围
  const isCJK = (c: string) => /[一-鿿]/.test(c);

  // 仅当单字前后都是 CJK 字符时才需要检查（嵌在词中间）
  if (isCJK(key) && isCJK(prevChar) && isCJK(nextChar)) {
    // 提取包含该字的连续 CJK 子串，检查是否为已知非游戏词
    let start = idx;
    while (start > 0 && isCJK(query[start - 1]!)) start--;
    let end = idx;
    while (end < query.length - 1 && isCJK(query[end + 1]!)) end++;
    const surroundingWord = query.slice(start, end + 1);

    // 已知包含该单字但非射击游戏的词（如 "阿瓦隆" 中的 "瓦"）
    const knownFalsePositives = ["阿瓦隆", "千瓦", "瓦斯", "砖瓦"];
    if (knownFalsePositives.some((w) => surroundingWord.includes(w))) {
      return false;
    }
  }

  // 英文单字母/缩写：前后不能是英文字母
  if (/[a-zA-Z]/.test(key) && /[a-zA-Z]/.test(prevChar) && /[a-zA-Z]/.test(nextChar)) {
    return false;
  }

  return true;
}

export function normalizeQuery(rawQuery: string): CanonicalQuery {
  const q = rawQuery.trim();
  const qLower = q.toLowerCase();

  // --- Step 1: 实体词典匹配 ---

  // 1a. 游戏名称
  let game: string | null = null;
  for (const [key, value] of Object.entries(GAME_NAME_MAP)) {
    if (matchGameName(qLower, key)) {
      game = value;
      break;
    }
  }

  // 1b. 武器名称
  let entity: string | null = null;
  for (const [key, value] of Object.entries(WEAPON_NAME_MAP)) {
    if (qLower.includes(key)) {
      entity = value;
      break;
    }
  }

  // 1c. 地图名称（如果还没有实体）
  if (!entity) {
    for (const [key, value] of Object.entries(MAP_NAME_MAP)) {
      if (qLower.includes(key)) {
        entity = value;
        break;
      }
    }
  }

  // 1d. 意图（术语映射）
  let intent: string | null = null;
  for (const [key, value] of Object.entries(TERM_MAP)) {
    if (q.includes(key)) {
      intent = value;
      break;
    }
  }

  // --- Step 2: 规则模式匹配 ---

  // 2a. 问题类型
  let question_type: QuestionType = "what";
  const matchedRules = QUESTION_TYPE_RULES
    .filter((r) => r.pattern.test(q))
    .sort((a, b) => b.priority - a.priority);
  if (matchedRules.length > 0) {
    question_type = matchedRules[0]!.type;
  }

  // 2b. 领域判断
  const domain = determineDomain(q, game);

  // 2c. 主题推断
  const topic = inferTopic(intent, entity, question_type);

  return { domain, game, entity, topic, intent, question_type };
}

/**
 * 计算 Answerability Signature（V0.2 C3）。
 * 用于 Canonical Cache 中区分"标准化结果相同但可回答性不同"的问题。
 */
export function computeAnswerabilitySignature(
  canonical: CanonicalQuery,
  rawQuery: string,
): AnswerabilitySignature {
  return {
    domain: canonical.domain,
    game: canonical.game,
    entity: canonical.entity,
    topic: canonical.topic,
    intent: canonical.intent,
    question_type: canonical.question_type,
    entity_type: detectEntityType(canonical.entity),
    question_subtype: detectQuestionSubtype(rawQuery),
    has_modifier_keywords: MODIFIER_KEYWORDS.test(rawQuery),
    has_temporal_condition: TEMPORAL_CONDITION.test(rawQuery),
    has_quantitative_condition: QUANTITATIVE_CONDITION.test(rawQuery),
  };
}

/**
 * 将 AnswerabilitySignature 序列化为稳定的 JSON 字符串（用于 hash）。
 * 字段按固定顺序排列，确保确定性。
 */
export function signatureToString(sig: AnswerabilitySignature): string {
  return JSON.stringify({
    domain: sig.domain,
    game: sig.game,
    entity: sig.entity,
    topic: sig.topic,
    intent: sig.intent,
    question_type: sig.question_type,
    entity_type: sig.entity_type,
    question_subtype: sig.question_subtype,
    has_modifier_keywords: sig.has_modifier_keywords,
    has_temporal_condition: sig.has_temporal_condition,
    has_quantitative_condition: sig.has_quantitative_condition,
  });
}

// ============================================================================
// 辅助函数
// ============================================================================

function determineDomain(q: string, game: string | null): DomainType {
  const qLower = q.toLowerCase();

  // --- Step 1: 明确非游戏领域（天气/股票/编程/烹饪等）---
  const nonGameKeywords = [
    "天气", "下雨", "股票", "基金", "投资", "买房", "房价",
    "翻译", "总结", "写代码", "编程", "debug", "翻译成", "翻译为", "帮我写", "帮我做",
    "总结一下", "推荐股票", "推荐基金", "天气预报", "今天天气", "明天天气",
    "帮我查", "帮我搜", "搜索一下", "你是谁", "你能做什么", "你的功能",
    "做饭", "菜谱", "烹饪", "旅游", "景点", "酒店", "餐厅", "推荐一家",
    "音乐", "歌手", "歌曲", "电影", "电视剧", "综艺", "nba", "英超",
    "新闻", "政治", "选举", "经济", "求职", "邮件", "简历",
    "红烧肉", "iphone", "苹果股票",
    "咖啡", "喝茶", "美食", "拍照", "摄影", "相机",
    "高考", "考试", "练字", "药效", "看病", "吃药",
    "麻将", "德州", "poker", "围棋", "象棋",
    "电影院", "演唱会", "明星", "时尚", "化妆", "护肤", "健身", "减肥",
    // 饮食/生活闲聊
    "喜欢吃什么", "喜欢喝什么", "吃的什么", "口味", "味道",
    "零食", "奶茶", "火锅", "烧烤", "饮料", "外卖",
    "睡了吗", "在吗", "在干嘛", "吃了吗", "吃了没",
  ];
  for (const kw of nonGameKeywords) {
    if (qLower.includes(kw.toLowerCase())) return "non_game";
  }

  // --- Step 2: 明确其他游戏领域（非射击游戏）---
  // 必须不包含射击游戏引用
  const otherGameKeywords = [
    // MOBA / 类MOBA
    "王者荣耀", "英雄联盟", "lol", "dota", "dota2",
    // 二游 / 开放世界
    "原神", "崩坏", "星穹铁道", "崩铁", "绝区零", "zzz",
    "明日方舟", "阴阳师", "碧蓝航线", "碧蓝档案", "蔚蓝档案",
    "少女前线", "少前", "公主连结", "赛马娘",
    "幻塔", "鸣潮", "战双", "战双帕弥什", "深空之眼",
    "重返未来", "无期迷途", "尘白禁区",
    "永远的7日之都", "白夜极光", " nikke",
    // 乙女 / 恋爱
    "恋与制作人", "光与夜之恋", "未定事件簿", "乙女",
    // MMORPG
    "魔兽世界", "wow", "ff14", "最终幻想14", "剑网三", "逆水寒",
    // 沙盒 / 生存
    "我的世界", "minecraft", "roblox", "among us", "鹅鸭杀",
    // 休闲 / 派对
    "蛋仔派对", "动物森友会", "动森", "星露谷", "星露谷物语",
    "模拟人生", "sims", "光遇",
    // 格斗 / 动作
    "鬼泣", "dmc", "怪物猎人", "mhw",
    "塞尔达", "zelda", "宝可梦", "pokemon", "马里奥", "mario",
    // 策略 / 卡牌
    "炉石传说", "hearthstone", "云顶之弈", "tft",
    "文明", "civilization", "三国杀", "游戏王",
    "自走棋", "卡牌游戏",
    // 载具战斗（非FPS）
    "坦克世界", "战舰世界", "战争雷霆",
    // 体育 / 竞速
    "足球游戏", "篮球游戏", "nba2k", "fifa", "实况足球",
    "赛车游戏", "竞速游戏", "极品飞车",
    // 社交 / 派对
    "狼人杀", "剧本杀", "第五人格",
    // 游戏类型泛称（非射击类）
    "格斗游戏", "音游", "节奏游戏", "养成游戏", "放置游戏",
    "三消游戏", "跑酷游戏", "恐怖游戏", "解谜游戏",
    "乙女游戏", "街霸", "拳皇",
    // 二次元泛称
    "二游", "二次元游戏",
  ];

  // 射击游戏引用关键词
  const shootingRefKeywords = [
    "cs2", "csgo", "cs:go", "valorant", "瓦罗兰特", "无畏契约", "瓦",
    "pubg", "apex", "cod", "守望", "彩虹六号", "r6", "彩六",
    "战地", "bf", "穿越火线", "cf", "cfhd", "cfm",
    "三角洲", "暗区", "塔科夫", "fortnite", "堡垒之夜",
    "fps", "射击", "枪", "爆头", "压枪",
  ];

  const hasShootingRef = shootingRefKeywords.some((kw) => matchGameName(qLower, kw.toLowerCase()));

  for (const kw of otherGameKeywords) {
    if (matchGameName(qLower, kw.toLowerCase())) {
      // 如果同时提到射击游戏，仍然是射击游戏相关
      if (hasShootingRef) return "shooting_game";
      return "other_game";
    }
  }

  // --- Step 3: 射击游戏领域 ---
  if (game) return "shooting_game";

  const shootingKeywords = [
    "cs2", "csgo", "cs:go", "cs1.6", "cs 1.6",
    "valorant", "瓦罗兰特", "无畏契约", "瓦",
    "pubg", "绝地求生", "吃鸡",
    "apex", "apex英雄", "apex legends",
    "cod", "使命召唤", "call of duty",
    "overwatch", "守望先锋", "守望",
    "cf", "cfm", "cfhd", "穿越火线",
    "r6", "彩虹六号", "彩六", "rainbow six",
    "战地", "bf", "battlefield",
    "fortnite", "堡垒之夜",
    "destiny", "命运2",
    "warzone", "战区",
    "三角洲", "delta force", "三角洲行动",
    "暗区", "暗区突围", "arenabreakout",
    "萤火突击", "firefly",
    "deadlock", "死锁",
    "helldivers", "地狱潜兵",
    "the finals",
    "marvelrivals", "漫威争锋",
    "fps", "射击", "枪", "爆头", "压枪", "排位", "段位",
    "匹配", "kd", "kda", "adr", "rating",
    "后坐力", "弹道", "皮肤", "饰品", "手感", "枪感",
    "地图", "dust2", "mirage", "inferno", "nuke", "anubis",
    "ak", "ak47", "ak-47", "m4", "m4a4", "m4a1", "awp", "大狙",
    "deagle", "沙漠之鹰", "p90", "ump", "mp5", "mp7", "mp9",
    "vandal", "phantom", "operator", "spectre",
    "rush", "eco", "force buy", "save", "fake",
    "entry", "突破手", "awper", "狙击手", "igl", "指挥",
    "烟雾弹", "闪光弹", "手雷", "燃烧弹",
    "身法", "走位", "预瞄", "提前枪", "听声辨位",
    "单排", "组队", "开黑", "脚步", "听脚步", "进攻", "防守",
    "打游戏", "玩游戏", "游戏", "模式", "竞技模式", "排位模式", "休闲模式",
  ];
  for (const kw of shootingKeywords) {
    if (matchGameName(qLower, kw.toLowerCase())) return "shooting_game";
  }

  // --- Step 4: 默认 ambiguous ---
  // 不包含任何明确关键词，可能是游戏语境下的对话延续
  return "ambiguous";
}

function inferTopic(
  intent: string | null,
  entity: string | null,
  question_type: QuestionType,
): TopicType | null {
  // 基于 intent 推断 topic
  if (intent) {
    if (intent.startsWith("weapon_") || [
      "recoil_control", "headshot", "headshot_rate", "damage",
      "fire_rate", "reload", "reload_speed", "penetration",
      "magazine_capacity", "bullet_pattern", "wallbang",
      "gun_feel", "recoil",
    ].includes(intent)) {
      return "weapon";
    }
    if ([
      "usage_rate", "win_rate", "kda", "kd_ratio", "adr", "rating",
      "rank", "rank_distribution",
    ].includes(intent)) {
      return "weapon";
    }
    if (intent === "preference" || intent === "popularity") {
      return "player_preference";
    }
    if (intent === "motivation" || intent === "psychology" || intent === "reason") {
      return "player_behavior";
    }
    if (intent === "predict" || intent === "trend" || intent === "next_season" ||
        intent === "nerf_prediction" || intent === "buff_prediction") {
      return "meta";
    }
    if (intent === "balance" || intent === "meta") {
      return "meta";
    }
    if (intent === "team_play" || intent === "voice_chat" || intent === "guild" ||
        intent === "team" || intent === "clan") {
      return "player_behavior";
    }
    if (intent === "skin" || intent === "cosmetic" || intent === "battle_pass" ||
        intent === "pay_to_win" || intent === "monetization") {
      return "economy";
    }
    if (intent === "ranked" || intent === "casual" || intent === "deathmatch") {
      return "game_mode";
    }
    if (intent === "mechanic" || intent === "game_feel") {
      return "game_mechanic";
    }
    if (intent === "sound_awareness" || intent === "positioning" || intent === "movement") {
      return "player_behavior";
    }
    // 战术类
    if (["rush", "eco", "force_buy", "save_round", "fake", "rotate", "execute",
         "default_play", "entry_fragger", "awper", "igl", "support",
         "lurker", "anchor"].includes(intent)) {
      return "competitive";
    }
  }

  // 基于 entity 推断 topic
  if (entity) {
    if (Object.values(WEAPON_NAME_MAP).includes(entity)) return "weapon";
    if (Object.values(MAP_NAME_MAP).includes(entity)) return "map";
  }

  return null;
}

/** 射击游戏引用识别（用于区分"CS2 vs Valorant" vs "王者荣耀"） */
export function hasShootingGameReference(q: string): boolean {
  const qLower = q.toLowerCase();
  const shootingRefKeywords = [
    "cs2", "csgo", "cs:go", "cs1.6", "valorant", "瓦罗兰特", "无畏契约", "瓦",
    "pubg", "绝地求生", "吃鸡", "apex", "apex英雄", "cod", "使命召唤",
    "overwatch", "守望先锋", "守望", "cf", "cfm", "cfhd", "穿越火线",
    "r6", "彩虹六号", "彩六", "战地", "bf", "battlefield",
    "fortnite", "堡垒之夜", "destiny", "命运2", "warzone", "战区",
    "三角洲", "delta force", "暗区", "暗区突围", "arenabreakout",
    "deadlock", "死锁", "helldivers", "地狱潜兵", "the finals",
    "marvelrivals", "漫威争锋", "fps", "射击",
  ];
  return shootingRefKeywords.some((kw) => matchGameName(qLower, kw.toLowerCase()));
}

function detectQuestionSubtype(rawQuery: string): string | null {
  const q = rawQuery.trim();
  if (/高级|进阶|深度|专业|高端/.test(q)) return "advanced";
  if (/新手|入门|基础|简单|初学/.test(q)) return "basic";
  if (/全面|详细|完整|所有|全部|各种/.test(q)) return "comprehensive";
  if (/最新|最近|近期|当前/.test(q)) return "latest";
  return null;
}