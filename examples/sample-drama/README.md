# Sample Drama Workspace

一个端到端样例：从选题到视频的完整 P0 产出（手工填充版，便于 schema 校验调试）。

不实际调任何 T2I/T2V API — 所有图片/视频路径都指向占位文件。用于：

1. 验证 5 个 P0 schema 是否能在真实数据上通过
2. 验证 5 个 skill 之间的 referential integrity 是否一致
3. 给新开发者一个"产物长什么样"的参考

## 故事简介

**Logline**：升职宴上她敬酒被泼脸，转身掏出了实控人印章。

- 平台：douyin
- 时长：60s
- 类型：office_drama (反转爽剧)
- 受众：都市职场女性 24-30
- 结构：multi_reversal (3 幕 6 拍)

## 工作目录布局

```
sample-drama/
├── README.md           ← 本文件
└── aisd/               ← 模拟用户运行 5 个 skill 后的 cwd 产出
    ├── 01-topic/
    │   ├── output.json
    │   └── report.md
    ├── 02-script/
    │   ├── output.json
    │   └── script.md
    ├── 03-assets/
    │   ├── output.json
    │   └── 拍摄手册.md
    ├── 04-storyboard/
    │   ├── output.json
    │   └── shotlist.md
    └── 05-video/
        ├── output.json
        └── (preview.mp4 占位)
```

实际图片/视频文件未提交（避免仓库膨胀），路径指向 `__placeholder__/<name>`。

## 验证脚本

```bash
# 检验所有 output.json 是否过 schema
cd examples/sample-drama
for stage in 01-topic 02-script 03-assets 04-storyboard 05-video; do
  echo "=== $stage ==="
  npx -y ajv-cli@5 validate \
    -s ../../shared/schemas/${stage#*-*-}.schema.json \
    -d aisd/$stage/output.json \
    --spec=draft2020 \
    -r ../../shared/schemas/_common.schema.json
done
```

（schema 文件名映射：`01-topic` → `01-topic.schema.json`；以此类推。）

## 引用完整性手工检查

```bash
# 03 → 02
jq -r '.characters[].source_id' aisd/03-assets/output.json | sort -u
jq -r '.characters[].id' aisd/02-script/output.json | sort -u
# 应该一致

# 04 → 02
jq -r '.shots[].scene_id' aisd/04-storyboard/output.json | sort -u
jq -r '.scenes[].id' aisd/02-script/output.json | sort -u

# 04 → 03
jq -r '.shots[].asset_refs[]' aisd/04-storyboard/output.json | sort -u
jq -r '.assets[].id' aisd/03-assets/output.json | sort -u

# 05 → 04
jq -r '.clips[].shot_id' aisd/05-video/output.json | sort -u
jq -r '.shots[].id' aisd/04-storyboard/output.json | sort -u
```

每对集合应该完全相等（子集即可，更严格是 ==）。

## 用法

把这个 workspace 当成"标准答案"：

- 设计新模块时，看实际 output.json 字段长什么样
- 改 schema 时，跑一次验证确认没有 break sample
- Phase 2 开发时，对照 sample 推断 audio_cues/sfx_marks 等 hook 字段在真实数据中如何填充
