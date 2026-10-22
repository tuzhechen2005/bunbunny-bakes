# API 规格

> Next.js App Router 的 Route Handlers（`app/api/**/route.ts`），返回 JSON。
> 分三层：`src/domain/`（纯函数：价格、名额、截止、状态机，不碰数据库和系统时间）→ `src/server/`（数据库事务、发邮件）→ `app/api/`（薄薄一层：校验输入、取当前时间、调用 server、转成 HTTP 响应）。
> 所有输入用 Zod 校验。日期格式 `YYYY-MM-DD`（芝加哥当地日期），时间戳用 ISO 8601 UTC。金额是美分整数。

## 1. 错误格式

```json
{ "error": "FULL", "message": "这一天的预订名额已经满啦，可以选择下一个有空位的日期～", "suggestion": "2026-10-31" }
```

| error | HTTP | 含义 |
|---|---|---|
| `VALIDATION` | 422 | 输入不合法（附 `fields`） |
| `ORDERING_DISABLED` | 409 | 接单开关关闭 |
| `DATE_CLOSED` | 409 | 不是开放日期 |
| `CUTOFF_PASSED` | 409 | 已截止 |
| `PRODUCT_UNAVAILABLE` | 409 | 有商品暂停或下架 |
| `QTY_LIMIT` | 409 | 超过每单上限 |
| `FULL` | 409 | 面团或独立限额已满（附 `suggestion` 或 null） |
| `DELIVERY_FULL` | 409 | 配送已满，自提仍可 |
| `RATE_LIMITED` | 429 | 太频繁 |
| `NOT_CANCELLABLE` | 409 | 当前状态不能取消 |
| `OVER_LIMIT` | 409 | 店主操作超限，附 `violations`，可带 `override` 重试 |
| `STALE` | 409 | 店主在另一个页面已经改过这笔订单 |
| `UNAUTHORIZED` | 401 | |
| `NOT_FOUND` | 404 | 包括错误的订单链接 |

`message` 是可以直接显示给顾客或店主看的中文。

## 2. 顾客接口（不需要登录）

### GET /api/menu

```json
{
  "orderingEnabled": true,
  "products": [{ "id": "…", "name": "奶酥红豆包", "description": "…", "imageUrl": null,
                 "unitPriceCents": 249, "bundleSize": 4, "bundlePriceCents": 899,
                 "status": "ACTIVE", "leadDays": 1 }],
  "pickupNote": "自提时间在下午 5 点以后，具体时间微信确认",
  "deliveryFeeCents": 500, "freeDeliveryMinCents": 2500, "maxQtyPerItem": 8
}
```

不返回任何克数、上限、已用量。`ARCHIVED` 商品不返回。

### POST /api/availability

请求：`{ "items": [{ "productId": "…", "qty": 4 }], "fulfillment": "DELIVERY" }`

响应：

```json
{
  "orderingEnabled": true,
  "pricing": { "subtotalCents": 1998, "deliveryFeeCents": 500, "totalCents": 2498, "freeDeliveryGapCents": 502 },
  "cartProblems": [],
  "dates": [
    { "date": "2026-10-30", "state": "AVAILABLE", "cutoffAt": "2026-10-30T01:00:00Z", "cutoffLabel": "10/29 周四 20:00 截止" },
    { "date": "2026-10-31", "state": "FULL" },
    { "date": "2026-11-01", "state": "DELIVERY_FULL" }
  ]
}
```

- `state`：`AVAILABLE` / `CUTOFF` / `FULL` / `DELIVERY_FULL`。只列出今天之后、60 天之内的开放日期。
- `cartProblems`：例如 `[{ "productId": "…", "error": "QTY_LIMIT" }]`。
- 只是展示用，不锁任何东西。

### POST /api/orders

请求：

```json
{
  "items": [{ "productId": "…", "qty": 4 }],
  "pickupDate": "2026-10-30",
  "fulfillment": "PICKUP",
  "wechatId": "bunny_fan_01",
  "note": "",
  "idempotencyKey": "uuid",
  "website": ""
}
```

- `website` 是给机器人的陷阱字段，前端隐藏。不为空时返回 422 `VALIDATION`，提示文字是笼统的"提交失败，请稍后再试"，不写进数据库。
- 成功：`201 { "orderNo": "1030-004", "viewToken": "…", "url": "/o/<viewToken>" }`
- 同一个 `idempotencyKey` 再次提交：`200`，返回同一笔订单。
- 失败：见第 1 节。`FULL` 时附 `suggestion`。
- 流程见 `DATA_MODEL.md` 第 4 节。

### GET /api/o/{token}

返回顾客能看到的内容：订单号、明细（名称、数量、行金额）、小计、运费、总额、取货日期、自提或配送、顾客版状态文案（`DATA_MODEL.md` 第 2 节）、店主微信号、`pickupNote`、`canCancel`、`cancelDeadlineLabel`。

**不返回**：内部状态枚举以外的任何内部字段、付款信息、其他订单的任何信息。token 不存在一律返回 404，不区分"格式错"和"不存在"。

### POST /api/o/{token}/cancel

