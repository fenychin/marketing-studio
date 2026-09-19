# Marketing Studio

自研多租户 Web 营销工作室：以 Higgsfield Marketing Studio 为交互蓝本、以 Hypit 公开架构思想为设计参考的**独立实现**。不包含 Hypit/Higgsfield 任何代码或资产。方案与合规边界见 [docs/PLAN.md](./docs/PLAN.md)，模板复刻能力技术方案见 [docs/DESIGN-AD-DNA.md](./docs/DESIGN-AD-DNA.md)。

## 快速启动

```bash
# 前置：Node ≥22.13、pnpm ≥10、ffmpeg + ffprobe（渲染/解析/QC 依赖）
pnpm install
pnpm dev:api   # API 服务 → http://127.0.0.1:8787
pnpm dev:web   # Web 界面 → http://127.0.0.1:5273
pnpm --filter @studio/api test   # 测试套件（CI 同款）
```

演示租户密钥（请求头 `x-api-key`，多租户演示，生产替换）：`sk_demo_alpha`、`sk_demo_beta`。
Web 登录：内置演示账号 `demo@studio.dev / demo12345`，或点 "演示模式" 免登录。

## 核心能力

**1. 病毒广告复刻（广告参考 → AdDNA）**：粘贴一条病毒式广告，解析器以"语音节拍 × 镜头切分"双信号融合出拍（beat）结构，转写走三级降级（粘贴文本 → 词级 ASR 端口 → 语速假设），逐拍标注角色（hook/context/value/proof/offer/cta）与词数窗口；逐拍脚本重写器（规则 6 角色保底 + LLM 约束 JSON，无 LLM 也保证节奏 100% 复刻）填充台词；渲染端以拍边界为时间权威出片。`mode=strict` 时六硬门不达标直接拒绝提交。

**2. 一键商品广告（商品链接）**：提供商品链接，解析器抓取 OG + JSON-LD Product + 主图集（SSRF 逐跳防护），按 TikTok/Reels/Shorts 平台预设（节拍语法 × 时长窗）批量出片，`POST /v1/plan` 先整树报价。

**3. 复刻验收报告（recreate-report）**：六硬门自动对比参考片与成片——拍结构、每拍时长 ≤0.3s、每拍词数 ±20/25%、语速曲线 r≥0.8、Hook/CTA 位置、画幅+时长。生成卡片上 "✦ 报告" 直接查看。

**4. 编辑重渲闭环**：卡片 "✎ 编辑" 逐拍改词——拍是时间权威，改词自动 reflow 时序，重渲作业重新过六硬门验收。

**5. 渲染模板包**：`karaoke-uw`（卡拉OK口播）/ `bigtype-hook`（大字报）等，每包自带自描述 UI 面板（`GET /v1/render-templates`），参考图/og:image 经图像窄腰真实入片，产品主色驱动调色板。

## 模型与渠道

| 模型 ID | 类型 | 引擎 | 说明 |
|---|---|---|---|
| `studio-image-v1` | 图像 | mock | 程序化占位图，离线可用 |
| `gpt-image-1`（可配） | 图像 | OpenAI 兼容渠道 | 配 `STUDIO_OPENAI_*` 即注册 |
| `studio-motion-v1` | 视频 | mock | 动画 SVG 占位 |
| **`studio-render-v1`** | 视频 | **自研 AdDNA 渲染引擎** | 拍锚定时间轴 → 模板包逐帧合成 → resvg+FFmpeg，真实 MP4，3–30s |
| `channel-video-v1`（可配） | 视频 | 异步任务渠道 | Seedance 类协议（submit/poll/download），配 `STUDIO_VIDEO_CHANNEL_*` 即注册 |

商业层：JWT 认证（scrypt + 自实现 HS256）、API key **sha256 哈希存储**（明文仅签发时返回一次）、每租户令牌桶限流、充值三档（幂等 + HMAC timing-safe Webhook）、**积分预扣/退款**（提交原子预扣、失败/取消全额退款）、自动 QC（ffprobe 可读性/时长/黑帧）+ 人工验收 + 免费重渲、BYOK 渠道（AES-256-GCM 凭据库）。

## API 契约（/v1）

