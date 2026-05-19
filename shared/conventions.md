# aisd Skills — Shared Conventions

Universal rules every `aisd-NN-*` skill follows. Skills MUST conform; they are NOT free to invent their own paths/naming/formats.

## 1. Output paths

Every skill writes to the **user's current working directory** under:

```
./aisd/<NN>-<slug>/
├── output.json     # machine-readable, MUST validate against schemas/<NN>-<slug>.schema.json
├── <report>.md     # human-readable summary (report.md / script.md / 拍摄手册.md / shotlist.md)
├── _cache/         # resumability snapshots; modules may use freely
│   ├── metadata.json
│   ├── m01-<step>.md  (per-module checkpoint, optional)
│   └── queue/      # only skills that use the Agent Loop pattern
│       └── active.jsonl
└── <produce>/      # generated artifacts: assets/, first_frames/, clips/, etc.
```

- `<NN>` = zero-padded module number: `01` … `09`
- `<slug>`: `topic`, `script`, `assets`, `storyboard`, `video`, `audio`, `editing`, `distribution`, `feedback`

## 2. Reading upstream artifacts

A downstream skill MUST:

1. Look for required upstream files at `./aisd/<NN>-*/output.json` (see `data-contracts.md`)
2. Validate the upstream JSON against that skill's schema before consuming it
3. If missing/invalid: STOP and tell the user which upstream skill to run first. NEVER fabricate or estimate.

```
# Pseudocode every downstream skill follows
required = ["./aisd/02-script/output.json", "./aisd/03-assets/output.json"]
for path in required:
    if not exists(path): STOP("Run upstream skill first: " + skill_for(path))
    if not validates(path, schema_for(path)): STOP("Upstream artifact invalid: " + path)
```

## 3. Language

| What | Language |
|---|---|
| User-facing chat | Mirror the user (CN → CN, EN → EN) |
| Human reports (`script.md`, `拍摄手册.md`, etc.) | Mirror the user |
| External search queries (agent-reach, Web) | English (broader source coverage) |
| Image / video prompts to AI providers | English (T2I/T2V models are EN-biased) |
| `output.json` field VALUES | EN for analytic / metadata fields; user's target language for dialogue, on-screen text, voice cues |

Drama content carries an explicit `language` field per item (BCP-47, e.g. `zh-CN`, `en-US`).

## 4. Agent Loop (single-artifact rule) — MANDATORY for any media generation

This is the single most important rule in this repo. Comes from production incidents where batched/parallel generation caused identity drift, throughput cliffs, and broken QA loops.

For **any** image, video, audio, or music generation:

1. **Enqueue** all tasks to `_cache/queue/active.jsonl`. Module N only writes the queue; it never calls the provider API directly.
2. **One iteration = one API call = one artifact.** Run a generation loop where each iteration:
   - Pops one task from the queue
   - Calls the provider with `n=1` (never `n>1`, never batch endpoints)
   - Runs QA on the single artifact
   - On pass → mark `done`; on fail → requeue with `retry_count++` and adjusted prompt
3. **Parallelism via sub-agents only.** If you need concurrency, spawn N sub-agents each running its own single-task loop. Each sub-agent atomically claims one task. Never multi-task within a single sub-agent.
4. **The provider call lives in exactly one place** per skill — typically `modules/05-generation-loop.md` (image) or `modules/04-generation-loop.md` (video). All other modules only enqueue.

**Red lines (forbidden):**
- ❌ `n > 1` in any provider request
- ❌ Multiple provider calls inside a single sub-agent iteration
- ❌ `Promise.all` over provider calls in one session
- ❌ Holding multiple full artifacts in chat context (always write to disk path, re-read on demand)

## 5. gpt-image-1 (T2I provider lock for assets + storyboard)

All T2I generation in this repo uses **OpenAI gpt-image-1**:

- **With reference images** (asset master refs / scene refs / Style Bible refs): `POST /v1/images/edits` with multipart `image[]` field.
- **Without reference**: `POST /v1/images/generations` (rare — only the very first Style Bible reference may use this).
- **Prompt-strength tiers** for referencing assets (uniform vocabulary across all skills):

  | Tier | Phrase | Use |
  |---|---|---|
  | 0.90 | `identical to the reference` | Master clone, micro variants |
  | 0.85 | `the same character/scene as the reference` | Pose/expression change of same asset |
  | 0.80 | `consistent with the reference` | New angle / new lighting of established asset |
  | 0.70 | `inspired by the reference` | Loose style transfer; rare |

Reference images go in `_cache/refs/` (symlinks to the resolved asset paths) and are passed by local file path, not base64-in-chat.

## 6. Video provider config (HTTP, not MCP)

`aisd-05-video` uses HTTP providers directly (no MCP wrapper). Provider config lives in user's `~/.aisd/.env` or project-local `.env`:

```bash
AISD_VIDEO_PROVIDER=               # TBD — 必填，无默认。可选: kling | runway | vidu | hailuo | minimax | veo
KLING_API_KEY=...
KLING_API_BASE=https://api.klingai.com
RUNWAY_API_KEY=...
# ...
```

**No default provider.** The user MUST pick one in `.env` (or pass `--provider=` flag). 05-video STOPs at startup if `AISD_VIDEO_PROVIDER` is unset. Each provider's capabilities (first_last_frame support, duration range, async polling) are declared in `aisd-05-video/modules/01-provider-config.md`.

## 7. Confidence labeling (research-style claims)

Used by `aisd-01-topic` and `aisd-09-feedback` (where external research feeds in):

| Level | Meaning |
|---|---|
| `high` | 2+ independent sources agree |
| `medium` | 1 reliable source, OR multiple sources partially agree |
| `low` | Single weak source, OR estimate |

