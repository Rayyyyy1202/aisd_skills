# Module 6: Confirm & Assemble Output

> Core Question: 用户选定 logline 后，组装 `output.json` + `report.md`，通过校验门交付。

## Inputs from Module 5

- 用户选定的 logline 对象
- `shortlist_history[]`（所有候选 + 评分 + 被淘汰原因）
- 来自 Module 1-4 的全部数据

## Process

### Step 1: 组装 `output.json`

按 `templates/output.json.template` 填充：

- `logline`（用户选的那条）
- `platform_profile`（Module 1）
- `target_audience`（Module 4 的 `target_audience[]`）
- `competitor_cards`（Module 3）
- `topic_tags[]`（Module 2 的 `trending_hashtags[]` ∪ logline 关键词）
- `reference_works[]`（Module 3 头部账号的 top_work 选 2-3 条）
- `localization_targets[]` — phase2_hook：若用户没提 → `[]`；用户明确说"做中英两版" → `["zh-CN", "en-US"]`
- `shortlist_history[]`
- `meta`：generated_at（now ISO-8601）、skill_version `1.0.0`、schema_version `1.0.0`、aisd_version、execution_time_s、upstream_inputs（本 skill 无上游 → 空数组）

写到 `./aisd/01-topic/output.json`。

### Step 2: 生成 `report.md`

按 `templates/report.md.template` 填充。语言跟随用户对话语言。

### Step 3: 校验门（不可跳过）

```bash
# 3a. ajv schema 校验
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/01-topic.schema.json \
  -d ./aisd/01-topic/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. 字段计数检查
test $(jq '.competitor_cards | length' ./aisd/01-topic/output.json) -ge 3
test $(jq '.target_audience | length' ./aisd/01-topic/output.json) -ge 1
test $(jq '.reference_works | length' ./aisd/01-topic/output.json) -ge 1

# 3c. 存在性断言（report.md 路径 + reference_works 的 URL HEAD 检查）
for url in $(jq -r '.reference_works[].url' ./aisd/01-topic/output.json); do
  curl -fsS -I "$url" >/dev/null || echo "WARN: $url 可能失效"
done
```

校验失败 → 修复后重试，不要标记完成。

### Step 4: 写入 _cache/metadata.json

```json
{
  "completed_modules": ["01", "02", "03", "04", "05", "06"],
  "selected_logline": "<text>",
  "started_at": "<ISO>",
  "completed_at": "<ISO>",
  "ai_provider_calls": 0
}
```

## Decision Gate

- 校验失败 → 自动回到对应模块修复，不交付
- 校验通过 → 交付

## Data Passing to Next Module

本 skill 完成。下一阶段是 `/aisd-02-script`，它会读：

- `./aisd/01-topic/output.json` 的 `logline`、`platform_profile`、`target_audience`、`localization_targets`、`reference_works[].structure_takeaway`

## 交付简报

```
✓ 选题完成
  方向: <user direction>
  平台: <platform> · <duration_s>s · <aspect>
  
  Logline:
    "<text>"
    Hook: <hook>
    Twist: <twist>
    Payoff: <payoff>
  
  目标受众: <audience_name (size_band)>, ...
  对标账号: <comp_001 name>, <comp_002 name>, ... (共 N 个)
  热词: #<tag1> #<tag2> ...
  
  产物:
    - ./aisd/01-topic/output.json (✓ schema validated)
    - ./aisd/01-topic/report.md
    - ./aisd/01-topic/_cache/
  
  下一步: /aisd-02-script
```
