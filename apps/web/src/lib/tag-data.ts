// 标签体系数据 — 对齐标签体系产品方案 v1.0
// 包含 5 个主维度、互斥规则、扩展维度

export interface TagOption {
  value: string;
  label: string;
  description?: string;
}

export interface TagDimension {
  name: string;
  label: string;
  type: "multi" | "single" | "segmented" | "platform" | "mode";
  groups?: { name: string; label: string; options: TagOption[] }[];
  options?: TagOption[];
  maxSelection?: number;
  segmentedAxes?: {
    name: string;
    label: string;
    options: TagOption[];
  }[];
}

export interface ExclusionRule {
  tags: string[];
  message: string;
}

// ---- 互斥规则 ----
export const EXCLUSION_RULES: ExclusionRule[] = [
  { tags: ["纯PVE", "PVP为主"], message: "纯PVE玩家与PVP为主模式互斥" },
  { tags: ["纯PVE", "纯PVP"], message: "纯PVE与纯PVP互斥" },
  { tags: ["PVE为主", "纯PVP"], message: "PVE为主与纯PVP互斥" },
  { tags: ["纯PVP", "PVE为主"], message: "纯PVP与PVE为主互斥" },
  { tags: ["苟活避战", "主动求战/刚枪"], message: "战斗倾向轴两端互斥，请选择一端或中间态" },
  { tags: ["仔细思考/策略", "本能快速反应"], message: "决策方式轴两端互斥，请选择一端或中间态" },
  { tags: ["团队协作取胜", "个人能力取胜"], message: "取胜方式轴两端互斥，请选择一端或中间态" },
  { tags: ["数值养成", "操作技巧对抗"], message: "成长方式轴两端互斥" },
  { tags: ["熟人开黑", "陌生人/单人"], message: "社交方式轴两端互斥" },
];

