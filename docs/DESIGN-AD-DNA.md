# 模板 100% 复刻能力技术方案(AdDNA 协议)

> 目标:把"粘贴一条病毒式广告 → 变成你自己的广告(同噱头、同能量)"与"商品链接 → TikTok/Reels/Shorts 即用广告素材"两条能力做到**可度量的 100% 复刻**。全部代码自研;复刻的是**结构、节奏、能量与风格参数**,不复制参考片的任何帧、音频或文案原文(合规红线见 docs/PLAN.md §0)。

---

## 0. "100% 复刻"的可度量定义

复刻不是像素复制,而是**结构同构**:换掉产品后,广告的"骨架"逐项一致。验收以 `recreate-report` 自动对比参考片与成片的 AdDNA:

| 维度 | 指标 | 通过线 |
|---|---|---|
| 拍结构 | beat 数量 | 100% 一致 |
| 节奏 | 每拍时长偏差 | ≤ 0.3s |
| 能量 | 每拍词数偏差(语速代理) | ≤ ±20% |
| 能量 | 全片 words/sec 曲线形状 | 相关系数 ≥ 0.8 |
| 结构 | hook 拍位置 / CTA 拍位置 | 一致 |
| 画布 | 画幅 / 总时长 | 一致(±0.6s 内,复用现有 QC) |
| 风格(可选) | 主色距(HSL ΔE 简化) / 剪率 | 报告展示,不作硬门 |

硬门 = 前六项全绿才算 "match ≥ 95%";报告逐项给出 pass/fail 与数值,存入 generation 元数据,前端可展示。

## 1. 核心 IR:AdDNA(统一复刻协议)

两条管线(参考片解析 / 平台预设合成)产出**同一个 IR**,渲染端只消费 AdDNA——这是"模板复刻能力"的统一抽象:

```ts
// packages/shared 新增,version 不可变(wire @1 思想)
interface AdDNA {
  version: 1;
  durationSec: number;
  canvas: { aspectRatio: string; resolution: number };   // "9:16" | "1:1" | "16:9"
  beats: Beat[];                                          // 结构唯一真相
  style: StyleTokens;
  energy: EnergyProfile;
  provenance: {                                           // 信号来源与置信度(可追溯)
    transcriptSource: "pasted" | "asr" | "none";
    beatSource: "audio+scene" | "audio" | "preset";
    roleSource: "llm" | "rule";
    confidence: number;                                   // 0-1,实测信号占比
  };
}
interface Beat {
  index: number;
  role: "hook" | "context" | "value" | "proof" | "offer" | "cta";
  startSec: number; endSec: number;                       // 锚:拍边界 = 语义时间锚
  targetWords?: [number, number];                         // 逐拍词数窗口(能量约束)
  transcript?: string;                                    // 该拍原文(仅节奏统计用,不入成片)
  visual: VisualCue;                                      // 该拍视觉意图
}
interface VisualCue { template: string; emphasis: "product" | "type" | "mixed"; transition: "cut" | "fade" | "whip"; }
interface StyleTokens { paletteDominant: string[]; captionStyle: "karaoke" | "bubble" | "lower-third"; cutsPerSec: number; }
interface EnergyProfile { wordsPerSec: number[]; cutsPerSec: number[]; }
```

设计原则(吸收 hypit 公开思想、独立实现):**拍边界是唯一时间锚**,下游(脚本字数、场景切换、字幕 cue、转场)全部投影自锚点并标注 `authority`;改台词字数时视觉随锚自动 reflow,而不是反向打补丁。AdDNA 与解析 Facts 持久化到 `generations.agent` 元数据,可追溯可重放。

## 2. Feature A:Ad Reference 管线 v2(参考片 → AdDNA → 成片)

### 2.1 参考片解析器(现有 `agents/analyze.ts` 升级)

