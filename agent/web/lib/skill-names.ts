// id → 用户可读的流程中文名（唯一来源；pipeline 页和 Inspector 共用）

export const SKILL_DISPLAY_NAME: Record<string, string> = {
  '01': '选题',
  '02': '剧本',
  '03': '资产',
  '04': '分镜首帧',
  '05': '视频生成',
  '06': '音频',
  '07': '剪辑',
  '08': '分发',
  '09': '数据回流',
};

export function skillDisplayName(id: string, fallback?: string): string {
  return SKILL_DISPLAY_NAME[id] ?? fallback ?? id;
}
