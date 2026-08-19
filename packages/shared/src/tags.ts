// 标签维度定义 — 前后端共享的唯一数据源
// 后端 /api/tags 返回此数据，前端 tag-data.ts 在此基础之上扩展 UI 逻辑
import { z } from 'zod';

// ---- 基础类型 ----

export const tagOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type TagOption = z.infer<typeof tagOptionSchema>;

export const tagDimensionSchema = z.object({
  name: z.string(),
  label: z.string(),
  values: z.array(tagOptionSchema),
});
export type TagDimensionDef = z.infer<typeof tagDimensionSchema>;

// ---- 五个主维度（与标签体系产品方案 v1.0 对齐）----

export const TAG_DIMENSIONS: TagDimensionDef[] = [
  {
    name: '诉求',
    label: '游戏诉求',
    values: [
      { value: '能力成长', label: '能力成长', description: '重视练习、变强、掌握技巧和自我突破' },
      { value: '竞技证明', label: '竞技证明', description: '通过胜利、段位或击败强者证明自己' },
      { value: '支配优越', label: '支配优越', description: '享受压制、碾压和高于他人的优越感' },
      { value: '团队协作', label: '团队协作', description: '乐趣来自共同完成挑战和配合取胜' },
      { value: '社交归属', label: '社交归属', description: '游戏用于维持朋友关系或进入圈层' },
      { value: '射击爽感', label: '射击爽感', description: '追求射击、破坏、速度和即时刺激' },
      { value: '放松逃避', label: '放松逃避', description: '解压、消磨时间、从现实压力中抽离' },
      { value: '策略掌控', label: '策略掌控', description: '喜欢分析、布局、资源与局势判断' },
      { value: '探索收集', label: '探索收集', description: '喜欢发现内容、组合、地图和收集物' },
      { value: '叙事沉浸', label: '叙事沉浸', description: '被世界观、角色和故事吸引' },
      { value: '视听审美', label: '视听审美', description: '主要受画面、音效、动作和风格吸引' },
      { value: '表达创造', label: '表达创造', description: '重视外观定制、建造、UGC和自我表达' },
    ],
  },
  {
    name: '能力',
    label: '游戏能力',
    values: [
      { value: '新手', label: '新手', description: '尚未稳定掌握规则和基础操作' },
      { value: '入门', label: '入门', description: '能完成对局，但枪法、信息或决策仍明显不稳定' },
      { value: '进阶', label: '进阶', description: '有稳定主玩产品和基本技巧，能自我诊断短板' },
      { value: '高手', label: '高手', description: '多项技巧稳定、理解版本和战术' },
      { value: '专家/竞技级', label: '专家/竞技级', description: '高段位、赛事或半职业证据充分' },
      { value: '未知', label: '未知', description: '只有自称，没有行为、段位或他人评价支撑' },
    ],
  },
  {
    name: '风格',
    label: '游戏风格',
    values: [
      { value: '主动求战/刚枪', label: '主动求战/刚枪' },
      { value: '灵活平衡', label: '灵活平衡' },
      { value: '苟活避战', label: '苟活避战' },
      { value: '本能快速反应', label: '本能快速反应' },
      { value: '情境切换', label: '情境切换' },
      { value: '仔细思考/策略', label: '仔细思考/策略' },
      { value: '个人能力取胜', label: '个人能力取胜' },
      { value: '团队个人平衡', label: '团队个人平衡' },
      { value: '团队协作取胜', label: '团队协作取胜' },
      { value: '数值养成', label: '数值养成' },
      { value: '混合', label: '混合' },
      { value: '操作技巧对抗', label: '操作技巧对抗' },
      { value: '熟人开黑', label: '熟人开黑' },
      { value: '均可', label: '均可' },
      { value: '陌生人/单人', label: '陌生人/单人' },
    ],
  },
  {
    name: '平台',
    label: '平台偏好',
    values: [
      { value: 'PC', label: 'PC' },
      { value: '主机', label: '主机' },
      { value: '手机', label: '手机' },
      { value: '多平台均衡', label: '多平台均衡' },
      { value: '云游戏/其他', label: '云游戏/其他' },
      { value: '未知', label: '未知' },
    ],
  },
  {
    name: '模式',
    label: '游戏模式',
    values: [
      { value: '纯PVE', label: '纯PVE' },
      { value: 'PVE为主', label: 'PVE为主' },
      { value: 'PVP/PVE均衡', label: 'PVP/PVE均衡' },
      { value: 'PVP为主', label: 'PVP为主' },
      { value: '纯PVP', label: '纯PVP' },
      { value: '随场景变化', label: '随场景变化' },
    ],
  },
];

// ---- 类型帮助 ----

/** 根据维度名获取维度定义 */
export function getDimension(name: string): TagDimensionDef | undefined {
  return TAG_DIMENSIONS.find((d) => d.name === name);
}

/** 获取所有标签值（扁平化） */
export function getAllTagValues(): string[] {
  return TAG_DIMENSIONS.flatMap((d) => d.values.map((v) => v.value));
}
