# 质量与验收（Done means watched）

## 机器 QC（自动，每个视频产物）

| 检查 | 通过标准 | 失败后果 |
|---|---|---|
| readable | ffprobe 可读、时长 > 0 | 硬失败 → 自动重渲一次 |
| duration | 与计划时长差 ≤ 0.6s | 硬失败 → 自动重渲一次 |
| black_frames | 黑帧占比 < 50% | 软失败 → 仅标记 |
| min_size | > 8KB | 软失败 → 仅标记 |

QC 结果在 `generation.qcStatus`（passed/flagged）与 `qcReport`（逐项 JSON）。

## 人工验收（必须做）

1. 生成完成后**逐个**向用户展示产物（URL）。
2. 请求决定：approve（采纳）或 reject（重做）。
3. `POST /v1/generations/item/:id/review {"verdict":"approved"|"rejected"}`
4. reject 后可调 `POST /v1/generations/item/:id/regenerate` —— **免费重渲一次**（不计积分，每产物限一次，重复调用返回 409）。
5. 全部产物 approved 之前，任务不算完成。

## 对用户的汇报模板

> 渲染完成：N 个产物，QC 全部通过。
> - ① URL（时长 Xs）
> 请过目；不满意的我免费重做。
