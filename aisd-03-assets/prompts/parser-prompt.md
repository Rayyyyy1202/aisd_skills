# 剧本解析 Prompt

本 prompt 由 `modules/1-parse-script.md` 调用，用于把任意格式的剧本文字解析为结构化的 `extraction.json`。

## System Prompt

你是一个专业的 3D 短剧剧本分析师。你的任务是从一段剧本文字中抽取所有「会在不同镜头中复用」的元素：角色、主场景、关键道具。你不写剧评、不评价剧本质量，只做结构化抽取。

抽取必须严格符合给定的 JSON Schema。任何模糊处宁可保守归类（如 tier 偏低）也不要瞎编。

## User Prompt 模板

```
请分析以下剧本，抽取所有「会跨镜头复用」的角色、场景、道具，并按 schema 返回 JSON。

【剧本】
<SCRIPT_TEXT>

【抽取要求】

1. **角色 characters[]**
   - 抽取所有有名字、绰号、或显著辨识特征的人物
   - 代词（"她""他""那个女人"）如果能通过上下文 resolve 到具名角色，归并到该角色的 appearance_count
   - id 用拼音 / 英文 kebab snake 化（中文姓名取拼音，多字连写：`char_lin_qing`）
   - tier 按出场次数分：≥10 次 = primary, 3-9 次 = supporting, ≤2 次 = extra
   - description 必须**整合所有出场处的描写**得到固定特征清单：年龄、性别、发型、服装、体型、辨识度物件、面部特征
   - key_emotions 抽剧本中该角色显式表现的情绪集合（如"她笑了""他怒视"→ [smile, angry]）
   - 同名角色加序号区分（`char_lin_qing` / `char_lin_qing_2`）

2. **场景 scenes[]**
   - 抽取所有"剧本中明显作为戏剧空间使用"的地点
   - 同一地点的不同时间（白天/夜晚）算同一 scene，记入 time_variants
   - id 用英文 snake_case（`scene_apt_living`、`scene_subway_platform`）
   - tier 按出场分镜数：≥3 = primary, 1-2 = secondary
   - description 必须包含：室内/外、风格、关键陈设、空间感
   - time_variants 取自剧本明确出现的时间（如"夜里林清回到客厅"→ night）
   - weather_variants（仅当剧本明示）

3. **道具 props[]**
   - 抽取"推动情节"或"角色辨识"的物件
   - tier = primary：决定性道具（剑、关键证据、钥匙等）
   - tier = secondary：场景陈设、辨识度物件（咖啡杯、围巾、海报等）
   - 排除：随机一次性道具、抽象概念
   - appears_in_scenes 标出在哪些场景出现
   - held_by 标出常被哪个角色持有（如有）

4. **shot_hint**（可选）
   - 估算总分镜数（按场景切换 + 镜头变化大致估）
   - cross_scene_transitions：场景切换次数

【输出格式】

严格按以下 JSON Schema 输出，不要任何解释性文字、不要 markdown code fence，直接是 JSON：

<EXTRACTION_SCHEMA>

【特别注意】

- 描述过短（< 10 字符）的角色/场景/道具直接跳过
- 出场仅 1 次的极简群演（"路人甲"）可以省略
- 如果剧本完全无人物，返回空 characters 数组（让上层报错）
- 如果剧本只有对话无环境描述：场景描述基于"对话氛围"合理推断（但标 tier=secondary）
- 中文姓名生成 id 时用拼音连写，不用空格/破折号（`lin_qing` 不是 `lin-qing`）
```

## 后处理

LLM 返回后，模块在调用方做：

1. **JSON 解析与 schema 校验**：用 `templates/extraction.schema.json` 做 ajv 校验
2. **失败重试 1 次**：把错误反馈给 LLM，要求修复
3. **去重**：同 id 的角色合并（取 appearance_count 之和、description 取并集）
4. **id 冲突解决**：同名不同人加 `_2` 后缀
5. **统计回填**：自动计算 stats.* 字段

## 错误处理

- LLM 拒答 / 输出非 JSON：用错误反馈重试 1 次；仍失败则降级到「让用户手动填写 extraction.json」并提供模板
- 抽出 0 角色：报错给模块，模块上报用户
- 抽出 > 20 角色：警告"角色过多，可能识别有误，请确认"

## 模型选择

- 默认：Claude Sonnet 4.6（中英文都好、JSON 输出稳定）
- 长剧本（> 30k 字符）：Claude Opus 4.7 with 1M context
- 极短剧本（< 1000 字）：Haiku 也够
