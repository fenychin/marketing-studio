# 故障排查

## 作业失败（status=failed）

`job.error` 含原因。常见：

| error 特征 | 原因 | 处理 |
|---|---|---|
| `ffmpeg exited` | 渲染器环境问题 | 重试一次作业；持续失败报告运营 |
| `channel 5xx` / `submit failed` | 上游渠道故障 | 换渠道或稍后重试；用户余额未扣 |
| `task ... timed out` | 异步渠道超 10 分钟 | 取消并改用本地渲染模型 |

## 卡住不动

- `running` 长时间无进度：进程重启会自动恢复（running → queued），等一轮 worker 周期；
- `queued` 不动：租户并发已满（5 个），先取消（`hypit` 之外无 cancel 端点——等待完成即可）。

## QC ⚠

- duration 类失败已自动重渲过一次；仍 ⚠ 则展示给用户并建议 reject → 免费重渲；
- black_frames 警告可能来自深色场景，向用户说明后可 approve。

## 401 / 404 速查

- 401 invalid_token：JWT 过期（7 天）→ 重新 login；
- 404 且确定资源存在：**跨租户访问**——检查用的是哪个凭据；
- 产物 URL 404：`?t=` 令牌缺失，重新 `GET /v1/generations/:id` 取新 URL。

## 环境自查

- `GET /health` → 服务存活；
- ffmpeg/ffprobe 必须在 PATH（渲染与 QC 依赖）；
- 模型列表为空 → 渠道 env 未配置。
