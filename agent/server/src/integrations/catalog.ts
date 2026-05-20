// 静态 API 接入目录。"connected" 由 env vars 是否设置推断 —
// 任意一个声明的 env var 非空即视为已接入（MVP，未来可换 oauth 凭证表）。

export type IntegrationPriority = 'required' | 'recommended' | 'optional';

export interface IntegrationDef {
  id: string;
  name: string;
  category: string;
  description: string;
  /** 上游 / 下游会用到这个 API 的 skill id 列表（参考 README 流程图）*/
  used_by_skills: string[];
  /** 任意一个非空即视为 connected。空数组 = 永远 not connected（仅作展示）*/
  env_vars: string[];
  docs_url?: string;
  priority: IntegrationPriority;
}

export interface IntegrationStatus extends IntegrationDef {
  connected: boolean;
  /** 实际命中的 env var；用于排错（不暴露 value） */
  detected_env_vars: string[];
}

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  // ─── LLM + T2I (必填) ──────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'LLM / 图像',
    priority: 'required',
    description: 'GPT 系列做对话编排 + 所有 skill 推理；gpt-image-1 做 03 资产 / 04 首帧的 T2I。',
    used_by_skills: ['01', '02', '03', '04', '05'],
    env_vars: ['OPENAI_API_KEY'],
    docs_url: 'https://platform.openai.com/api-keys',
  },

  // ─── 视频生成 (05 用，至少配一个) ───────────────────────────────
  {
    id: 'kling',
    name: 'Kling',
    category: '视频生成',
    priority: 'recommended',
    description: '05 视频生成的候选 provider（首尾帧模式最稳）。AISD_VIDEO_PROVIDER=kling 时启用。',
    used_by_skills: ['05'],
    env_vars: ['KLING_API_KEY'],
    docs_url: 'https://app.klingai.com/',
  },
  {
    id: 'runway',
    name: 'Runway',
    category: '视频生成',
    priority: 'optional',
    description: '05 视频生成候选（Gen-3，质量高）。AISD_VIDEO_PROVIDER=runway 时启用。',
    used_by_skills: ['05'],
    env_vars: ['RUNWAY_API_KEY'],
    docs_url: 'https://docs.dev.runwayml.com/',
  },
  {
    id: 'vidu',
    name: 'Vidu',
    category: '视频生成',
    priority: 'optional',
    description: '05 视频生成候选（支持首尾帧，国内可选）。',
    used_by_skills: ['05'],
    env_vars: ['VIDU_API_KEY'],
    docs_url: 'https://www.vidu.com/',
  },
  {
    id: 'minimax',
    name: 'MiniMax / Hailuo',
    category: '视频生成',
    priority: 'optional',
    description: '05 视频生成候选（Hailuo / video-01）。',
    used_by_skills: ['05'],
    env_vars: ['MINIMAX_API_KEY', 'HAILUO_API_KEY'],
    docs_url: 'https://www.minimax.chat/',
  },

  // ─── Phase 2 预留 (06 音频 / 08 分发) ───────────────────────────
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'Phase 2 · TTS',
    priority: 'optional',
    description: '06 音频：对白 TTS / 配音克隆。',
    used_by_skills: ['06'],
    env_vars: ['ELEVENLABS_API_KEY'],
    docs_url: 'https://elevenlabs.io/docs',
  },
  {
    id: 'suno',
    name: 'Suno',
    category: 'Phase 2 · 配乐',
    priority: 'optional',
    description: '06 音频：BGM / 配乐生成。',
    used_by_skills: ['06'],
    env_vars: ['SUNO_API_KEY'],
    docs_url: 'https://suno.com/',
  },
  {
    id: 'douyin-open',
    name: '抖音开放平台',
    category: 'Phase 2 · 分发',
    priority: 'optional',
    description: '08 分发：发布到抖音 + 拉播放数据回流给 09。',
    used_by_skills: ['08', '09'],
    env_vars: ['DOUYIN_ACCESS_TOKEN'],
    docs_url: 'https://developer.open-douyin.com/',
  },
  {
    id: 'youtube-data',
    name: 'YouTube Data API',
    category: 'Phase 2 · 分发',
    priority: 'optional',
    description: '08 分发：发布到 YouTube Shorts + 09 拉指标。',
    used_by_skills: ['08', '09'],
    env_vars: ['YOUTUBE_API_KEY', 'YOUTUBE_OAUTH_CREDENTIALS'],
    docs_url: 'https://developers.google.com/youtube/v3',
  },
];

export function getIntegrationStatuses(): IntegrationStatus[] {
  return INTEGRATION_CATALOG.map((def) => {
    const detected = def.env_vars.filter((k) => {
      const v = process.env[k];
      return typeof v === 'string' && v.trim().length > 0;
    });
    return {
      ...def,
      connected: detected.length > 0,
      detected_env_vars: detected,
    };
  });
}
