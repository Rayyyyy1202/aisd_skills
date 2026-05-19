# Module 5: Prop Pack

## 职责

为关键道具产出参考图。主道具（剧情决定性物品）出三视图，次要道具（场景陈设、辨识度物件）出一张正面照。粒度比角色/场景轻，无独立 HITL 闸（跟随场景包一起 approve；qa 兜底）。

## 输入

- `_cache/m1-extraction.json`（props 列表 + tier + appears_in_scenes）
- `_cache/m2-style-bible.json`
- `_cache/m4-scene-pack.json`（可选用作环境参考）
- `config.yaml`（asset_granularity.prop / consistency.prop_ref_strength）

## 步骤

**本模块不直接调 T2I API。**入队 → 调 generation-loop → 渲染道具卡。

道具之间互不依赖（无 reference 链），但同一主道具的三视图依赖该道具的 master。

### 5.1 决定粒度

- `primary`：master + front + side + back = **4 张**
- `secondary`：front = **1 张**

### 5.2 入队主道具（master + 三视图）

#### master 任务（无依赖）

```jsonl
{
  "task_id": "prop_keychain.master",
  "asset_id": "prop_keychain",
  "asset_type": "prop",
  "stage": "master",
  "depends_on": [],
  "prompt": "<style_prefix>, product shot of <prop.description>, isolated on plain neutral background, even soft studio lighting, three-quarter front view, <style_suffix>",
  "negative_prompt": "<style_negative>, multiple objects, hands, people, cluttered background",
  "reference_images": [],
  "size": "1024x1024",
  "quality": "high",
  "background": "transparent",       // 道具用透明背景便于合成
  "output_path": "assets/props/prop_keychain/master.png",
  "qa_thresholds": {"identity": 0.0, "style": 0.80, "tech": 0.90}
}
```

#### 三视图任务（依赖 master）

```jsonl
{
  "task_id": "prop_keychain.view.front",
  "depends_on": ["prop_keychain.master"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.75>, <prop.description>, front view, isolated on plain neutral background, even soft studio lighting, <style_suffix>",
  "reference_images": ["assets/props/prop_keychain/master.png"],
  "background": "transparent",
  "output_path": "assets/props/prop_keychain/views/front.png",
  "qa_thresholds": {"identity": 0.80, "style": 0.80, "tech": 0.85}
}
```

side / back 同形。

### 5.3 入队次要道具（仅 front，无依赖）

```jsonl
{
  "task_id": "prop_coffee_cup.front",
  "asset_id": "prop_coffee_cup",
  "asset_type": "prop",
  "stage": "front",
  "depends_on": [],
  "prompt": "<style_prefix>, product shot of <prop.description>, front view, isolated on plain neutral background, even soft studio lighting, <style_suffix>",
  "negative_prompt": "...",
  "reference_images": [],
  "size": "1024x1024",
  "background": "transparent",
  "output_path": "assets/props/prop_coffee_cup/front.png",
  "qa_thresholds": {"identity": 0.0, "style": 0.80, "tech": 0.85}
}
```

### 5.4 环境参考增强（可选）

如果 `prop.appears_in_scenes` 非空且 `config.asset_granularity.prop.in_scene = true`：

```jsonl
{
  "task_id": "prop_keychain.in_scene.scene_apt_living",
  "depends_on": ["prop_keychain.master", "scene_apt_living.establishing"],
  "prompt": "<style_prefix>, <prop.description> in context of <scene.description>, natural placement, indoor lighting, <style_suffix>",
  "reference_images": [
    "assets/scenes/scene_apt_living/establishing.png",
    "assets/props/prop_keychain/master.png"
  ],
  "output_path": "assets/props/prop_keychain/in_scene/scene_apt_living.png"
}
```

默认关闭（成本考量）。

### 5.5 调用 generation-loop

所有道具任务入队后：

```
invoke modules/generation-loop.md on _cache/queue/active.jsonl
```

预估时间：一个 4 道具项目（6-8 张图）≈ 1-2 分钟。

### 5.6 队列消费完后：渲染道具卡

用 `templates/scene-card.md.j2`（复用，简化版）渲染 `docs/props/<prop.id>.md`。

### 5.7 道具 JSON 片段

写入 `_cache/m5-prop-pack.json` 的 `props[]` 数组：

```json
[
  {
    "id": "prop_keychain",
    "name": "钥匙",
    "tier": "primary",
    "appears_in_scenes": ["scene_apt_living", "scene_coffee_corner"],
    "held_by": "char_lin_qing",
    "ref_images": {
      "master": "assets/props/prop_keychain/master.png",
      "views": {
        "front": "assets/props/prop_keychain/views/front.png",
        "side": "...", "back": "..."
      }
    },
    "prompt_fragment": "small brass keychain with a vintage carved key and a leather tag",
    "negative_prompt": "modern plastic, electronic key",
    "ref_strength_recommended": 0.75,
    "qa_scores": {"tech_avg": 0.93, "style_avg": 0.88, "retry_count": 0}
  },
  {
    "id": "prop_coffee_cup",
    "name": "咖啡杯",
    "tier": "secondary",
    "appears_in_scenes": ["scene_coffee_corner"],
    "ref_images": {"front": "assets/props/prop_coffee_cup/front.png"},
    "prompt_fragment": "white ceramic coffee cup with simple latte art",
    "negative_prompt": "",
    "ref_strength_recommended": 0.70,
    "qa_scores": {"tech_avg": 0.90, "style_avg": 0.87, "retry_count": 0}
  }
]
```

### 质检后处置（无独立 HITL）

- 所有道具默认 qa 通过即放过
- qa 不过且重抽 3 次仍不过：自动转人工，在 6-pack-export 时高亮显示
- 用户可在 6-pack-export 后手动 `redo prop_<id>`

## 输出

- `assets/props/<id>/`
- `docs/props/<id>.md`
- `_cache/m5-prop-pack.json`

## 错误与边界

- prop.description 极度抽象（如"一个东西"）：跳过该道具并报告，让用户在剧本里补描述
- 不同场景里同一道具看起来不同（如客厅的钥匙和咖啡馆的钥匙形状不一样）：这是下游抽卡 Agent 的责任（按 prop_id 强制引用 master），本模块只保 master 一致

## 下游契约

`_cache/m5-prop-pack.json` 提供给：

- `6-pack-export`：合并到 assets.json 的 `props[]`
- 下游抽卡 Agent：当镜头需要某道具，按 prop_id 取 master / views，作为 reference image 之一传给视频模型
