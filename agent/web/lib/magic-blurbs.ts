// Static copy used by the Magic Mouse hover-tooltip mode.
// Values are deliberately one-sentence Chinese — they target users who have
// never used the app before. Keep terminology consistent with the rest of the UI.

export const SKILL_BLURBS: Record<string, string> = {
  '01': '01 选题：定 logline、平台/时长画像、对标账号、目标受众',
  '02': '02 剧本：把 logline 拆成 scenes + 对白 + 节拍 + 镜头建议',
  '03': '03 资产：锁定角色/场景/道具 + Style Bible，供下游强引用',
  '04': '04 分镜首帧：切镜头并为每个 shot 生成首帧图',
  '05': '05 视频生成：用首帧调视频 API 出片段，拼 preview.mp4',
  '06': '06 音频（Phase 2）：对白 TTS + 音效 + 配乐',
  '07': '07 剪辑（Phase 2）：调色 + 超分 + 合规标识',
  '08': '08 分发（Phase 2）：发布 + 投流 + 本地化',
  '09': '09 数据回流（Phase 2）：拉播放数据归因，反馈给选题/剧本',
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
  pipeline: '流程：右侧 mini 视图，看 9 个 skill 当前各是什么状态（06-09 为 Phase 2）',
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