```
GET  /v1/models?kind=                     模型目录（含积分单价/参数枚举）
POST /v1/generations                      创建作业     DELETE /v1/generations/:id 取消
GET  /v1/generations?kind=&status=        作业+产物列表
GET  /v1/generations/:id                  详情         GET .../events SSE 进度流
POST /v1/generations/item/:id/favorite|review|regenerate
GET  /v1/generations/:id/script           可编辑脚本（AdDNA + 逐拍台词）
POST /v1/generations/:id/rerender         编辑重渲     GET .../recreate-report 复刻验收
GET  /v1/templates · POST /v1/templates/:id/recreate
POST /v1/agents/ad-reference              病毒广告复刻（mode=strict|loose）
POST /v1/agents/product-link              一键三平台（platforms 批量）
POST /v1/plan                             干跑估价（直接生成/模板/agent 全形态）
GET/POST /v1/assets · GET /v1/assets/file/:hash
POST /v1/auth/register|login · GET /v1/auth/me · GET/POST /v1/auth/api-keys
POST /v1/billing/checkout|mock/confirm|webhook · GET /v1/billing/payments
GET/POST/DELETE /v1/credentials · /v1/endpoints          BYOK 渠道
GET  /v1/render-templates                 渲染模板包目录（含 UI 面板 spec）
```

## 结构

```
apps/api             Fastify 5 API：多租户、积分预扣/退款、作业队列(SSE+取消)、Provider 抽象、BYOK
apps/api/src/agents  AdDNA 解析器(dna)、逐拍重写器(rewrite)、复刻报告(report)、平台预设(platforms)、商品抓取(fetcher)
apps/api/src/video   模板包(template-pack + packs/)、图像窄腰(image-ops)、beat 驱动时间轴、渲染器
apps/web             React 19 + Vite + Tailwind 4：暗色工作室 UI（登录/生成/编辑/报告/充值/BYOK）
apps/mock-channel    异步任务视频渠道模拟器（Seedance 类协议）
packages/shared      前后端共享 API 契约类型（含 AdDNA/RecreateReport）
deploy/              Dockerfile ×2、docker-compose、K8s 清单
docs/                PLAN.md（方案/里程碑）· DESIGN-AD-DNA.md（复刻能力技术方案）
skills/maker-studio/ Agent Skill（SKILL.md + 参考文档 + 路由表）
services/asr-sidecar 词级语音识别 sidecar（faster-whisper，见 scripts/start-asr.sh）
test/                vitest 套件（53 用例：解析/重写/渲染/取消/计费/复刻报告/编辑）
```

## 多实例部署

作业队列采用**单语句原子认领**（UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING），多个 worker 实例共享同一数据库时不会双捡同一作业；崩溃恢复、取消与积分预扣/退款均与实例数无关。当前为单实例边界的部分：限流令牌桶与 SSE 事件总线在进程内，多副本部署时建议 Redis 限流 + Redis pub/sub 转发事件，或按租户做网关粘性路由（见 deploy/k8s）。

## 环境变量

复制 `.env.example` → `.env`。全部可选，缺省即 mock 引擎 + SQLite + fs 存储：

- `STUDIO_OPENAI_*` / `STUDIO_VIDEO_CHANNEL_*`：真实图像/视频渠道
- `STUDIO_LLM_BASE_URL / STUDIO_LLM_API_KEY / STUDIO_LLM_MODEL`：LLM 文案（缺失自动回退规则模板）
- `STUDIO_ASR_URL`：词级 ASR 服务（faster-whisper 类，`POST /v1/asr` → segments+words）
- `STUDIO_DB_DRIVER=sqlite|postgres` · `STUDIO_STORAGE_DRIVER=fs|s3`
- `STUDIO_JWT_SECRET / STUDIO_MASTER_KEY / STUDIO_PAYMENT_WEBHOOK_SECRET`：生产必填
- `STUDIO_ALLOW_PRIVATE_FETCH=1`：仅 dev/test——允许抓取内网 fixture 页面

## Agent Skill

`skills/maker-studio/`（SKILL.md + 参考文档 + 路由表），`node scripts/sync-skills.mjs` 同步到 `.claude/` 与 `.codex/`。
