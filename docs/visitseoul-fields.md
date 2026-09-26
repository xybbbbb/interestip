# VisitSeoul 官方数据接入方案（等待 API Key 期间准备版）

> 状态：**API Key 已核验可用（2026-09-09）**。`/code/lang` 与 `/category/list` 实测通过，字段与本文档一致；下一步按第 7 节用小批量 `list` / `info` 核对详情字段后再批量导入。

## 1. 这份文档解决什么

项目第一阶段的「首尔观光地点池（P2）」决定用 **VisitSeoul OpenAPI** 作为官方数据源。现在的 `data/seoul-cortis-demo.json` 只包含 5 条 CORTIS 示例地点 + 1 条汉江公园示例观光点，全部是占位数据。

拿到 API Key 后，我们希望把**真实的首尔观光地点**也纳入地点池，让行程可以这样混合：

```text
P0 演唱会（已确定行程）
  + P1 CORTIS 关联地点（粉丝数据，独立策展 + 证据链）
  + P2 首尔官方观光地点（VisitSeoul，普通游客向）
```

本文档把 **VisitSeoul 原始字段 → 本项目地点字段**的映射关系提前定好，Key 一到位就能按脚本批量抓取、转换、入库。

## 2. API 基本信息

| 项目 | 值 |
|---|---|
| Base URL | `https://api-call.visitseoul.net/api/v1`（实测可用；官方概览页写作 `call-api.visitseoul.net`，但该域名 DNS 无法解析） |
| 认证 | HTTP Header：`VISITSEOUL-API-KEY: <你的 Key>` |
| Content-Type / Accept | `application/json;charset=UTF-8` |
| 数据格式 | JSON |
| 语言 | 经 `/code/lang` 获取，如 `en` / `ko` / `ja` / `zh-CN` 等 |

常用错误码：

| 错误码 | 含义 |
|---|---|
| `400` | 参数错误 |
| `603` | API Key 认证失败 |
| `610` | 分类代码（com_ctgry_sn）错误 |
| `611` | 内容 ID（cid）错误 |

## 3. 抓取流程

官方接口分四步，不要硬编码任何分类 ID：

```text
① GET  /category/list    → 拿 com_ctgry_sn（分类是动态 ID，示例里出现过的 ID 下次可能不同）
② GET  /code/lang        → 拿受支持的语言代码
③ POST /contents/list    → 按分类分页拿 POI 摘要（每页约 50 条）
④ POST /contents/info    → 用 cid 拿单个 POI 完整详情
```

### 请求示例

分类列表：

```http
GET /api/v1/category/list
VISITSEOUL-API-KEY: <key>
```

返回中每项包含：`com_ctgry_sn`（分类 ID）、`ctgry_nm`（分类名）、`ctgry_path`（如 `Culture > Parks`）、`ctgry_level`、`sort_no`。

内容列表（POST，body 传参）：

```json
{
  "com_ctgry_sn": "Cu8e6t5",
  "lang_code_id": "en",
  "keyword": "",
  "sort_type": "latest",
  "page_no": 1
}
```

响应含 `data[]` + `paging { page_no, page_size, total_count }` + `result_code / result_message`。分页从 `page_no = 1` 开始，按 `total_count` 决定是否继续翻页。

内容详情（POST）：

```json
{ "cid": "ENPsrn1p5" }
```

## 4. 字段映射表

左侧为 VisitSeoul 详情接口返回字段，右侧为目标数据 schema（与 `data/seoul-cortis-demo.json` 保持一致）。

