import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { SkillRegistry, SkillNode } from '../skills/registry.ts';
import type { Workspace } from '../workspace/path.ts';
import type { Validator } from '../tools/validate.ts';
import type { LLMClient } from '../llm/openai.ts';
import { readSkillState } from './preflight.ts';

export interface StubReport {
  skillId: string;
  /** Was the upstream already a valid output.json before stubbing? */
  preExisted: boolean;
  ok: boolean;
  path: string;
  error?: string;
  errors?: Array<{ path: string; message: string }>;
}

const STUB_HINTS: Record<string, string> = {
  '01': 'Project research. Required: niche, target_audience (≥1 profile), competitors (≥1), market_signals. URL placeholders allowed (https://example.com/...). Set claim_meta.sources=[] for synthetic claims.',
  '02': 'Product selection. Emit ≥1 SKU with id, name, retail_price (number), margin_pct (number 0-1), weight_g, MOQ, lead_time_days, supplier { name, country, lead_time_days }. Mark each SKU with synthetic:true.',
  '03': 'Project identity. tagline, mission, palette (≥3 hex colors), typography (1 pair), tone_voice, cs_tone, welcome_offer.',
  '04': 'Creative factory. ≥1 hero asset brief (kind=photo|video|illustration), ≥1 copy_block, asset_coverage_matrix mapping audience×channel.',
  '05': 'Site build. site_url=https://example.com, routes=[{path:"/",template:"home"},{path:"/products/sample",template:"product"}], analytics_endpoints={}, repo_path=null.',
  '06': 'Tracking. Emit the 13 required events (page_view, view_item, add_to_cart, begin_checkout, purchase, search, view_item_list, view_promotion, select_promotion, sign_up, login, generate_lead, refund). destinations=[], consent_mode="v2_default_denied", site_build_writeback={rebuild_executed:true,post_rebuild_validation_status:"pass"}.',
  '07a': 'Tech SEO. crawl_summary, sitemap_status, robots_txt_status, schema_markup_audit, page_speed_audit (≥1 page).',
  '07b': 'Content marketing. content_calendar (≥1 entry), keyword_strategy, distribution_plan.',
  '08': 'Paid ads. ≥1 campaign with id "campaign_001", ≥1 audience "paud_001", ≥1 creative_pairing "pairing_001". Reference stubbed 04 asset/copy ids.',
  '09': 'Optimization. data_sources[] all status="ok", data_pull with ≥1 metrics_by_dim row, ≥1 diagnostic, ≥1 decision with diagnostic_ids[≥1], ≥1 applied_change, next_actions.',
};

const STUB_TURN_CAP = 4;

function buildStubPrompt(node: SkillNode, projectBrief: string | undefined): string {
  const schemaText = node.schemaPath ? readFileSync(node.schemaPath, 'utf-8') : '';
  const hint = STUB_HINTS[node.id] ?? 'Generate a minimal valid output.json.';

  return `You are generating a SYNTHETIC upstream stub for the aisd pipeline skill **${node.fullName}**.

# Project brief
${projectBrief ? projectBrief : '(none — invent plausible placeholders)'}

# Stub-specific guidance
${hint}

# Required: synthetic marker
Every top-level array element you create MUST include "synthetic": true (where the schema permits an additionalProperty), or the top-level object MUST have "synthetic": true. This signals downstream that this data was machine-generated, not researched.

# Placeholders allowed
- URLs: https://example.com/...
- SKUs: sku_001, sku_002...
- Stable ids: keep them simple and consistent

# Output
Return ONLY a single JSON object. No prose, no markdown fences. The first character of your response must be \`{\` and the last must be \`}\`. The object must validate against the schema below.

# JSON Schema
${schemaText}
`;
}

function parseJsonObject(s: string): unknown {
  const trimmed = s.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('no JSON object in response');
  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
}

const NO_TOOLS: ChatCompletionTool[] = [];

async function generateStub(
  node: SkillNode,
  projectBrief: string | undefined,
  llm: LLMClient,
  validator: Validator,
): Promise<{ ok: boolean; data?: unknown; errors: Array<{ path: string; message: string }>; raw?: string }> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildStubPrompt(node, projectBrief) },
    { role: 'user', content: `Emit the synthetic stub output.json for ${node.fullName} now.` },
  ];

  let lastRaw = '';
  let lastErrors: Array<{ path: string; message: string }> = [];

  for (let attempt = 0; attempt < STUB_TURN_CAP; attempt++) {
    const resp = await llm.chat(messages, NO_TOOLS);
    lastRaw = resp.text;
    let parsed: unknown;
    try {
      parsed = parseJsonObject(resp.text);
    } catch (e) {
      messages.push(resp.message);
      messages.push({
        role: 'user',
        content: `Your response was not valid JSON: ${(e as Error).message}. Re-emit ONLY a JSON object (start with { end with }), no markdown.`,
      });
      continue;
    }

    if (!node.schemaPath) {
      return { ok: true, data: parsed, errors: [], raw: lastRaw };
    }
    const r = validator.validate(node.schemaPath, parsed);
    if (r.ok) return { ok: true, data: parsed, errors: [], raw: lastRaw };
    lastErrors = r.errors;
    messages.push(resp.message);
    messages.push({
      role: 'user',
      content: `Schema validation failed. Fix every error and re-emit the complete JSON object only:\n${r.errors.slice(0, 15).map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`,
    });
  }

  return { ok: false, errors: lastErrors, raw: lastRaw };
}

/**
 * For each missing-or-invalid required upstream of `skillId`, ask the LLM to
 * emit a valid synthetic stub. Pre-existing valid outputs are preserved.
 */
export async function ensureStubsForUpstream(
  skillId: string,
  registry: SkillRegistry,
  workspace: Workspace,
  validator: Validator,
  llm: LLMClient,
  projectBrief: string | undefined,
  emit?: (e: { type: 'stub'; payload: StubReport }) => void,
): Promise<StubReport[]> {
  const node = registry.get(skillId);
  if (!node) throw new Error(`unknown skill: ${skillId}`);

  const reports: StubReport[] = [];

  for (const upId of node.upstreamRequired) {
    const up = registry.get(upId);
    if (!up) {
      reports.push({ skillId: upId, preExisted: false, ok: false, path: '', error: 'unknown upstream' });
      continue;
    }

    const state = readSkillState(up, workspace, validator);
    const outPath = workspace.outputJsonPath(up);

    if (state.exists && state.valid) {
      const r: StubReport = { skillId: upId, preExisted: true, ok: true, path: outPath };
      reports.push(r);
      emit?.({ type: 'stub', payload: r });
      continue;
    }

    const result = await generateStub(up, projectBrief, llm, validator);
    if (!result.ok) {
      const r: StubReport = {
        skillId: upId,
        preExisted: state.exists,
        ok: false,
        path: outPath,
        error: 'stub generation failed',
        errors: result.errors,
      };
      reports.push(r);
      emit?.({ type: 'stub', payload: r });
      continue;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result.data, null, 2), 'utf-8');

    const r: StubReport = { skillId: upId, preExisted: state.exists, ok: true, path: outPath };
    reports.push(r);
    emit?.({ type: 'stub', payload: r });
  }

  return reports;
}

export function stubExists(node: SkillNode, workspace: Workspace): boolean {
  return existsSync(workspace.outputJsonPath(node));
}