`low` claims MUST include `verification_path`.

## 8. Source citation

External research claims carry `sources[]` per `_common#/$defs/Source`:

```json
{ "url": "https://...", "accessed_at": "2026-05-19", "type": "social" }
```

Allowed `type` values: `web | trends | social | competitor | platform | tool | internal`.

## 9. Schema validation gate (non-optional)

Each skill's final step MUST validate `output.json` against its schema:

```bash
npx ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/<NN>-<slug>.schema.json \
  -d ./aisd/<NN>-<slug>/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json
```

- Pass → report success + summary
- Fail → fix the artifact, do NOT silently mark complete

## 10. Phase 2 hook fields

Fields whose `description` starts with `phase2_hook:` are MANDATORY in MVP — even though no MVP skill consumes them. See `phase2-hooks.md` for the full list. Skills MAY emit placeholder values (`"TBD"`, empty arrays) when real data is not yet available, but the field MUST be present.

## 11. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Skill name | `aisd-NN-<slug>` | `aisd-04-storyboard` |
| Cross-skill IDs | `<thing>_<3-digit zero-padded>` | `char_001`, `scene_007`, `shot_042` |
| Field names | `snake_case` | `first_frame_path`, `duration_s` |
| Enum values | `lower_snake` | `provider: "kling"`, `aspect: "9_16"` |
| File names | `kebab-case` | `02-beat-sheet.md` |
| Languages | BCP-47 | `zh-CN`, `en-US` |

ID stability: once assigned in one skill, downstream skills must reference that ID. Never renumber across runs in the same project workspace.

## 12. Currency, time, units

| Type | Format | Example |
|---|---|---|
| Date | `YYYY-MM-DD` (UTC) | `"2026-05-19"` |
| Datetime | ISO-8601 with timezone | `"2026-05-19T10:30:00Z"` |
| Duration (s) | integer / float seconds | `duration_s: 8.5` |
| Aspect ratio | underscore-form enum | `"9_16"`, `"16_9"`, `"1_1"`, `"4_5"` |
| Resolution | `WxH` | `"1080x1920"` |
| Money | `{ amount, currency }` | `{ "amount": 0.4, "currency": "USD" }` |

## 13. Skill versioning

Each `SKILL.md` frontmatter MUST include `version`. Each output's `meta.skill_version` MUST match. Backward-compatible schema additions = minor bump. Removed/renamed required fields = major bump (and an entry in `phase2-hooks.md` if it affects Phase 2 readiness).

## 14. State recovery

Skills are resumable. If `./aisd/<NN>-<slug>/output.json` exists when a skill runs:

```
1. Read existing output.json
2. Show: "Existing artifact found from {meta.generated_at}. Resume / Re-run / Cancel?"
3. Default: Resume — re-execute only modules whose data is missing/stale
```

`_cache/queue/active.jsonl` is the source of truth for any unfinished generation loop. On resume, the loop re-enters at the first non-`done` task.

## 15. No silent overwrites

Skills MUST NOT overwrite a previous `output.json` without explicit user confirmation. Rename to `output.{ISO-timestamp}.json.bak` on overwrite.

## 16. Existence assertions (mandatory)

Every output field whose name ends in `_path`, `_url`, `_image_path`, `_video_path`, `_md_path`, or carries "this is a file/URL someone can open" semantics MUST be filesystem-or-network-verified by the EMITTING skill before `output.json` is written:

```
for field in output.walk(matching=[*_path, *_url, ...]):
    if field.starts_with("./") or field.starts_with("/"):
        assert exists(repo_root + field), f"{field} → file missing"
    elif field.starts_with("http"):
        assert head(field).status == 200, f"{field} → 4xx/timeout"
```

Missing/404 → exit non-zero; do NOT write `output.json`.

## 17. Cross-skill referential integrity

When skill X consumes IDs/paths produced by skill Y, X MUST validate the references against Y's actual `output.json` before writing X's own output:

| Edge | What X checks against Y |
|---|---|
| 03 → 02 | every `assets[*].source_scene_id` ∈ `02.scenes[*].id` |
| 04 → 03 | every `shots[*].asset_refs[*]` ∈ `03.assets[*].id` |
| 04 → 02 | every `shots[*].scene_id` ∈ `02.scenes[*].id` |
| 05 → 04 | every `clips[*].shot_id` ∈ `04.shots[*].id` and `first_frame_path` resolves |

Drift → STOP. Fix upstream contract or rename, do not silently ship broken refs.

## 18. Terminal-status terminology

Critical gates (schema validation, QA score, provider API health, file existence) MUST report one of:

- `pass` — checked and green
- `fail` — checked and red → STOP, do not emit output
- `blocked` — preconditions unmet (missing env var, missing upstream) + REQUIRED `blocking_reason` string

`"skipped"` is FORBIDDEN as a terminal status for a critical gate.

## 19. Placeholder & secret denylist

Before writing `output.json` or any artifact, string fields are checked against:

| Pattern | Why |
|---|---|
| `lorem ipsum` | unrendered placeholder |
| `TODO`, `FIXME`, `STUB` (in user-visible copy) | unfilled author intent |
| `sk-...`, `pk_test_`, `ghp_`, `xoxb-`, `AKIA[A-Z0-9]{16}` | leaked secrets |
| `example.com`, `localhost` (in published content) | placeholder hostnames |

Match → STOP. Secret matches additionally trigger an alert to rotate the key.

## 20. Workspace privacy

Each project's `aisd/` directory may contain unreleased drama IP, voice clones, and platform metadata. Never upload `aisd/` to third-party services. The `.gitignore` in the user's project should already exclude `aisd/` from any code repo it lives in.