| 本项目字段 | VisitSeoul 字段 | 说明 / 转换规则 |
|---|---|---|
| `id` | `cid` | 建议加前缀 `vs-`：`vs-ENPsrn1p5`，保证与 demo id（`demo-*`）不冲突 |
| `source`（新增建议） | — | 固定 `"visitseoul"`，标识官方观光数据 |
| `sourceId`（新增建议） | `cid` | 保留原始 ID，跨语言、跨库去重用 |
| `name` | `post_sj` | 用请求语言版本；优先 `zh-CN`，若该语言质量差则退回 `en` |
| `nameLocal` | `post_sj`（ko） | 单独用 `ko` 请求该地点，取韩文标题。同一地点的跨语言 ID 见 `multi_lang_list`（格式类似 `ko:KOPsrn1p5,en:ENPsrn1p5`），据此找到韩文变体的 `cid` 再调一次详情 |
| `type` | 由 `cate_depth` 推断 | 建议统一为 `sightseeing`（普通观光），粉丝地点仍是 `venue/cafe/filming_location/photo_spot`，二者靠 `interestRelated` 区分 |
| `category` | `cate_depth` / `ctgry_path` | 先保留官方分类原文（如 `Culture > Parks`），再映射一层产品标签（观光 / 美食 / 购物 / 演出等）。**映射表要等拿到真实分类列表后再定稿**，因为分类 ID 与路径内容随语言变化 |
| `interestRelated` | — | 固定 `false`，官方观光池不代表任何艺人关联 |
| `address` | `traffic.new_adres` | 新式街道地址；旧地址在 `traffic.adres` / `adres2`，可留作备注 |
| `district` | `traffic.new_adres`（解析） | 从地址字符串解析区名（如 `Yeongdeungpo-gu`）；若不可靠，可暂时留空或复用地址全文 |
| `latitude` | `traffic.map_position_y` | 官方注释称 map Y = **纬度**。值是字符串，需 `Number()` 转浮点，校验范围 [-90, 90] |
| `longitude` | `traffic.map_position_x` | 官方注释称 map X = **经度**。同上转浮点，校验范围 [-180, 180] |
| `openingHours` | `extra.cmmn_use_time` + `extra.business_days` + `extra.closed_days` | 官方多为自由文本且场馆间格式不一，先原样拼成可读文本；**确定性排程要的结构化营业时间**留到下一阶段单独建模 |
| `description` | `sumry` 或 `post_desc` | 优先 `sumry`（摘要）；`post_desc` 是 HTML，若要入库需去标签 |
| `imageUrl` | `main_img` | 取 1 张主图；核对是完整 URL 还是相对路径，尽量统一为 `https:` |
| `tags` | `tag[]` + `cate_depth` | 合并：官方分类 + 官方标签 + 产品侧标签（如 `"首尔观光"`） |
| `evidence` | — | 官方观光点**无粉丝证据链**，填空数组 `[]`（与 demo 汉江公园一致） |
| `confidence` | — | 官方数据源本身视为 `"high"` 或 `null`（非粉丝主张，不适用置信度语义）；建议置 `null` |

建议补充但不进主 schema 的字段（放在导入中间格式里）：`officialUrl`（`extra.cmmn_hmpg_url`）、`feeInfo`（`extra.trrsrt_use_chrge` / `trrsrt_use_chrge_guidance`）、`subway`（`traffic.subway_info`）、`notice`（`extra.cmmn_important`）、`multiLang`（`multi_lang_list` 原文）。

## 5. 数据清洗规则（写进导入脚本）

1. **坐标**：`map_position_y` → 纬度、`map_position_x` → 经度；字符串转数字失败或越界则丢弃该条并记录，不能写 0/NaN。
2. **跨语言去重**：同一地点多语言是不同 `cid`，主键用 `multi_lang_list` 归并；只保留一份中文/英文主记录，韩文标题填入 `nameLocal`。
3. **图片**：校验 URL 协议；`http:` 尽量升 `https:`；加载失败的图片在 UI 中要有兜底占位，不能让卡片裂图。
4. **文本**：`post_desc` 去 HTML 标签后再入 `description`（或只保留 `sumry`）；超长摘要截断。
5. **营业时间**：先按官方原文展示，不强行解析；避免编造“每天 9:00-18:00”。
6. **过期内容**：部分内容是活动/演出公告，时间字段为 `YYYY.MM.DD`，导入时区分「常设地点」和「有时效活动」；过期的活动不要混进常设地点池。

## 6. 明确不做的事

- **VisitSeoul 不含“CORTIS 去过哪里”**。官方观光池只解决 P2 普通观光；P1 粉丝地点仍走独立策展流程（官方物料 / YouTube / 粉丝社区 → 证据分级 → 人工核验），不要指望从旅游发展局 API 里搜出粉丝打卡点。
- **不硬编码分类 ID**。示例 ID（如 `Cl9s3y9`、`Cu8e6t5`）仅用于演示请求格式，每次接入先调 `/category/list`。
- **不把官方数据当粉丝证据**。导入后 `interestRelated: false`、`evidence: []`，界面里不要给它们加“为什么推荐”的粉丝故事。

## 7. 拿到 Key 后的启动步骤

```bash
# 1) 设置 Key
$env:VISITSEOUL_API_KEY = "你的key"

# 2) 核对语言代码与分类
node scripts/visitseoul-fetch.mjs langs
node scripts/visitseoul-fetch.mjs categories --lang en

# 3) 小批量试拉一个分类，人工核对字段
node scripts/visitseoul-fetch.mjs list --category <com_ctgry_sn> --lang zh-CN --max-pages 1

# 4) 抽查详情接口
node scripts/visitseoul-fetch.mjs info <cid> --lang en

# 5) 确认映射无误后，用导入脚本批量抓取 → 按第 4/5 节转换 → 输出 data/visitseoul-seoul.json
```

若 `/code/lang` 不支持 `zh-CN` 请求值，可试 `zh`，以实际返回为准；中文界面标题也可以退而求其次用英文 `post_sj`（很多首尔地点的韩文地名本就没有官方中文译名）。
