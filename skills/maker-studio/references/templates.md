# 模板复刻（Recreate）

模板 = 参数化工程：固定结构 + 可替换槽位（产品图/头像/编辑指令）。

## 流程

```bash
# 1. 浏览模板（分类：product-shot/motion/ugc/ads/posters/marketplace）
GET /v1/templates?category=product-shot&kind=image

# 2. Plan：先看 4 变体的真实价格（注意：真实计价按模型单价，不是模板标价）
POST /v1/plan {"templateId": "<id>", "count": 4}
# → {cost:{total}, balance:{after}, valid, issues}

# 3. 上传产品图（必填）与头像（可选）
POST /v1/assets  (multipart file)  → {asset:{id}}

# 4. 复刻
POST /v1/templates/:id/recreate
{"productAssetId": "...", "avatarAssetId": "...", "edit": "换成哑光背景", "count": 4}
```

## 给用户的建议话术

- "选个模板，我帮你换上你的产品图，出 4 个变体。"
- edit 指令写**改什么**（背景/光线/角度），模板已固定构图与风格。
- `count` 上限 4；余额不足时 plan 会提前报 402，先充值或减 count。

## 变体验收

4 个变体一起回来后逐个请用户 approve/reject；reject 的可以免费重渲一次
（`POST /v1/generations/item/:id/regenerate`，每产物限一次）。