// ---- 五个主维度 ----
export const TAG_DIMENSIONS: TagDimension[] = [
  {
    name: "诉求",
    label: "游戏诉求",
    type: "multi",
    maxSelection: 3,
    options: [
      { value: "能力成长", label: "能力成长", description: "重视练习、变强、掌握技巧和自我突破" },
      { value: "竞技证明", label: "竞技证明", description: "通过胜利、段位或击败强者证明自己" },
      { value: "支配优越", label: "支配优越", description: "享受压制、碾压和高于他人的优越感" },
      { value: "团队协作", label: "团队协作", description: "乐趣来自共同完成挑战和配合取胜" },
      { value: "社交归属", label: "社交归属", description: "游戏用于维持朋友关系或进入圈层" },
      { value: "射击爽感", label: "射击爽感", description: "追求射击、破坏、速度和即时刺激" },
      { value: "放松逃避", label: "放松逃避", description: "解压、消磨时间、从现实压力中抽离" },
      { value: "策略掌控", label: "策略掌控", description: "喜欢分析、布局、资源与局势判断" },
      { value: "探索收集", label: "探索收集", description: "喜欢发现内容、组合、地图和收集物" },
      { value: "叙事沉浸", label: "叙事沉浸", description: "被世界观、角色和故事吸引" },
      { value: "视听审美", label: "视听审美", description: "主要受画面、音效、动作和风格吸引" },
      { value: "表达创造", label: "表达创造", description: "重视外观定制、建造、UGC和自我表达" },
    ],
  },
  {
    name: "能力",
    label: "游戏能力",
    type: "single",
    groups: [
      {
        name: "level",
        label: "综合等级",
        options: [
          { value: "新手", label: "新手", description: "尚未稳定掌握规则和基础操作" },
          {
            value: "入门",
            label: "入门",
            description: "能完成对局，但枪法、信息或决策仍明显不稳定",
          },
          { value: "进阶", label: "进阶", description: "有稳定主玩产品和基本技巧，能自我诊断短板" },
          { value: "高手", label: "高手", description: "多项技巧稳定、理解版本和战术" },
          {
            value: "专家/竞技级",
            label: "专家/竞技级",
            description: "高段位、赛事或半职业证据充分",
          },
          { value: "未知", label: "未知", description: "只有自称，没有行为、段位或他人评价支撑" },
        ],
      },
      {
        name: "strengths",
        label: "技巧强项（最多3个）",
        options: [
          { value: "枪法", label: "枪法" },
          { value: "身法", label: "身法" },
          { value: "信息获取", label: "信息获取" },
          { value: "战场策略", label: "战场策略" },
          { value: "品类知识", label: "品类知识" },
        ],
      },
      {
        name: "weaknesses",
        label: "技巧短板（最多3个）",
        options: [
          { value: "枪法", label: "枪法" },
          { value: "身法", label: "身法" },
          { value: "信息获取", label: "信息获取" },
          { value: "战场策略", label: "战场策略" },
          { value: "品类知识", label: "品类知识" },
        ],
      },
    ],
  },
  {
    name: "风格",
    label: "游戏风格",
    type: "segmented",
    segmentedAxes: [
      {
        name: "combat",
        label: "战斗倾向",
        options: [
          { value: "苟活避战", label: "苟活避战" },
          { value: "灵活平衡", label: "灵活平衡" },
          { value: "主动求战/刚枪", label: "主动求战/刚枪" },
        ],
      },
      {
        name: "decision",
        label: "决策方式",
        options: [
          { value: "仔细思考/策略", label: "仔细思考/策略" },
          { value: "情境切换", label: "情境切换" },
          { value: "本能快速反应", label: "本能快速反应" },
        ],
      },
      {
        name: "victory",
        label: "取胜方式",
        options: [
          { value: "团队协作取胜", label: "团队协作取胜" },
          { value: "团队个人平衡", label: "团队个人平衡" },
          { value: "个人能力取胜", label: "个人能力取胜" },
        ],
      },
      {
        name: "growth",
        label: "成长方式",
        options: [
          { value: "数值养成", label: "数值养成" },
          { value: "混合", label: "混合" },
          { value: "操作技巧对抗", label: "操作技巧对抗" },
        ],
      },
      {
        name: "social",
        label: "社交方式",
        options: [
          { value: "熟人开黑", label: "熟人开黑" },
          { value: "均可", label: "均可" },
          { value: "陌生人/单人", label: "陌生人/单人" },
        ],
      },
    ],
  },
  {
    name: "平台",
    label: "平台偏好",
    type: "platform",
    groups: [
      {
        name: "primary",
        label: "主选平台",
        options: [
          { value: "PC", label: "PC" },
          { value: "主机", label: "主机" },
          { value: "手机", label: "手机" },
          { value: "多平台均衡", label: "多平台均衡" },
          { value: "云游戏/其他", label: "云游戏/其他" },
          { value: "未知", label: "未知" },
        ],
      },
      {
        name: "secondary",
        label: "次选平台",
        options: [
          { value: "PC", label: "PC" },
          { value: "主机", label: "主机" },
          { value: "手机", label: "手机" },
          { value: "多平台均衡", label: "多平台均衡" },
          { value: "云游戏/其他", label: "云游戏/其他" },
          { value: "无", label: "无" },
        ],
      },
    ],
  },
  {
    name: "模式",
    label: "模式偏好",
    type: "mode",
    groups: [
      {
        name: "structure",
        label: "主结构",
        options: [
          { value: "纯PVE", label: "纯PVE" },
          { value: "PVE为主", label: "PVE为主" },
          { value: "PVP/PVE均衡", label: "PVP/PVE均衡" },
          { value: "PVP为主", label: "PVP为主" },
          { value: "纯PVP", label: "纯PVP" },
          { value: "随场景变化", label: "随场景变化" },
        ],
      },
      {
        name: "submodes",
        label: "二级模式（点击切换：未表态→喜欢→回避→未表态）",
        options: [
          { value: "团队竞技", label: "团队竞技" },
          { value: "爆破", label: "爆破" },
          { value: "BR/战术竞技", label: "BR/战术竞技" },
          { value: "搜打撤", label: "搜打撤" },
          { value: "大战场", label: "大战场" },
          { value: "合作PVE", label: "合作PVE" },
          { value: "剧情PVE", label: "剧情PVE" },
          { value: "Boss/刷装", label: "Boss/刷装" },
          { value: "娱乐模式", label: "娱乐模式" },
          { value: "开放世界", label: "开放世界" },
        ],
      },
    ],
  },
];

