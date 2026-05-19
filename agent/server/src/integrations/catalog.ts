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
  // ─── LLM (必填，已经接入) ──────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'LLM',
    priority: 'required',
    description: 'GPT 系列模型，所有 skill 推理 + L3 distillation 都依赖它。',
    used_by_skills: ['01', '02', '03', '04', '05', '06', '07a', '07b', '08', '09'],
    env_vars: ['OPENAI_API_KEY'],
    docs_url: 'https://platform.openai.com/api-keys',
  },

  // ─── 追踪 / Analytics ──────────────────────────────────────────
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    category: '追踪',
    priority: 'required',
    description: '06 追踪写入 GTM 容器 ID；05 建站为 GTM/consent 留 placeholder。',
    used_by_skills: ['05', '06'],
    env_vars: ['GTM_CONTAINER_ID'],
    docs_url: 'https://tagmanager.google.com/',
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    category: '追踪',
    priority: 'recommended',
    description: '06 把 13 个事件接入 GA4；09 优化拉 GA4 数据做诊断 + 实验。',
    used_by_skills: ['06', '09'],
    env_vars: ['GA4_PROPERTY_ID', 'GA4_MEASUREMENT_ID'],
    docs_url: 'https://analytics.google.com/',
  },
  {
    id: 'gsc',
    name: 'Google Search Console',
    category: 'SEO',
    priority: 'recommended',
    description: '07a 技术 SEO 拉索引/CWV/查询数据。',
    used_by_skills: ['07a'],
    env_vars: ['GSC_PROPERTY_URL', 'GSC_OAUTH_CREDENTIALS'],
    docs_url: 'https://developers.google.com/webmaster-tools',
  },

  // ─── 投流 ──────────────────────────────────────────────────────
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    category: '投流',
    priority: 'recommended',
    description: '08 投流账户结构 + 受众；09 优化拉 Meta 广告报表。',
    used_by_skills: ['08', '09'],
    env_vars: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
    docs_url: 'https://developers.facebook.com/docs/marketing-apis',
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    category: '投流',
    priority: 'recommended',
    description: '08 + 09 拉搜索 / PMax / 购物广告报表。',
    used_by_skills: ['08', '09'],
    env_vars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
    docs_url: 'https://developers.google.com/google-ads/api/docs/start',
  },
  {
    id: 'tiktok-ads',
    name: 'TikTok Ads',
    category: '投流',
    priority: 'optional',
    description: '08 / 09 短视频广告账户结构 + 报表。',
    used_by_skills: ['08', '09'],
    env_vars: ['TIKTOK_ACCESS_TOKEN'],
    docs_url: 'https://business-api.tiktok.com/portal/docs',
  },

  // ─── 商务 (订单 / 支付 / 库存) ──────────────────────────────────
  {
    id: 'shopify',
    name: 'Shopify Admin',
    category: '商务',
    priority: 'recommended',
    description: '09 优化读订单/Inventory；05 建站可作为 storefront 后端。',
    used_by_skills: ['05', '09'],
    env_vars: ['SHOPIFY_SHOP', 'SHOPIFY_ADMIN_TOKEN'],
    docs_url: 'https://shopify.dev/docs/api/admin',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: '商务',
    priority: 'recommended',
    description: '09 拉支付 / 退款 / 订阅数据。',
    used_by_skills: ['09'],
    env_vars: ['STRIPE_SECRET_KEY'],
    docs_url: 'https://stripe.com/docs/api',
  },

  // ─── Phase 2 预留 ──────────────────────────────────────────────
  {
    id: 'sendgrid',
    name: 'SendGrid',
    category: 'Phase 2 · 邮件',
    priority: 'optional',
    description: '10 邮件/CRM 发送通道。',
    used_by_skills: ['10'],
    env_vars: ['SENDGRID_API_KEY'],
    docs_url: 'https://docs.sendgrid.com/',
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'Phase 2 · 邮件',
    priority: 'optional',
    description: '10 邮件/CRM 发送通道（轻量替代 SendGrid）。',
    used_by_skills: ['10'],
    env_vars: ['RESEND_API_KEY'],
    docs_url: 'https://resend.com/docs',
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    category: 'Phase 2 · 邮件',
    priority: 'optional',
    description: '10 邮件/CRM 自动化（事件触发 flows）。',
    used_by_skills: ['10'],
    env_vars: ['KLAVIYO_API_KEY'],
    docs_url: 'https://developers.klaviyo.com/',
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
