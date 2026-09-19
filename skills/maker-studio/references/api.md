# API 契约速查

Base URL：`http://127.0.0.1:8787`（生产以部署为准）。所有 `/v1/*` 需要凭据。

## 凭据（二选一）

```
Authorization: Bearer <jwt>     # 人类会话，POST /v1/auth/login 获取
x-api-key: <key>                # 机器调用，POST /v1/auth/api-keys 签发
```

## 鉴权端点（公开）

- `POST /v1/auth/register` `{email, password(≥8), orgName}` → `{token, apiKey, balance:500}`
- `POST /v1/auth/login` `{email, password}` → `{token}`
- `GET /v1/auth/me` → `{tenant, user, balance}`
- `POST /v1/auth/api-keys` `{label}` → `{apiKey}`（签发新 Key）

## 核心端点（需凭据）

| 方法/路径 | 用途 |
|---|---|
| `GET /v1/models?kind=image\|video` | 模型目录（creditsPerUnit、画幅、分辨率、时长枚举/区间） |
| `POST /v1/plan` | **干跑估价**，不花钱不建作业（见下） |
| `POST /v1/generations` | 创建作业 |
| `GET /v1/generations?kind=&status=` | 作业列表（含产物） |
| `GET /v1/generations/:id` | 作业详情 |
| `GET /v1/generations/:id/events` | SSE 进度流 |
| `POST /v1/generations/item/:id/review` | 验收 `{verdict:"approved"|"rejected"}` |
| `POST /v1/generations/item/:id/regenerate` | QC 拒收后免费重渲（每产物一次） |
| `GET /v1/templates?category=&kind=` | 模板目录 |
| `POST /v1/templates/:id/recreate` | 模板复刻 |
| `POST /v1/agents/ad-reference` / `product-link` | Agentic 管线 |
| `GET /v1/credits` | 余额 + 流水 |

## Plan 响应结构

```json
{
  "valid": true,
  "issues": ["code: message"],
  "cost": {"creditsPerUnit": 60, "count": 1, "total": 60},
  "balance": {"before": 1000, "after": 940},
  "preview": {"script": "...", "durationSec": 8, "beats": 3}  // agent 路径才有
}
```

## 错误码

| HTTP | code | 含义 |
|---|---|---|
| 401 | missing_credentials / invalid_api_key / invalid_token | 凭据问题 |
| 402 | insufficient_credits | 余额不足 → 引导充值 |
| 404 | not_found | 资源不存在或跨租户 |
| 429 | rate_limited / tenant_busy | 限流（Retry-After 头）或租户并发满 5 |