```
videoBuffer
 ├─ 语音节拍:  ffmpeg silencedetect(现有逻辑保留, 0.3s 最小段)
 ├─ 镜头切分:  ffmpeg select='gt(scene,0.3)' 提取镜头边界(新增)
 ├─ 拍融合:    语音段 × 镜头段 → 候选拍边界(并集边界 + 最短拍 0.6s 合并)
 ├─ 转写(三级降级):
 │    粘贴文本 > ASR 端口(STUDIO_ASR_URL, 词级时间戳) > 无转写(每拍按中值语速假设)
 │    ASR 返回"词窗+置信度"作为证据, 由自研确定性对齐器消费
 │    (借鉴 speech-evidence/alignment 分离思想: 证据 ≠ 时间真相, 对齐器吃纯数据、可单测)
 ├─ 角色标注:  首拍 hook、末拍 cta;transcript 存在时 LLM 逐拍标 role(JSON 输出, 校验失败回退规则)
 ├─ 风格提取:  每拍中点抽 1 帧 → k-means 主色 3 个;剪率 = 镜头数/时长
 └─ 输出 AdDNA(含 provenance.confidence)
```

### 2.2 逐拍脚本重写器(现有 `agents/compose.ts` 升级)

- **LLM 路**:不再让模型自由发挥,而是下发硬约束——逐拍 `{role, targetWords: [min,max], tone, product 槽位}`,要求**逐拍返回 JSON**;校验器纯 accept/reject(词数出窗、拍数不符即拒),拒一次重试,再失败回退规则路。
- **规则路**(现有 VARIANTS 扩展):角色从 3 个扩到 6 个(hook/context/value/proof/offer/cta),每角色短中长变体按 `targetWords` 中值选型 + 槽位插值(product.name/description/price)。**无 LLM 也保证节奏 100% 复刻,只是文案模板化**。
- **中英文**:按 transcript/商品语言选择;中文按字符权重分词(现有 `WORD_WEIGHT` 已支持 `\p{L}`,补中文语速常量 ≈ 4.5 字/秒 vs 英文 ≈ 2.75 词/秒)。

### 2.3 渲染侧:模板包系统(现有 `frame.ts` 泛化)+ Beat 驱动时间轴

```ts
// apps/api/src/video/template-pack.ts(新)
interface RenderTemplatePack {
  id: string;                       // "karaoke-uw" | "bigtype-hook" | "ugc-frame" | "product-showcase"
  roles: BeatRole[];                // 支持的拍角色
  frame(ctx: FrameContext): string; // 单帧 SVG(沿用 resvg 逐帧路线, 确定性 seed)
  ui: PanelSpec;                    // 自描述参数面板(字段/枚举/默认值) → 前端通用渲染, 新模板零前端改动
}
// FrameContext = { plan, beat, activeWord, images(已解码参考图), palette, brandTokens, rng }
```

- `timeline.ts` 扩展:**场景直接从 AdDNA.beats 投影**(拍边界=场景边界,authority=semantic),替换现在"句子=场景"的推导;字幕 cue 逻辑保留;转场(cut/fade/whip)按拍边界触发。
- **参考资产入片**:新模块 `video/image-ops.ts`,图像窄腰子集 `{fit, cover, roundRectMask, opacity, blur, dominantColor}`(sharp 实现)——产品图/og:image 真实进帧,`local-render.ts` 开始消费 `ctx.references`(现在完全忽略)。
- **时长对齐**:引擎 clamp 从 5-15s 放宽到 3-30s(与注册表 `durationRange` 一致,消除 QC 必然 flagged 的矛盾);>15s 用"静态拍帧缓存"(同一拍内无动效帧复用 PNG)控制渲染开销。

### 2.4 首发模板包 × 平台矩阵

| 模板包 | 形态 | 适用拍角色 | 平台 |
|---|---|---|---|
| `karaoke-uw` | 现有卡拉OK字幕口播泛化(结束卡/调色板参数化) | 全部 | Shorts / TikTok |
| `bigtype-hook` | 大字报 hook + 产品图 Ken-Burns | hook / offer / cta | TikTok |
| `ugc-frame` | 手机竖屏框 + 产品图 + 气泡字幕 | context / proof | TikTok / Reels |
| `product-showcase` | 参考图主视觉 + 卖点逐条弹出 | value / offer | Reels |

