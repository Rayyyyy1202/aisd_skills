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

// Domain hints for synthetic upstream stubs (aisd short-drama pipeline).
// Only 01-04 are ever auto-stubbed as upstream; 05 is terminal in P0 and
// 06-09 are Phase 2 placeholders that never run.
const STUB_HINTS: Record<string, string> = {
  '01': 'Topic. Required: logline { text, language, hook, twist, payoff, genre }, platform_profile { platform, target_duration_s, aspect, hook_window_s }, target_audience (≥1 AudienceProfile), competitor_cards (≥3 with id comp_NNN), topic_tags (≥3), reference_works (≥1), localization_targets:[]. claim_meta.sources may be [] for synthetic data.',
  '02': 'Script. Required: structure { template, act_count }, beat_sheet (≥3 with t_s/name/description, first beat t_s≤hook_window_s), scenes (≥1, ids scene_NNN, each with dialogue[] ids dlg_NNN, shot_hints[], audio_cues:[]), characters (≥1, ids char_NNN, ≥1 role=lead), props_required (ids prop_NNN), total_duration_s, language, localization_targets:[].',
  '03': 'Assets. Required: style_bible { name, refs (≥1 MediaRef), palette (≥3 hex), art_direction }, assets[] (ids asset_NNN/char_NNN, asset_type, master_path), characters[]/scenes[]/props[] each with source_id ∈ upstream 02 ids, shouce_md_path. Use placeholder image paths like ./aisd/03-assets/assets/.../master.png.',
  '04': 'Storyboard. Required: shots[] (ids shot_NNN, scene_id ∈ 02, duration_s, camera { shot_size, movement }, first_frame_path, asset_refs[≥1] ∈ 03, sfx_marks:[], music_intent:"TBD", subtitle_intent:"unspecified"), first_frames_dir, shotlist_md_path, total_duration_s, aspect.',
  '05': 'Video. Required: clips[] (clip_id clip_NNN, shot_id ∈ 04, clip_path, provider, duration_s, cut_marks:[], color_intent:"unspecified", speed_intent:"unspecified"), preview_video_path, total_duration_s, aspect, provider_summary { primary_provider }, compliance_tags:["ai_generated"].',
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
- Media paths: ./aisd/<NN>-<slug>/.../placeholder.png
- Stable ids: scene_001 / char_001 / shot_001 / clip_001 — keep them simple and consistent

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