- 可以取消的条件见 `CAPACITY_RULES.md` 第 9 节。
- 成功 `200`，写日志，入队 `customer_cancelled:<id>` 通知。
- 已经是已取消状态：`200`（幂等）。
- 已截止：`409 CUTOFF_PASSED`，`message` 为"已过取消时间，请微信联系店主"。

## 3. 店主接口（`/api/admin/**`，需要登录）

**认证**：httpOnly、Secure、SameSite=Lax 的 session cookie。所有非 GET 请求检查 `Origin` 头必须是本站，防跨站请求伪造。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/login` | `{ username, password }`；失败统一提示"用户名或密码错误"；连续 5 次失败锁 15 分钟 |
| POST | `/api/admin/logout` | |
| POST | `/api/admin/password-reset/request` | 无参数；把重置链接发到环境变量 `ADMIN_EMAIL` |
| POST | `/api/admin/password-reset/confirm` | `{ token, newPassword }`（至少 10 位）；成功后其他所有登录失效 |
| GET | `/api/admin/dashboard` | 接单开关、今天和明天各状态的订单数、未确认提醒、未来 14 天的名额概况 |
| POST | `/api/admin/ordering` | `{ enabled }` |
| GET | `/api/admin/orders` | 筛选：`date`、`status`（可多选）、`fulfillment`、`paid`、`productId`、`q`（订单号或微信号） |
| GET | `/api/admin/orders/{id}` | 完整信息 + 专属链接 + 操作日志 |
| POST | `/api/admin/orders` | 代客下单：`{ items, pickupDate, fulfillment, wechatId, note, override?, reason? }`，从 `CONFIRMED` 开始 |
| PATCH | `/api/admin/orders/{id}` | 改单：上面任意字段 + `expectedUpdatedAt`；超限时返回 `OVER_LIMIT` |
| POST | `/api/admin/orders/{id}/status` | `{ to, reason?, expectedUpdatedAt }`；只能往前走；`REJECTED`、`CANCELLED` 必须写原因 |
| POST | `/api/admin/orders/{id}/correct-status` | `{ to, reason }`：点错时往回改，必须写原因 |
| POST | `/api/admin/orders/{id}/payment` | `{ paid, method? }` |
| GET | `/api/admin/calendar?from=&to=` | 每天：是否开放、各项上限、已用量、超限标记 |
| PUT | `/api/admin/dates/{date}` | `{ isOpen, doughLimitG, deliveryEnabled, deliveryLimit, productLimits: { productId: n }, note }`；把上限调到低于已用量时返回警告，要店主确认 |
| GET/POST | `/api/admin/products` | 列表 / 新增 |
| PATCH | `/api/admin/products/{id}` | 修改；改了名额相关字段时，返回因此超限的开放日期 |
| POST | `/api/admin/products/{id}/image` | 上传图片（Vercel Blob），最大 5 MB，jpg/png/webp |
| GET/PUT | `/api/admin/settings` | |
| GET | `/api/admin/logs?entityId=&from=&to=` | |

**`expectedUpdatedAt`**：店主在两个页面里同时改同一笔订单时，后提交的那个返回 `STALE`，提示刷新，不会悄悄覆盖。

**`OVER_LIMIT` 响应例子**：

```json
{ "error": "OVER_LIMIT", "message": "这样会超过上限",
  "violations": [{ "kind": "DOUGH", "date": "2026-10-30", "limit": 1600, "after": 1720, "over": 120 },
                 { "kind": "DELIVERY", "date": "2026-10-30", "limit": 8, "after": 9, "over": 1 }] }
```

店主填写原因后，带 `override: true, reason: "…"` 再提交一次。

## 4. 定时任务接口

由 cron-job.org 调用，请求头带 `Authorization: Bearer <CRON_SECRET>`，否则返回 401。

| 路径 | 频率（America/Chicago） | 做什么 |
|---|---|---|
| POST `/api/cron/outbox` | 每 5 分钟 | 发送 `nextAttemptAt ≤ now` 的待发通知；清理过期的频率记录和登录会话 |
| POST `/api/cron/summary` | 每天 20:05 | 生成生产汇总（`CAPACITY_RULES.md` 第 10 节）并入队，`dedupeKey = summary:<明天日期>`，重复调用只发一次 |

两个接口都必须可以安全地重复调用。

## 5. 环境变量

| 名称 | 说明 |
|---|---|
| `DATABASE_URL` | Neon 连接串（带连接池的那个） |
| `DIRECT_URL` | Neon 直连串，给 Prisma 迁移用 |
| `RESEND_API_KEY` | |
| `MAIL_FROM` | 例如 `🐰的大面包 <orders@bunbunnybakes.com>` |
| `ADMIN_EMAIL` | 店主的通知邮箱（店主本人知道，不写进仓库） |
| `ADMIN_USERNAME`、`ADMIN_INITIAL_PASSWORD` | 只在第一次初始化时用，之后在后台改密码 |
| `SITE_URL` | 例如 `https://bunbunnybakes.com`，用于邮件链接和 Origin 检查 |
| `CRON_SECRET` | |
| `IP_HASH_SECRET` | |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |

`.env.example` 进仓库（只有名称，没有值）；`.env` 不进仓库。
