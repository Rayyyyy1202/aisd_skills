# aisd Skills — Data Contracts

Single source of truth for how the 9 skills exchange data. `SKILL.md` / modules / templates are generated FROM this contract. Change a contract here → revalidate every downstream skill.

> **Companion files:**
> - `conventions.md` — paths, naming, language, Agent Loop, gpt-image-1
> - `phase2-hooks.md` — fields reserved for Phase 2 skills (06–09)
> - `schemas/_common.schema.json` — shared `$defs` (Asset, Shot, MediaRef, Confidence, Source, AudienceProfile, Meta)
> - `schemas/NN-<slug>.schema.json` — full JSON Schema per skill

---

## 1. End-to-end data flow

```
                                USER INPUT (方向 / 平台 / 语种)
                                                │
                                                ▼
                            ┌───────────────────────────────────┐
                            │ 01 TOPIC                          │
                            │ ───────────────────────────────── │
                            │ logline,                          │
                            │ platform_profile,                 │
                            │ target_audience,                  │
                            │ competitor_cards[],               │
                            │ topic_tags[]                      │
                            └─────────────────┬─────────────────┘
                                              │
                                              ▼
                            ┌───────────────────────────────────┐
                            │ 02 SCRIPT                         │
                            │ ───────────────────────────────── │
                            │ structure,                        │
                            │ beat_sheet[],                     │
                            │ scenes[] (id, location, time,     │
                            │   characters_present[],           │
                            │   dialogue[], shot_hints[],       │
                            │   audio_cues[] ← phase2_hook),    │
                            │ characters[] (id, role, traits),  │
                            │ props_required[]                  │
                            └─────────────────┬─────────────────┘
                                              │
                       ┌──────────────────────┴─────────────────┐
                       ▼                                        │
        ┌───────────────────────────────────┐                   │
        │ 03 ASSETS                         │                   │
        │ ───────────────────────────────── │                   │
        │ style_bible (refs, palette),      │                   │
        │ assets[] (id, type, master_path,  │                   │
        │   variants[], image_refs[]),      │                   │
        │ characters[] ← 02.characters      │                   │
        │ scenes[]    ← 02.scenes           │                   │
        │ props[]     ← 02.props_required   │                   │
        └─────────────────┬─────────────────┘                   │
                          │                                     │
                          └─────────────┬───────────────────────┘
                                        ▼
                            ┌───────────────────────────────────┐
                            │ 04 STORYBOARD                     │
                            │ ───────────────────────────────── │
                            │ shots[] (id, scene_id, duration_s,│
                            │   camera, lens, composition,      │
                            │   asset_refs[], first_frame_path, │
                            │   dialogue_ref, sfx_marks[] ←     │
                            │     phase2_hook, music_intent ←   │
                            │     phase2_hook)                  │
                            └─────────────────┬─────────────────┘
                                              │
                                              ▼
                            ┌───────────────────────────────────┐
                            │ 05 VIDEO                          │
                            │ ───────────────────────────────── │
                            │ clips[] (shot_id, clip_path,      │
                            │   provider, model, duration_s,    │
                            │   first_frame_path, end_frame_path│
                            │   qa_score, cut_marks[] ←         │
                            │     phase2_hook,                  │
                            │   color_intent ← phase2_hook),    │
                            │ preview_video_path                │
                            └─────────────────┬─────────────────┘
                                              │
                                  ╴ ╴ ╴ Phase 2 ╴ ╴ ╴ ╴ ╴
                                              │
                                              ▼
                            06 AUDIO (TTS + SFX + music)
                                              │
                                              ▼
                            07 EDITING (color + upscale + 合规标识)
                                              │
                                              ▼
                            08 DISTRIBUTION (publish + ads + localization)
                                              │
                                              ▼
                            09 FEEDBACK (analytics → loop back to 01/02)
```

## 2. Field ownership table

Each row: **producer → consumer**. Only the producer writes; consumers read by reference.