## 3. Feature B:Product Link 管线 v2(URL → 三平台素材包)

### 3.1 商品解析器 v2(现有 `agents/fetcher.ts` 升级)

- OG + **JSON-LD Product schema**(name/description/brand/price/reviews 摘要)+ **主图集**(og:image 多值 + JSON-LD image[] + 首屏 `<img>` 启发式:尺寸≥300px、alt 含商品词、去重),取 ≤4 张、≤5MB/张;
- **SSRF 防护**:URL 解析后 DNS 解析 IP,拒私网/环回;重定向逐跳复检;抓取大小/超时上限沿用;
- 主图自动入库(现有逻辑保留)+ **主色提取**(image-ops)驱动模板调色板。

### 3.2 平台预设 = AdDNA 骨架

```ts
const PLATFORM_PRESETS = {
  tiktok:  { aspectRatio: "9:16", durationSec: [21, 34], beats: ["hook","context","value","offer","cta"], templates: ["bigtype-hook","ugf-frame","karaoke-uw"] },
  reels:   { aspectRatio: "9:16", durationSec: [15, 30], beats: ["hook","value","value","cta"],           templates: ["product-showcase","karaoke-uw"] },
  shorts:  { aspectRatio: "9:16", durationSec: [20, 40], beats: ["hook","value","proof","cta"],           templates: ["karaoke-uw"] },
} as const;
```

### 3.3 批量生成与成本控制

一次提交 → `平台 × 变体` 作业集,内部为小 DAG:**商品解析(1 次)→ 逐平台脚本 → 逐平台渲染**;`POST /v1/plan` 先干跑整树报价(复用现有 compose/submit 分离架构);同图同脚本段的产物按内容寻址天然去重。LLM 卖点提炼失败回退规则(description 分句 + 特征词表 → 3 个 hook 候选)。

## 4. API 与数据模型变更

| 变更 | 内容 |
|---|---|
| `packages/shared` | 新增 `AdDNA` / `Beat` / `PlatformPreset` / `RecreateReport` 契约类型 |
| DB | `generations.agent` JSON 列扩容存 AdDNA + provenance(无新表,向后兼容) |
| `POST /v1/agents/ad-reference` v2 | 请求加 `mode: "strict" \| "loose"`、可选 `productAssetId`;compose 响应含 AdDNA 预览 |
| `POST /v1/agents/product-link` v2 | 请求加 `platforms: string[]`、`variantsPerPlatform`;plan 支持整树报价 |
| `GET /v1/generations/:id/recreate-report` | 参考片 vs 成片 AdDNA 逐项对比 |
| `GET /v1/render-templates` | 模板包目录 + `ui` spec(前端动态渲染参数面板) |
| QC 扩展 | `qc.ts` 增加 recreate-report 硬门(strict 模式下 report 不达标 → 自动重渲一次,沿用现有重渲机制) |

