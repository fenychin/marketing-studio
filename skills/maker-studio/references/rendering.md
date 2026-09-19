# 渲染引擎与产物生命周期

## 词锚定渲染（studio-render-v1）

1. **对齐**：旁白脚本按句切分 → 每词按词长分配时间（合成对齐）；也接受 SRT/ASR 词级时间。
2. **时间轴**：句子 → 场景（intro/segment/outro）；每 4 词一条字幕 Cue；片尾开始时间由最后一个词推出。
3. **合成**：逐帧 SVG（30fps）——场景调色轮换、Ken-Burns、卡拉OK式当前词高亮、结束卡。
4. **编码**：resvg 栅格化 → ffmpeg libx264 → h264 MP4（yuv420p）。

**关键性质**：改台词/换语速，画面与字幕自动跟随词时间，无需手动对帧。

## 作业生命周期

```
queued → running(progress 2→100, SSE 推送) → succeeded | failed
```

- 轮询：`GET /v1/generations/:id` 看 `status/progress`；或 SSE `GET /v1/generations/:id/events`。
- 进程重启会把卡在 running 的作业自动放回队列（崩溃恢复）。
- 视频作业 QC 不过会**自动免费重渲一次**；仍不过则带 ⚠ 标记交付人工验收。

## 产物

- 内容寻址存储（sha256），URL 带 `?t=访问令牌`——令牌丢了就 404，重新拉详情即可。
- 图像 SVG/PNG；视频 MP4；`bytes`/`mime` 随作业返回。
