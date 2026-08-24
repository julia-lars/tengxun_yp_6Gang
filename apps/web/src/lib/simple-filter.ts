// --------------------------------------------------------------
// 简洁筛选：3 道选择题的数据定义与映射
// 所有题均为硬筛选：同一题内多选 OR，跨题 AND
// Q1 多选（最多 3 个），Q2-Q3 单选
// --------------------------------------------------------------

export interface SimpleOption {
  key: string;
  label: string;
  hint?: string;
  /** 映射到的标签值（用于 API 硬筛选），为空表示不传标签 */
  tags?: string[];
}

export interface SimpleQuestion {
  id: "need" | "mode" | "pace";
  title: string;
  subtitle?: string;
  /** 是否多选（Q1 为 true） */
  multi?: boolean;
  /** 多选上限 */
  maxSelection?: number;
  options: SimpleOption[];
}

export const SIMPLE_QUESTIONS: SimpleQuestion[] = [
  {
    id: "need",
    title: "这位玩家玩游戏的核心理由是什么？",
    subtitle: "多选 · 最多 3 个 · 关键题",
    multi: true,
    maxSelection: 3,
    options: [
      {
        key: "compete",
        label: "变强与证明自己",
        hint: "练技术、上分、赢",
        tags: ["竞技证明"],
      },
      {
        key: "social",
        label: "和朋友一起玩",
        hint: "熟人开黑、团队配合",
        tags: ["社交归属"],
      },
      {
        key: "thrill",
        label: "追求爽感与刺激",
        hint: "枪感、击杀反馈",
        tags: ["射击爽感"],
      },
      {
        key: "relax",
        label: "放松解压",
        hint: "消磨时间、碎片化",
        tags: ["放松逃避"],
      },
      {
        key: "immerse",
        label: "沉浸体验与探索",
        hint: "世界观、剧情、收集",
        tags: ["探索收集"],
      },
    ],
  },
  {
    id: "mode",
    title: "这位玩家偏好什么玩法模式？",
    subtitle: "单选",
    options: [
      { key: "pvp", label: "PVP 对战为主", tags: ["PVP为主"] },
      { key: "pve", label: "PVE 合作为主", tags: ["PVE为主"] },
      { key: "both", label: "PVP/PVE 都玩", tags: ["PVP/PVE均衡"] },
      { key: "depends", label: "看情况" },
    ],
  },
  {
    id: "pace",
    title: "这位玩家偏好什么游戏节奏？",
    subtitle: "单选",
    options: [
      { key: "fast", label: "快节奏/刚枪拼反应", tags: ["主动求战/刚枪"] },
      { key: "mid", label: "中速/灵活切换", tags: ["灵活平衡"] },
      { key: "slow", label: "慢节奏/策略思考", tags: ["苟活避战"] },
      { key: "unknown", label: "不确定" },
    ],
  },
];

export type SimpleFilterId = SimpleQuestion["id"];

/** URL 参数值：单选为 "key"，多选为 "key1,key2" */
export type SimpleFilterValue = Partial<Record<SimpleFilterId, string>>;

/** 根据问题 ID 和选项 key 获取对应标签值列表 */
export function tagsForOption(questionId: string, optionKey: string): string[] {
  const question = SIMPLE_QUESTIONS.find((q) => q.id === questionId);
  if (!question) return [];
  const option = question.options.find((o) => o.key === optionKey);
  return option?.tags ?? [];
}

/**
 * 构建简洁筛选的 API 查询字符串。
 * 格式：用 | 分隔题组（AND），, 分隔组内选项（OR）。
 * 例：竞技证明,射击爽感|陌生人/单人|PVP为主|主动求战/刚枪|进阶
 */
export function buildSimpleQuery(value: SimpleFilterValue): string {
  const groups: string[] = [];
  for (const q of SIMPLE_QUESTIONS) {
    const raw = value[q.id];
    if (!raw) continue;
    const keys = raw.split(",").filter(Boolean);
    const groupTags: string[] = [];
    for (const key of keys) {
      groupTags.push(...tagsForOption(q.id, key));
    }
    if (groupTags.length > 0) {
      groups.push(groupTags.join(","));
    }
  }
  return groups.join("|");
}

/** 获取所有简洁筛选标签值（扁平数组，用于 UI 判断如 noMatch） */
export function getAllSimpleTags(value: SimpleFilterValue): string[] {
  const tags: string[] = [];
  for (const [questionId, raw] of Object.entries(value)) {
    if (!raw) continue;
    const keys = raw.split(",").filter(Boolean);
    for (const key of keys) {
      tags.push(...tagsForOption(questionId, key));
    }
  }
  return tags;
}

/** 解析多选值为 Set，方便判断是否选中 */
export function parseMultiValue(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").filter(Boolean));
}