| Field | Producer | Consumers |
|---|---|---|
| `logline` | 01-topic | 02-script |
| `platform_profile.target_duration_s` | 01-topic | 02-script (drives beat_sheet), 05-video (drives total clip duration) |
| `target_audience` | 01-topic | 02-script (tone), 08-distribution Phase 2 (targeting) |
| `scenes[].id` (format `scene_NNN`) | 02-script | 03-assets, 04-storyboard |
| `scenes[].dialogue[]` | 02-script | 04-storyboard (dialogue_ref), 06-audio Phase 2 (TTS source) |
| `scenes[].audio_cues[]` (phase2_hook) | 02-script | 06-audio Phase 2 |
| `characters[].id` (format `char_NNN`) | 02-script (declares roster) → 03-assets (generates assets) | 04-storyboard (asset_refs) |
| `assets[].id` (format `asset_NNN`) | 03-assets | 04-storyboard (asset_refs) |
| `assets[].master_path` | 03-assets | 04-storyboard (passed as reference to gpt-image-1) |
| `style_bible.refs[]` | 03-assets | 04-storyboard (Style Bible references for every first-frame call) |
| `shots[].id` (format `shot_NNN`) | 04-storyboard | 05-video |
| `shots[].first_frame_path` | 04-storyboard | 05-video (first frame for video provider) |
| `shots[].sfx_marks[]` (phase2_hook) | 04-storyboard | 06-audio Phase 2 |
| `shots[].music_intent` (phase2_hook) | 04-storyboard | 06-audio Phase 2 |
| `clips[].clip_path` | 05-video | 07-editing Phase 2 |
| `clips[].cut_marks[]` (phase2_hook) | 05-video | 07-editing Phase 2 |
| `clips[].color_intent` (phase2_hook) | 05-video | 07-editing Phase 2 |
| `preview_video_path` | 05-video | human review; 07-editing Phase 2 input source |

## 3. Cross-skill referential integrity edges

Every downstream skill MUST validate before writing:

| Edge | Check |
|---|---|
| 03 → 02 | `03.characters[*].source_id` ∈ `02.characters[*].id`; `03.scenes[*].source_id` ∈ `02.scenes[*].id`; `03.props[*].source_id` ∈ `02.props_required[*].id` |
| 04 → 03 | `04.shots[*].asset_refs[*]` ∈ `03.assets[*].id` |
| 04 → 02 | `04.shots[*].scene_id` ∈ `02.scenes[*].id`; `04.shots[*].dialogue_ref` (if present) ∈ `02.scenes[scene_id].dialogue[*].id` |
| 05 → 04 | `05.clips[*].shot_id` ∈ `04.shots[*].id`; `05.clips[*].first_frame_path` exists on disk |

Any drift → STOP. Re-run the upstream skill or fix the rename.

## 4. Required vs phase2_hook fields per skill

| Skill | Required output fields | Phase 2 hook fields (MUST be present, MAY be empty `[]` / `"TBD"`) |
|---|---|---|
| 01-topic | logline, platform, target_duration_s, target_audience, competitor_cards[], topic_tags[], reference_works[], meta | localization_targets[] |
| 02-script | structure, beat_sheet[], scenes[], characters[], props_required[], total_duration_s, meta | scenes[*].audio_cues[], localization_targets[] |
| 03-assets | style_bible, assets[], characters[], scenes[], props[], 拍摄手册_path, meta | (none — pure visual layer) |
| 04-storyboard | shots[], first_frames_dir, shotlist_md_path, meta | shots[*].sfx_marks[], shots[*].music_intent, shots[*].subtitle_intent |
| 05-video | clips[], preview_video_path, total_duration_s, provider_summary, meta | clips[*].cut_marks[], clips[*].color_intent, compliance_tags[] |

## 5. Common ID format

| Entity | ID pattern |
|---|---|
| Scene | `scene_NNN` |
| Character | `char_NNN` |
| Prop | `prop_NNN` |
| Asset (3D pack) | `asset_NNN` (sub-typed by `asset_type` field) |
| Shot | `shot_NNN` |
| Clip | `clip_NNN` (or reuse `shot_NNN` if 1:1) |
| Dialogue line | `dlg_NNN` |
| Competitor | `comp_NNN` |
| Audience profile | `audience_NNN` |

3 digits zero-padded. Once assigned in a project workspace, IDs are stable across runs.

## 6. Localization split

When `01-topic.localization_targets[]` has multiple target languages, each downstream skill produces per-language artifacts:

- 02-script: dialogue rendered in each target language under `scenes[].dialogue[].variants{lang: text}`
- 04-storyboard: per-language subtitle intent
- 06-audio Phase 2: per-language TTS tracks
- 07-editing Phase 2: per-language overlay variants
- 08-distribution Phase 2: per-language publish jobs

If only one language → no `variants{}` map needed; top-level `language` field on each item is enough.

## 7. Meta block (all skills)

Every `output.json` ends with:

```json
"meta": {
  "generated_at": "<ISO-8601 with timezone>",
  "skill_version": "<semver>",
  "schema_version": "<semver>",
  "aisd_version": "<package semver>",
  "execution_time_s": <number>,
  "user_input_summary": "<one-line>",
  "upstream_inputs": [
    { "skill": "aisd-02-script", "schema_version": "1.0.0", "consumed_fields": ["scenes", "characters"] }
  ]
}
```

`upstream_inputs[]` declares exactly which fields were consumed from which upstream output — this lets us bust caches when an upstream contract changes.
