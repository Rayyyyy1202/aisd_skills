# Module 3: Character Pack

## 职责

为每个角色产出"角色设定集"：master shot → 三视图 → 表情表 → 俧面特写。靠首图引用法把同一角色锁死，靠 Style Bible 强注入防风格漂移。这是防"脸崩"的核心模块。

## 输入

- `_cache/m1-extraction.json`（characters 列表 + 每个角色的描述/情绪集合/tier）
- `_cache/m2-style-bible.json`（prompt_prefix/suffix/negative + 调色板）
- `config.yaml`（asset_granularity.character / consistency.character_ref_strength / qa.thresholds）

## 步骤

**本模块不直接调 T2I API。**只做：拼 prompt → 入队 → 调 generation-loop → 等队列消费完 → 渲染角色卡 → HITL 闸。

按 characters 列表入队（同一角色内部任务通过 `depends_on` 表达 master → 视图/表情/俧面的顺序，确保 master 先出）。

### 3.1 决定粒度

按 tier 决定生成内容：

- `primary`：master + 3 视图（全身）+ 6 表情（半身）+ **3 张脸特写**（正/侧/三分四）= **13 张**
- `supporting`：master + 2 视图 + 4 表情 + **1 张正脸特写** = **8 张**
- `extra`：master + 1 张正脸特写 = **2 张**

config.yaml 的 `asset_granularity.character` 覆盖默认值。

**脸特写（face_details）是独立类别，不是 `closeups` / `views` / `expressions` 的子集**：
- `views` 是全身远景，看不清脸
- `expressions` 是上半身肖像，脸只占 ~30% 画面
- `face_details` 是脸部独立大特写，仅头部 + 颈部入框，专给下游"脸特写镜头"作 reference

### 3.2 入队 master shot（每个角色一个）

每个角色一个 master 任务（无依赖、无参考图）：

```jsonl
{
  "task_id": "char_lin_qing.master",
  "asset_id": "char_lin_qing",
  "asset_type": "character",
  "stage": "master",
  "status": "pending",
  "depends_on": [],
  "prompt": "<style_prefix>, full body portrait, <char.description>, neutral expression, standing front view, plain neutral background, even soft lighting, <style_suffix>",
  "negative_prompt": "<style_negative>, multiple characters, cropped, partial body, <char.negative_prompt>",
  "reference_images": [],
  "size": "1024x1536",                 // 3:4 适合全身
  "quality": "high",
  "background": "auto",
  "output_path": "assets/characters/char_lin_qing/master.png",
  "retry_count": 0,
  "max_retries": 3,
  "qa_required": true,
  "qa_thresholds": {"identity": 0.0, "style": 0.80, "tech": 0.90},   // master 自身无 identity 比对
  "qa_basis": {"master_for_identity": null, "style_refs": ["assets/style/ref_01.png", "..."]}
}
```

### 3.3 入队三视图（依赖 master）

每个视图一个任务，`depends_on` 标该角色的 master：

```jsonl
{
  "task_id": "char_lin_qing.view.front",
  "asset_id": "char_lin_qing",
  "asset_type": "character",
  "stage": "view.front",
  "depends_on": ["char_lin_qing.master"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.80>, <char.description>, front view full body, neutral expression, plain neutral background, even soft lighting, <style_suffix>",
  "negative_prompt": "...",
  "reference_images": ["assets/characters/char_lin_qing/master.png"],
  "size": "1024x1536",
  "quality": "high",
  "output_path": "assets/characters/char_lin_qing/views/front.png",
  "qa_required": true,
  "qa_thresholds": {"identity": 0.80, "style": 0.80, "tech": 0.85},
  "qa_basis": {"master_for_identity": "assets/characters/char_lin_qing/master.png", "style_refs": ["assets/style/ref_01.png", "..."]}
}
```

side / back 同形，只换 `view_directive` 与 `output_path`。

注：`ref_strength_hint_for_0.80` 由 prompt-locking-rules.md 的措辞映射表自动展开为 `same character as the reference image, matching facial features and outfit`。

### 3.4 入队表情表（依赖 master）

每个表情一个任务，依赖 master：

```jsonl
{
  "task_id": "char_lin_qing.expression.smile",
  "asset_id": "char_lin_qing",
  "asset_type": "character",
  "stage": "expression.smile",
  "depends_on": ["char_lin_qing.master"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.85>, <char.description>, upper body portrait, subtle smile, plain neutral background, soft lighting, <style_suffix>",
  "reference_images": ["assets/characters/char_lin_qing/master.png"],
  "size": "1024x1536",
  "quality": "high",
  "output_path": "assets/characters/char_lin_qing/expressions/smile.png",
  "qa_thresholds": {"identity": 0.85, "style": 0.80, "tech": 0.85},
  ...
}
```

表情列表从 `char.key_emotions` 取，缺则用默认 `[neutral, smile, angry, surprised, sad, focused]`。

### 3.5 入队俧面特写（依赖 master）

```jsonl
{
  "task_id": "char_lin_qing.face_detail.three_quarter",
  "asset_id": "char_lin_qing",
  "asset_type": "character",
  "stage": "face_detail.three_quarter",
  "depends_on": ["char_lin_qing.master"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.85>, <char.description>, extreme close-up of face only, three-quarter angle, eyes in sharp focus, head and upper neck only in frame, cinematic moody lighting, <style_suffix>",
  "reference_images": ["assets/characters/char_lin_qing/master.png"],
  "size": "1024x1024",
  "quality": "high",
  "output_path": "assets/characters/char_lin_qing/face_details/three_quarter.png",
  "qa_thresholds": {"identity": 0.85, "style": 0.80, "tech": 0.85},
  ...
}
```

**face_details 三档角度模板**（primary 全 3 张、supporting 只跑 front）：

