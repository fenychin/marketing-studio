# Marketing Studio

自研多租户 Web 营销工作室：以 Higgsfield Marketing Studio 为交互蓝本、以 Hypit 公开架构思想为设计参考的**独立实现**。不包含 Hypit/Higgsfield 任何代码或资产。方案与合规边界见 [docs/PLAN.md](./docs/PLAN.md)。

## 快速启动

```bash
pnpm install
pnpm dev:api   # API 服务 → http://127.0.0.1:8787
pnpm dev:web   # Web 界面 → http://127.0.0.1:5273
```

演示租户密钥（请求头 `x-api-key`，多租户演示，生产替换）：`sk_demo_alpha`、`sk_demo_beta`。

## 模型与渠道

| 模型 ID | 类型 | 引擎 | 说明 |
|---|---|---|---|
| `studio-image-v1` | 图像 | mock | 程序化占位图，离线可用 |
| `gpt-image-1`（可配） | 图像 | OpenAI 兼容渠道 | 配 `STUDIO_OPENAI_*` 即注册 |
| `studio-motion-v1` | 视频 | mock | 动画 SVG 占位 |
| **`studio-render-v1`** | 视频 | **自研词锚定引擎** | 台词→词级对齐→语义时间轴→逐帧合成→FFmpeg，产出真实 MP4，字幕随当前词高亮 |
| `channel-video-v1`（可配） | 视频 | 异步任务渠道 | Seedance 类协议（submit/poll/download），配 `STUDIO_VIDEO_CHANNEL_*` 即注册 |

测试异步渠道适配器：`pnpm dev:channel` 启动本地协议模拟器（8790），再以 env 指向它启动 API。

## 结构

## 商业化层（M5 + P1）

- **认证**：Web 走 JWT（`POST /v1/auth/register | login`，scrypt 口令哈希 + 自实现 HS256）；机器走 `x-api-key`（`/v1/auth/api-keys` 签发）。Web 首次打开是登录门，可点 "Demo mode" 免登录体验；内置演示账号 `demo@studio.dev / demo12345`。
- **限流**：每租户令牌桶——通用 120 req/min、生成提交突发 10（超限 429 + Retry-After）。
- **充值**：`POST /v1/billing/checkout`（500/2000/10000 三档）→ 确认 → 积分入账；`sessionId` 幂等，真实渠道经 HMAC 签名 Webhook 回调（`STUDIO_PAYMENT_WEBHOOK_SECRET`）。
- **Plan 干跑**：`POST /v1/plan` 不花钱预检任何动作（直接生成 / 模板复刻 / agent 管线），agent 形态会真实预演节奏分析与脚本生成——报价与实际扣费同源。
- **质量与验收**：视频产物自动 QC（ffprobe 可读性/时长/黑帧/体积），硬失败自动重渲一次；人工 approve/reject，reject 后免费重渲一次（幂等）。
- **Agent Skill**：`skills/maker-studio/`（SKILL.md + 8 篇参考 + 路由表），`node scripts/sync-skills.mjs` 同步到 `.claude/` 与 `.codex/` 平文件入口。
- **BYOK 渠道**（P2）：侧栏 Integrations 添加自有渠道——凭据 AES-256-GCM 加密入库（`STUDIO_MASTER_KEY` 主密钥），端点只存 `credentialRef` 引用；BYOK 渠道默认 0 积分计价，模型选择器即时出现。API：`PUT /v1/credentials/:ref`、`POST /v1/endpoints`（详见 skills/maker-studio/references/）。
- **数据库双驱动**：`STUDIO_DB_DRIVER=sqlite`（默认）| `postgres`（开发即用 PGlite 内嵌真 Postgres 验证；托管 Postgres 走相同 SQL，见 `deploy/k8s`）。
- **存储双驱动**：`STUDIO_STORAGE_DRIVER=fs` | `s3`（自实现 SigV4，兼容 AWS S3 / MinIO / R2）。
- **部署**：`deploy/` 下 Dockerfile.api / Dockerfile.web / docker-compose.yml / k8s/studio.yaml。

```
apps/api             Fastify 5 API：多租户、积分门禁、作业队列(SSE)、Provider 抽象、内容寻址存储
apps/api/src/db      双驱动数据层：index（门面）+ sqlite + pg（PGlite）+ schema（迁移与种子）
apps/api/src/video   M4 渲染引擎：aligner（词级对齐）→ timeline（语义时间轴）→ frame（逐帧合成）→ render（resvg+FFmpeg）
apps/web             React 19 + Vite + Tailwind 4：暗色工作室 UI（登录门 / 充值 / 多租户切换）
apps/mock-channel    异步任务视频渠道模拟器（Seedance 类协议）
packages/shared      前后端共享 API 契约类型
deploy/              Dockerfile ×2、docker-compose、K8s 清单
docs/PLAN.md         架构方案、多租户设计、里程碑、合规红线
```

## 结构

```
apps/api     Fastify 5 API：多租户中间件、积分门禁、作业队列(SSE)、Provider 抽象、内容寻址存储
apps/web     React 19 + Vite + Tailwind 4：暗色工作室 UI
packages/shared  前后端共享 API 契约类型
docs/PLAN.md     架构方案、多租户设计、里程碑、合规红线
```
