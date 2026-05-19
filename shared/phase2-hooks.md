# aisd Skills — Phase 2 Hooks

Fields that are MANDATORY in MVP outputs but only CONSUMED by Phase 2 skills (06–09). MVP skills (01–05) MUST emit these fields with placeholder values (`"TBD"`, `[]`, `null`) so Phase 2 can detect "missing" vs "absent" later.

## Ownership table

| Field | Owner (writes) | Phase 2 consumer (reads) | Purpose |
|---|---|---|---|
| `localization_targets[]` | 01-topic | 06-audio (per-language TTS), 07-editing (subtitle variants), 08-distribution (per-region publish) | List of BCP-47 codes; empty `[]` means "single-language, follow `language` field" |
| `scenes[*].audio_cues[]` | 02-script | 06-audio | Per-scene SFX hints, ambience, music-emotion words |
| `scenes[*].dialogue[*].variants{}` | 02-script (if localization_targets > 1) | 06-audio (TTS), 07-editing (subtitle), 08-distribution (caption file) | Per-language dialogue text; absent when only one target language |
| `shots[*].sfx_marks[]` | 04-storyboard | 06-audio | Per-shot SFX cues with timecodes (e.g. door slam at 0.4s) |
| `shots[*].music_intent` | 04-storyboard | 06-audio | One-line music brief (mood, tempo, instrumentation hint) |
| `shots[*].subtitle_intent` | 04-storyboard | 07-editing | Position / style hint for subtitle overlay |
| `clips[*].cut_marks[]` | 05-video | 07-editing | In/out cut suggestions inside a clip (for tight editing) |
| `clips[*].color_intent` | 05-video | 07-editing | Color-grading brief (cinematic, anime, bright, moody, ...) |
| `clips[*].speed_intent` | 05-video | 07-editing | Slow-mo / time-remap hints for specific spans |
| `compliance_tags[]` | 05-video | 07-editing (mandatory watermarks), 08-distribution (per-platform rules) | e.g. `ai_generated`, `dramatized`, `sponsored`, `age_18+` |

## Placeholder convention

When the owner has no real data to emit:

| Type | Placeholder | Example |
|---|---|---|
| Array | `[]` | `audio_cues: []` |
| String | `"TBD"` | `music_intent: "TBD"` |
| Enum | first enum value labeled `"unspecified"` | `color_intent: "unspecified"` |
| Map | `{}` | `variants: {}` |

Placeholder fields are valid against the JSON schemas (schemas mark them as optional content, mandatory presence).

## Phase 2 readiness check

When Phase 2 skills land, they will run:

```
for each Phase 2 hook field:
    if missing → ERROR (upstream skill is too old, won't bump)
    if "TBD" / [] / {} → WARN (Phase 2 skill must prompt user or infer)
    if real value → use directly
```

This is why missing vs absent matters: Phase 2 needs to distinguish "owner has nothing yet" from "owner doesn't know this field exists" (= contract drift).

## When to add a new Phase 2 hook

1. Identify the Phase 2 skill that needs the field
2. Identify the upstream MVP skill that's the natural producer (closest to the source data)
3. Add the field to the upstream skill's schema marked `phase2_hook: ...` in description
4. Add a row to this table
5. Update the upstream skill's `SKILL.md` to emit the placeholder
6. Bump the upstream skill's schema minor version

Never add a hook to a downstream skill that "passes through" — always to the natural producer.