// ---- 扩展维度 ----
export const EXTENDED_DIMENSIONS: TagDimension[] = [
  {
    name: "客观属性",
    label: "客观属性",
    type: "multi",
    groups: [
      {
        name: "city",
        label: "城市等级",
        options: [
          { value: "一线/新一线", label: "一线/新一线" },
          { value: "二线", label: "二线" },
          { value: "三线及以下", label: "三线及以下" },
          { value: "海外", label: "海外" },
          { value: "未知", label: "未知" },
        ],
      },
      {
        name: "lifeStage",
        label: "生活阶段",
        options: [
          { value: "学生", label: "学生" },
          { value: "初入职场", label: "初入职场" },
          { value: "稳定职场", label: "稳定职场" },
          { value: "育儿家庭", label: "育儿家庭" },
        ],
      },
    ],
  },
  {
    name: "游戏资产",
    label: "游戏资产",
    type: "segmented",
    segmentedAxes: [
      {
        name: "time",
        label: "时间",
        options: [
          { value: "时间充足", label: "充足" },
          { value: "时间有约束", label: "有约束" },
          { value: "时间严重稀缺", label: "严重稀缺" },
          { value: "时间未知", label: "未知" },
        ],
      },
      {
        name: "ability",
        label: "能力",
        options: [
          { value: "能力充足", label: "充足" },
          { value: "能力有约束", label: "有约束" },
          { value: "能力严重稀缺", label: "严重稀缺" },
          { value: "能力未知", label: "未知" },
        ],
      },
      {
        name: "energy",
        label: "精力",
        options: [
          { value: "精力充足", label: "充足" },
          { value: "精力有约束", label: "有约束" },
          { value: "精力严重稀缺", label: "严重稀缺" },
          { value: "精力未知", label: "未知" },
        ],
      },
      {
        name: "emotion",
        label: "情绪",
        options: [
          { value: "情绪充足", label: "充足" },
          { value: "情绪有约束", label: "有约束" },
          { value: "情绪严重稀缺", label: "严重稀缺" },
          { value: "情绪未知", label: "未知" },
        ],
      },
      {
        name: "money",
        label: "金钱",
        options: [
          { value: "金钱充足", label: "充足" },
          { value: "金钱有约束", label: "有约束" },
          { value: "金钱严重稀缺", label: "严重稀缺" },
          { value: "金钱未知", label: "未知" },
        ],
      },
    ],
  },
  {
    name: "产品偏好",
    label: "产品与玩法偏好",
    type: "multi",
    groups: [
      {
        name: "theme",
        label: "题材",
        options: [
          { value: "现代军事", label: "现代军事" },
          { value: "历史战争", label: "历史战争" },
          { value: "近未来科幻", label: "近未来科幻" },
          { value: "末日废土", label: "末日废土" },
          { value: "奇幻/二次元", label: "奇幻/二次元" },
          { value: "恐怖", label: "恐怖" },
        ],
      },
      {
        name: "artStyle",
        label: "美术",
        options: [
          { value: "高写实", label: "高写实" },
          { value: "半写实", label: "半写实" },
          { value: "风格化", label: "风格化" },
          { value: "卡通/Q版", label: "卡通/Q版" },
          { value: "二次元", label: "二次元" },
        ],
      },
      {
        name: "perspective",
        label: "视角",
        options: [
          { value: "FPS", label: "FPS" },
          { value: "TPS", label: "TPS" },
          { value: "自由切换", label: "自由切换" },
        ],
      },
    ],
  },
  {
    name: "商业化",
    label: "商业化与付费",
    type: "multi",
    groups: [
      {
        name: "payLevel",
        label: "付费水平",
        options: [
          { value: "不付费", label: "不付费" },
          { value: "低付费", label: "低付费" },
          { value: "中付费", label: "中付费" },
          { value: "高付费", label: "高付费" },
          { value: "未知", label: "未知" },
        ],
      },
      {
        name: "fairness",
        label: "公平边界",
        options: [
          { value: "仅外观可接受", label: "仅外观可接受" },
          { value: "轻度便利可接受", label: "轻度便利可接受" },
          { value: "数值付费可接受", label: "数值付费可接受" },
          { value: "任何优势都拒绝", label: "任何优势都拒绝" },
        ],
      },
    ],
  },
  {
    name: "内容营销",
    label: "内容与营销",
    type: "multi",
    groups: [
      {
        name: "channel",
        label: "信息渠道",
        options: [
          { value: "B站", label: "B站" },
          { value: "抖音/短视频", label: "抖音/短视频" },
          { value: "直播", label: "直播" },
          { value: "朋友口碑", label: "朋友口碑" },
          { value: "应用商店", label: "应用商店" },
          { value: "社区/论坛", label: "社区/论坛" },
          { value: "媒体", label: "媒体" },
        ],
      },
      {
        name: "contentType",
        label: "内容偏好",
        options: [
          { value: "技术教学", label: "技术教学" },
          { value: "搞笑整活", label: "搞笑整活" },
          { value: "深度评测", label: "深度评测" },
          { value: "电竞", label: "电竞" },
          { value: "高光实机", label: "高光实机" },
          { value: "CG", label: "CG" },
          { value: "UGC", label: "UGC" },
        ],
      },
    ],
  },
];