| angle | prompt 关键段（替换 `extreme close-up of face only,` 后那段） |
|---|---|
| `front` | `straight-on front view, eyes looking directly at camera, symmetric face composition` |
| `side` | `strict side profile view, face perpendicular to camera, eye in sharp focus` |
| `three_quarter` | `three-quarter angle (between front and side), eyes in sharp focus, cinematic moody lighting` |

写入路径：`assets/characters/<id>/face_details/{front,side,three_quarter}.png`。

### 3.6 调用 generation-loop 消费队列

所有角色任务入队后：

```
invoke modules/generation-loop.md on _cache/queue/active.jsonl
```

每张图一次 API + 一次 qa-checker，主会话每完成一张收到一行简报。
预估时间：一个 3 角色项目（含 face_details，约 31 张图）≈ 6-10 分钟（串行模式，含 qa）。
config 改 `concurrency.max_parallel_calls = 3` 则启用 3 个子代理并发，时间降到 ≈ 3-4 分钟。

### 3.7 队列消费完后：渲染角色卡

只读已落盘的图片路径，用 `templates/character-card.md.j2` 渲染 `docs/characters/<char.id>.md`，含：

- 基本信息（名/别名/tier/出场次数）
- 11 张图的缩略图嵌入
- 锁定 prompt 片段（下游 Agent 引用时拼装的角色描述）
- qa 分数表（从队列任务的 `scores` 字段汇总）

不再额外生成任何图。

### 3.8 角色 JSON 片段

写入 `_cache/m3-character-pack.json` 的 `characters[]` 数组：

```json
{
  "id": "char_lin_qing",
  "name": "林清",
  "tier": "primary",
  "ref_images": {
    "master": "assets/characters/char_lin_qing/master.png",
    "views": {
      "front": "assets/characters/char_lin_qing/views/front.png",
      "side": "assets/characters/char_lin_qing/views/side.png",
      "back": "assets/characters/char_lin_qing/views/back.png"
    },
    "expressions": {
      "neutral": "assets/characters/char_lin_qing/expressions/neutral.png",
      "smile": "...", "angry": "...", "surprised": "...", "sad": "...", "focused": "..."
    },
    "face_details": {
      "front": "assets/characters/char_lin_qing/face_details/front.png",
      "side": "assets/characters/char_lin_qing/face_details/side.png",
      "three_quarter": "assets/characters/char_lin_qing/face_details/three_quarter.png"
    }
  },
  "prompt_fragment": "20-year-old Asian woman, shoulder-length straight black hair, beige trench coat over white turtleneck, slim build, soft features, light makeup",
  "negative_prompt": "child, elderly, blonde hair, masculine features",
  "ref_strength_recommended": 0.80,
  "qa_scores": {
    "identity_avg": 0.92,
    "style_avg": 0.88,
    "tech_avg": 0.94,
    "retry_count": 2
  }
}
```

`prompt_fragment` 由 LLM 基于 `char.description` + master 视觉特征整合而来（强调可视化的固定特征：年龄、性别、发型、服装、体型、辨识度物件）。

### HITL 闸②

所有角色生成完毕后，呈现给用户：

```
👥 角色设定集 (3 角色 / 27 张图)

[char_lin_qing] 林清 [primary]  11 张  identity 0.92  style 0.88 ✅
  master.png  views/{front,side,back}.png  expressions/{neutral,smile,angry,surprised,sad,focused}.png  closeup.png

[char_shen_huai] 沈淮 [primary]  11 张  identity 0.86  style 0.89 ✅
  ...

[char_lao_ban] 老板 [extra]  2 张  identity 0.78 ⚠️ style 0.91 ✅
  master.png  closeup.png

请选择：
  approve all                       - 全部锁定，进入 4-scene-pack
  approve char_lin_qing             - 单个 approve
  redo char_lao_ban                 - 重抽某个角色（同 prompt 重跑）
  redo char_lao_ban with hint "更年长，灰白胡须"  - 改描述重抽
  redo char_lin_qing expression angry   - 仅重抽某张表情
  view char_lin_qing                - 打开角色卡 markdown 详细看
```

支持的策略：

- 整体 approve：所有角色都锁
- 单角色 approve：被 approve 的角色锁，未 approve 的留待重抽
- redo + hint：用追加描述重新跑该角色全套图
- redo + 子项：仅重抽指定图（如某个表情、某个视图）
- 用户每次操作后局部更新 m3-character-pack.json + metadata.json

直到所有角色 approve，置 `hitl_gates["character-pack"] = "approved"`。

## 输出

- `assets/characters/<id>/`（每个角色一个子目录，含 master/views/expressions/closeup）
- `docs/characters/<id>.md`（人读角色卡）
- `_cache/m3-character-pack.json`（机器读）

## 错误与边界

- master 跑 3 次都不过 qa：报警告，把当前最高分版本作为 master，让用户在 HITL 决定是否手动接受
- identity score 长期偏低（< 0.75）：往往是 char.description 过于抽象，提示用户在剧本里补具象特征（如"她有酒窝""他左眉有疤"）
- 群演（extra）的 closeup 不重要：可以跳过，仅 master 即可，由 user config 覆盖

## 下游契约

`_cache/m3-character-pack.json` 提供给：

- `4-scene-pack`：如果场景描述中"林清坐在沙发上"，可读 char_lin_qing 的 master/views 作 reference，生成场景内人物（**注意**：建议不在场景图里画死人物，场景图保持空场，人物由下游抽卡时按 char ID 引用合成；但本 skill 可选支持"含人物的场景定调图"）
- `6-pack-export`：合并到最终 assets.json 的 `characters[]` 数组
- 下游抽卡 Agent：每次镜头按 char ID 取 ref_images 中最贴近当前景别的那张作 reference image
