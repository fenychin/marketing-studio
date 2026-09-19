# Agentic 管线：复刻爆款 + 商品链接

## Ad Reference（复刻爆款广告）

用户上传一条参考广告视频（+可选台词、可选产品图），输出同节奏的新广告。

```bash
# 0. 上传参考视频（任何平台下载的 mp4）
POST /v1/assets (multipart) → {asset:{id}}

# 1. Plan（会真实分析参考片节奏 + 生成脚本预览，但不花钱）
POST /v1/plan
{"agent":{"type":"ad-reference","referenceAssetId":"<id>","transcript":"可选台词","tone":"friendly"}}
# → preview: {script, durationSec, beats, composer, transcriptSource, pacing}

# 2. 确认后执行
POST /v1/agents/ad-reference
{"referenceAssetId":"<id>","transcript":"...","tone":"friendly"}
```

管线做了什么：
1. ffmpeg 静音检测 → 参考片的节拍数与每拍时长；
2. 台词来源：用户粘贴 > ASR 服务（若配置 STUDIO_ASR_URL）> 无；
3. Composer：配了 LLM 走 chat completions；否则规则改写（按参考拍词数选模板变体）；
4. M4 引擎按参考时长渲染。

## Product Link（商品链接一键成片）

```bash
POST /v1/plan {"agent":{"type":"product-link","url":"https://shop.example/product"}}
# → preview: {script, product:{name, price}}

POST /v1/agents/product-link {"url":"...","tone":"premium"}
```

管线抓取商品页（OG/JSON-LD）提取标题/描述/价格/主图；主图自动入库为 product 参考素材。
抓取失败（422 scrape_failed）时：请用户直接上传产品图 + 描述，改走直连生成。

## 语气

`tone`: `energetic`（默认）/ `premium` / `friendly`。
