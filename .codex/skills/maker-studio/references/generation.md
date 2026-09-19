# 直连生成：图像与视频

## 模型目录

| 模型 | 类型 | 单价 | 说明 |
|---|---|---|---|
| `studio-image-v1` | 图像 | ✦4 | mock 通道，离线演示 |
| `gpt-image-1`（可配） | 图像 | ✦40 | OpenAI images 协议渠道 |
| `studio-motion-v1` | 视频 | ✦30 | mock 动画（SVG） |
| `studio-render-v1` | 视频 | ✦60 | **自研词锚定引擎**，时长 3–30s 连续可调，输出 h264 MP4 |
| `seedance-2.5`（可配） | 视频 | ✦135 | 异步任务渠道 |

## 请求模板

```json
POST /v1/generations
{
  "kind": "video",
  "model": "studio-render-v1",
  "prompt": "旁白脚本本身——每个句子会被词级对齐并驱动字幕高亮",
  "params": {
    "aspectRatio": "9:16",       // 图像 1:1/3:4/4:3/9:16/16:9；视频 9:16/1:1/16:9
    "resolution": "720p",        // 视频可选 540p/720p/1080p
    "durationSec": 8,            // studio-render-v1 支持 3–30 任意整数
    "count": 1,                  // ≤ maxCount
    "references": [{"assetId": "...", "role": "product|avatar|reference"}]
  }
}
```

## 写 prompt 的要点（视频）

- prompt 就是**旁白台词**：按句号/问号分句，每句成为一个场景节拍；
- 句子长度决定节拍时长（词级对齐按词长分配时间）；
- 3–5 句最有效；每句 6–12 词；
- 字幕会自动以卡拉OK方式逐词高亮，无需 markup。

## 图像要点

- `count` 一次最多 4，成本线性；
- 参考图 role：`product`（要展示的产品）、`avatar`（人物一致性）；
- 描述具体光影/背景/风格比堆形容词有效。
