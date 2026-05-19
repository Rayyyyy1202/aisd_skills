# Module: Asset Edit（资产微调，build 完成后的 user-facing 入口）

## 职责

对已锁定的资产做**最小范围像素改动**，覆盖两个核心场景：

1. **精确换底**：换 BG 同时保住人物像素 100%（旧"重抽 master"方案 identity 漂移 5-10%，本模块零漂移）
2. **局部微调**：自然语言定位区域（"眼睛"、"风衣领子"、"右下角水印"）→ vision LLM 推 bbox → 只在该区域重绘

## 何时调用

build 流程（0-init → 6-pack-export）跑完之后，用户在审视资产时发现需要 tweak。本模块**不在** build 主链路上，可任意次数调用、可对任意已生成资产操作。

## 工作流 A：精确换底

```
user: 把 char_lin_qing 的 master 换成白底
agent:
  1. 解析 asset_id → 找到 current master 路径
  2. 备份 current → _vN_backup/<filename>
  3. 调 edit-tools 的 replace-bg 操作
  4. 用户视觉验收（HITL）
  5. 通过则更新 assets.json.versions[]
```

底部规格 `bg_spec` 接受三种形态：
- **hex 颜色**：`#FFFFFF`、`#1B2230`、`#3F4A5C`
- **本地图像路径**：`assets/scenes/scene_apt_living/lighting/night/establishing.png`
- **scene_id**：`scene_apt_living` → 自动取该场景的 `establishing.png`

精确换底有两种实现路径（自动判断、用户可指定）：

| 方法 | 适用 | 成本 | 像素保真 |
|---|---|---|---|
| `chroma`（默认） | 源图 BG 是纯色（≥ 90% 像素同色） | $0 | 100% 前景（边缘有羽化） |
| `api` | 源图 BG 复杂 / 含光影渐变 | ~$0.10-0.15 | ≈95% 前景（gpt-image-1 智能抠图） |

**关键限制**：gpt-image-1 **不支持** `background=transparent`，所以 API 路径必须切到 `gpt-image-1`（OpenAI 仅此一个图像模型支持透明输出）。详见 `prompts/gpt-image-api.md`。

## 工作流 B：局部微调

```
user: 把 char_lin_qing 风衣改成深海军蓝
agent:
  1. 调 vision LLM locator（gpt-4o-mini vision）找"风衣"的 bbox
     → 返回 {bbox_normalized, confidence, reasoning}
     → confidence < 0.7 时停下让用户确认/手动给 bbox
  2. 在源图同尺寸上生成 rectangular alpha mask
     （透明 = 编辑区域，不透明 = 保留）
  3. 调 gpt-image-1 `/v1/images/edits` + image + mask + change prompt
     → 模型只重绘 mask 内，mask 外像素保留
  4. 备份旧版到 _vN_backup/，写新版到 output_path
  5. 用户视觉验收
  6. 通过则更新 assets.json.versions[]
```

### 自然语言区域词表（locator 支持范围）

`prompts/locator-vision-prompt.md` 规范了 vision LLM 的接口。常见的可识别区域：

- **五官**：eyes / nose / mouth / face / hair / forehead / chin / eyebrows
- **服装**：jacket / shirt / coat / collar / sleeves / pants / shoes / belt / hat / scarf
- **画面区域**：top-left / top-right / bottom-left / bottom-right / center / upper-third / lower-third
- **装饰**：watermark / signature / text / logo
- **自定义**：任何在图中可视的物体（vision LLM 兜底，confidence 反映把握度）

中文也支持（vision LLM 是多语模型），但英文一致性更高。

### Mask 形状限制

本模块默认生成 **矩形 mask**（足够覆盖 90% 微调场景）。如需多边形 / 非规则 mask：

- 用户手绘 PNG（alpha=0 表示编辑区域），传入 `mask_path` 参数
- 详见 `modules/edit-tools.md` 的 `local-edit` 签名

## 命令格式（CLI 视角，agent 据此操作）

```bash
# 精确换底
python3 _runner/edit_tools.py replace-bg <src> <bg_spec> <output> [--method chroma|api] [--tolerance N] [--feather N]

# 仅定位区域（不修改）
python3 _runner/edit_tools.py locate <image> "<region_natural_language>"

# 局部微调
python3 _runner/edit_tools.py local-edit <src> "<region>" "<change_prompt>" <output>
```

详细签名与原子操作见 `modules/edit-tools.md`。

## 版本管理

每次 edit 自动备份旧版到同目录的 `_v{N}_backup/<filename>`，N 自增。

`assets.json` 的每个 ref_images 项下应有 `versions` 数组：

```json
"versions": {
  "master": [
    {"v": 1, "path": "assets/.../master.png (current)", "source": "generated"},
    {"v": 2, "path": "assets/.../_v1_backup/master.png", "source": "edit:replace_bg:#FFFFFF",
     "edit_from_v": 1, "created_at": "..."}
  ]
}
```

`6-pack-export` 装配 `assets.json` 时读 `_v{N}_backup/` 目录填充 versions 历史。

## HITL 闸（每个 edit 操作单图确认）

| 操作类型 | 自动通过条件 | HITL 必要时机 |
|---|---|---|
| `replace-bg --method chroma` | 自动通过（无识别风险） | 仅当用户希望视觉确认 |
| `replace-bg --method api` | identity 分数 ≥ 0.90 | 低于阈值或用户指定 |
| `local-edit` | identity ≥ 0.90 + tech ≥ 0.85 | 总是（编辑改变了像素，建议人眼最后看一下） |

不通过则保留旧版（备份是 source of truth）、删除新版。

## 错误与边界

- **源图不存在**：报错 `source not found: <path>`
- **bg_spec 解析失败**：报错并列出三种支持的形态
- **locator confidence < 0.5**：报警告，要求用户手动给 bbox 或换更具体的描述
- **gpt-image-1 拒绝**（content_policy_violation）：标记 `policy_rejected`，不重试
- **/edits 限流**：透传错误，由 user 决定 cooldown / 升级 tier
- **覆盖率检查**：local-edit 后跑 identity vs source；> 0.10 漂移则警告"非编辑区可能被动"

## 下游影响

- 已 edit 的资产的下游引用（如下游抽卡 Agent 用 master 作 reference）自动指向最新版
- 不会回填 6-pack-export 的旧 assets.json；用户应该重跑 `_runner/build_assets_json.py` 让 versions 历史与 ref_images 路径同步

## 不做的事（与生产 build 流程的边界）

- 不重新跑 1-parse-script（剧本未变）
- 不重新生成 Style Bible（DNA 锁定）
- 不并发：edit 是 ad-hoc 操作，无队列、无 generation-loop，每次手动调用
- 不改 build 模块的 metadata 状态（module_status 仍是 build 完成时的快照）