// ---- 工具函数 ----

/** 获取所有互斥标签对 */
export function getExcludedTags(selectedTag: string): string[] {
  const excluded: string[] = [];
  for (const rule of EXCLUSION_RULES) {
    if (rule.tags.includes(selectedTag)) {
      excluded.push(...rule.tags.filter((t) => t !== selectedTag));
    }
  }
  return excluded;
}

/** 获取互斥原因 */
export function getExclusionMessage(tagA: string, tagB: string): string | null {
  for (const rule of EXCLUSION_RULES) {
    if (rule.tags.includes(tagA) && rule.tags.includes(tagB)) {
      return rule.message;
    }
  }
  return null;
}

/** 获取所有被禁用的标签 */
export function getDisabledTags(selectedTags: string[]): Set<string> {
  const disabled = new Set<string>();
  for (const tag of selectedTags) {
    for (const excluded of getExcludedTags(tag)) {
      disabled.add(excluded);
    }
  }
  return disabled;
}

/** 检查标签组合是否合法 */
export function isValidCombination(selectedTags: string[]): string | null {
  for (const rule of EXCLUSION_RULES) {
    const conflicts = rule.tags.filter((t) => selectedTags.includes(t));
    if (conflicts.length >= 2) {
      return rule.message;
    }
  }
  return null;
}

// ---- 工具：将维度值展平为统一 options 列表 ----

export function flattenOptions(dim: TagDimension): TagOption[] {
  const seen = new Set<string>();
  const result: TagOption[] = [];
  const sources: TagOption[][] = [];
  if (dim.options) sources.push(dim.options);
  if (dim.groups) sources.push(...dim.groups.map((g) => g.options));
  if (dim.segmentedAxes) sources.push(...dim.segmentedAxes.map((a) => a.options));
  for (const opts of sources) {
    for (const o of opts) {
      if (!seen.has(o.value)) {
        seen.add(o.value);
        result.push(o);
      }
    }
  }
  return result;
}
