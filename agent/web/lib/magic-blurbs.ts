// Static copy used by the Magic Mouse hover-tooltip mode.
// Values are deliberately one-sentence Chinese — they target users who have
// never used the app before. Keep terminology consistent with the rest of the UI.

export const SKILL_BLURBS: Record<string, string> = {
  '01': '01 市场调研：找出要做的赛道、用户痛点、竞品和机会方向',
  '02': '02 选品：从调研结果里筛出 1-3 个具体 SKU + 定价区间',
  '03': '03 品牌识别：定品牌名、视觉风格、调性 / tone of voice',
  '03b': '03b 素材工厂：把品牌识别落成可复用的图片/banner/产品图素材',
  '04': '04 建站：生成站点骨架（首页 / 产品页 / 关于）+ 模板化文案',
  '04b': '04b 建站补充：扩展页面、组件、表单等',
  '05': '05 追踪埋点：装 GA / Pixel / 自有事件，让后面的投放能复盘',
  '05b': '05b 追踪补充：补充 server-side 事件、转化目标',
  '06': '06 SEO + 内容：技术 SEO + 博客内容规划',
  '07a': '07a 技术 SEO：站点结构、meta、sitemap、性能',
  '07b': '07b 内容营销：博客主题、关键词、节奏',
  '08': '08 投流：选平台、试投、优化 ROAS',
  '09': '09 持续优化：根据数据迭代页面 / 文案 / 投放',
  '11b': '11b 履约/客服：订单后续流程',
  '13': '13 邮件 / CRM：留存、复购、生命周期营销',
};

export const STATUS_BLURBS: Record<string, string> = {
  pending: '正在跑（进行中）',
  valid: '跑完了，output.json 通过 schema 校验',
  synthetic: '上游缺失，agent 自动塞了占位假数据继续跑（结果仅供参考）',
  invalid: '跑完了，但 output.json 不符合 schema',
  missing: '还没跑过',
};

export const INSPECTOR_TAB_BLURBS = {
  tasks: '任务：当前对话里 agent 自己列出的 todo / 子任务',
  tools: '工具调用：每一步 agent 调了什么工具、传了什么参数、返回什么',
  pipeline: '流程：右侧 mini 视图，看 9 个核心 skill 当前各是什么状态',
} as const;

export const PRIORITY_BLURBS: Record<string, string> = {
  required: '必填：不接这个就没法用整套流程',
  recommended: '推荐：接了体验完整不少',
  optional: '可选：按需接，不影响主流程',
};

/** Compose a Magic Mouse blurb for a skill node in the pipeline graph. */
export function skillNodeBlurb(skillId: string, statusKey: string): string {
  const skill = SKILL_BLURBS[skillId] ?? `${skillId}：（未提供说明）`;
  const status = STATUS_BLURBS[statusKey] ?? statusKey;
  return `${skill}\n当前状态：${status}`;
}
