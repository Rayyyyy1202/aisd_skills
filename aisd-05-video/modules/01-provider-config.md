# Module 1: Provider Config

> Core Question: 选定 video provider，加载 API key，校验账户健康，列出该 provider 的能力。

## Inputs

- 用户参数（可选 `--provider=`）
- 环境变量（`~/.aisd/.env` 或项目本地 `.env`）

## Provider 配置表（无预设默认 — 用户在 .env 选）

| Provider | env var | base URL | 推荐 model | first_last_frame | 说明 |
|---|---|---|---|---|---|
| `kling` | `KLING_API_KEY` | `https://api.klingai.com` | `kling-v2.1` | ✓ | 首尾帧模式最稳 |
| `runway` | `RUNWAY_API_KEY` | `https://api.runwayml.com` | `gen-3-alpha-turbo` | ✗ (仅 first frame + prompt) | 高质量但贵 |
| `vidu` | `VIDU_API_KEY` | `https://api.vidu.com` | `vidu-2.0` | ✓ | 国内可选 |
| `hailuo` | `HAILUO_API_KEY` | `https://api.minimax.chat` | `T2V-01` | ✗ | text-to-video，需要文字 prompt 即可 |
| `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.chat` | `video-01` | ✓ (limited) | 同上家但 video 端点 |
| `veo` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com` | `veo-2` | ✗ | Google 模型 |

> ⚠️ 上面的 model 名和 endpoint 路径来自公开文档，不同时期可能变化。Module 实际调用前会做健康检查（Step 2），失败就 STOP 让用户更新。

## Process

### Step 1: 读 .env

```bash
# 优先读项目本地 .env
[ -f ./.env ] && set -a && source ./.env && set +a
# 否则读用户级
[ -f ~/.aisd/.env ] && set -a && source ~/.aisd/.env && set +a

# 无默认 — 必须由用户配置
PROVIDER="${USER_PROVIDED_PROVIDER:-$AISD_VIDEO_PROVIDER}"
if [ -z "$PROVIDER" ]; then
  echo "STOP: 没有指定视频 provider。请在 .env 配 AISD_VIDEO_PROVIDER=kling|runway|vidu|hailuo|minimax|veo"
  echo "       或运行时传 --provider=<name>"
  exit 2
fi

KEY_VAR="${PROVIDER^^}_API_KEY"   # e.g. KLING_API_KEY
KEY_VAL="${!KEY_VAR}"

if [ -z "$KEY_VAL" ]; then
  echo "STOP: 缺 $KEY_VAR。请在 .env 配置或运行 export $KEY_VAR=..."
  exit 2
fi
```

### Step 2: 健康检查

调 provider 的轻量端点（list models / account info）验证 key 有效：

```bash
case "$PROVIDER" in
  kling)
    curl -fsS -H "Authorization: Bearer $KLING_API_KEY" "$KLING_API_BASE/v1/account" > /dev/null
    ;;
  runway)
    curl -fsS -H "X-Runway-Version: 2024-11-06" -H "Authorization: Bearer $RUNWAY_API_KEY" "https://api.runwayml.com/v1/organization" > /dev/null
    ;;
  # ...
esac
```

失败 → STOP，让用户检查 key / 网络。

### Step 3: 列 capability

写到 `_cache/m01-provider.json`（**字段值取决于 provider；示例为 kling**）：

```json
{
  "primary_provider": "<实际 provider>",
  "model": "<实际 model>",
  "base_url": "<实际 base url>",
  "modes_supported": ["image_to_video", "first_last_frame", "text_to_video"],
  "first_last_frame_supported": true,
  "max_duration_s": 10,
  "min_duration_s": 5,
  "supported_aspects": ["9_16", "16_9", "1_1"],
  "supported_resolutions": ["480p", "720p", "1080p"],
  "default_resolution": "1080p",
  "cost_per_5s_clip_usd": 0.35,
  "async_task": true,
  "poll_endpoint": "<provider specific>",
  "max_polls": 60,
  "poll_interval_s": 5
}
```

### Step 4: 简报

```
✓ Provider 健康：<provider name> (<model>)
  - first-last-frame: <✓ / ✗>
  - 单 clip 时长范围: <min>-<max>s
  - 单价: ~$<cost> / <unit>s
  - 异步任务，轮询周期 <interval>s

预估 12 个 shot 总成本: ~$<estimate>
```

## Decision Gate

- **`AISD_VIDEO_PROVIDER` 未设** → STOP，让用户先在 .env 配
- key 缺失 / 健康检查失败 → STOP
- provider 不支持当前 aspect → 警告并提示换 provider（或降级到 9:16 → 16:9 + 后期裁切，这需要用户确认）
- 通过 → proceed

## Data Passing to Next Module

- `provider`、`model`、`base_url`、`first_last_frame_supported` → 决定 Module 2 是否需要生成 end frame
- `max_duration_s` → Module 3 校验 shot.duration_s ≤ max
- 异步任务的 `poll_endpoint` / `max_polls` / `poll_interval_s` → Module 4 使用
