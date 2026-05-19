// id → 用户可读的流程中文名（唯一来源；pipeline 页和 Inspector 共用）

export const SKILL_DISPLAY_NAME: Record<string, string> = {
  '01': '调研',
  '02': '选品',
  '03': '品牌识别',
  '04': '素材工厂',
  '05': '建站',
  '06': '追踪',
  '07a': '技术 SEO',
  '07b': '内容营销',
  '08': '投流',
  '09': '优化',
  '03b': '法务包',
  '04b': '社交证明',
  '05b': '商家中台',
  '11b': '客服',
  '13': '数据模型',
};

export function skillDisplayName(id: string, fallback?: string): string {
  return SKILL_DISPLAY_NAME[id] ?? fallback ?? id;
}