## 5. 实施里程碑(每步可独立验证,合计约 2-2.5 周)

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **R1**(2-3 天) | AdDNA IR + shared 类型 + 解析器 v1(节拍×镜头×转写三级降级) | ✅ 已验证:`packages/shared/src/ad-dna.ts` 契约类型;`apps/api/src/agents/dna.ts` 解析器(speech×scene 融合、三级转写、k-means 主色、energy/provenance);vitest 12 用例全绿(ffmpeg 现场生成 fixture、ASR mock 服务、置信度降级断言) |
| **R2**(2-3 天) | 逐拍脚本重写器(rule 6 角色 + LLM 约束 JSON 双路)+ 中文语速 | ✅ 已验证:`apps/api/src/agents/rewrite.ts`(中英 ×3 语气 ×6 角色 ×3 档长度模板、LLM 逐拍 JSON 硬约束 + 纯 accept/reject 校验器、拒绝一次重试后回退规则路、energyMatch);`composeAdReference` 已切到 buildAdDNA→rewriteScript 全链路,dna/energyMatch/language 入 job 元数据;22 用例全绿 + `/v1/plan` 实链路冒烟(上传 8s 参考片 → 3 拍逐拍在窗脚本) |
| **R3**(3-4 天) | 模板包系统 + image-ops + beat 驱动 timeline + 时长 3-30s + `karaoke-uw`/`bigtype-hook` 两包 | ✅ 已验证:`video/template-pack.ts`(自描述 ui spec + 按 beat 选包)+ 两包;`video/image-ops.ts` 参考图入片——**实现偏离原方案:SVG 原生原语(cover/clip/opacity)+ ffmpeg 预烘焙模糊代替 sharp**,零新依赖;`alignScriptToBeats`/`buildBeatRenderPlan` 拍边界成为时间权威;时长 clamp 修正 3-30s;`GET /v1/render-templates` 上线;**resvg 字体缓存修复**(loadSystemFonts 每帧 ~375ms → fontFiles ~20ms/帧);`storeArtifact` meta 打通到 generation 行;31 用例全绿;实作业冒烟:beat-anchored-v1/3 拍/240 帧/8.000s/QC passed |
| **R4**(2-3 天) | Product Link v2(解析器 v2 + 平台预设 + 批量)+ recreate-report + QC 硬门 | ✅ 已验证:`fetcher.ts` v2(OG+JSON-LD Product+主图集 ≤4、SSRF 逐跳复检+私网拒绝、`STUDIO_ALLOW_PRIVATE_FETCH` dev 覆盖);`platforms.ts` 三平台 AdDNA 骨架(tiktok 28s/5 拍、reels 23s/4 拍、shorts 30s/4 拍);`report.ts` 六硬门复刻报告(拍结构/时长/词窗/语速曲线 r≥0.8/hook-CTA 位置/画幅时长);`POST /v1/agents/product-link` 批量({jobs,job})、`POST /v1/plan` 整树报价、`GET /v1/generations/:id/recreate-report` 上线;**strict 门实现偏离:提交时硬失败(422 replica_gates_failed)而非重渲**——词窗是脚本级属性,重渲无法修复,快失败更符合 plan-then-build;实链路冒烟:本地 fixture 商品页 → 三平台各一支成片(beat-anchored/QC passed/28s·23s·30s);38 用例全绿 |
| **R5**(2 天) | Web 接线:两个 ToolModal v2(平台多选/AdDNA 预览/报告展示)+ 参数面板由 `ui` spec 驱动 | ✅ 已验证:ProductLinkModal v2(平台多选芯片、批量 `Make 3 ads`、`{jobs}` 响应处理);AdReferenceModal v2(strict 复刻门开关);`RecreateReportGates` 组件(六门 ✓/✗ + score,展开式面板)+ 生成卡片平台/Ad DNA 徽标;**顺带修复存量 bug:artifact URL 带 `?t=` 导致 `.mp4` 判断永假,视频卡从未真正以内嵌播放器渲染**(剥 query 后修复 + aspect 9:16 防塌陷);浏览器端到端:链接 → 3 素材 → 报告面板全通;38 用例全绿 |

## 6. 风险与边界

1. **无 ASR 部署时复刻精度上限**:词数/语速靠中值假设 → `provenance.confidence` 如实标注,报告中降级说明;建议后续加 faster-whisper sidecar(独立进程,走已预留的 `STUDIO_ASR_URL` 端口,自研调用协议)。
2. **LLM 不可用**:规则链路保证"结构 + 节奏 100% 复刻"永远成立,文案文采降级为模板变体——复刻能力的下限由架构保证,不依赖外部服务。
3. **版权红线**:transcript 仅用于节奏统计,原文不进成片;参考片帧/音频零复制;风格只取统计参数(主色/剪率)。recreate-report 附带合规声明。
4. **渲染性能**:30fps × 30s 逐帧 PNG 落盘开销大 → R3 先做静态拍帧缓存,流式 pipe ffmpeg 列为后续优化。
5. **前置依赖**:建议先完成上一轮计划的阶段 1 安全加固(API key 哈希 / 计费事务 / SSRF 防护——R4 的抓取器直接受益)与 vitest 框架(R1-R4 全部依赖单测)。
