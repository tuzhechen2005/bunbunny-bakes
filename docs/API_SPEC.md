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
| `RATE_LIMITED` | 429 | 太频繁（同一 IP 10 分钟最多 5 笔，D86；同一微信号同一取货日最多 2 笔未确认订单） |
| `NOT_CANCELLABLE` | 409 | 当前状态不能取消 |
| `OVER_LIMIT` | 409 | 店主操作超限，附 `violations`，可带 `override` 重试 |
| `STALE` | 409 | 店主在另一个页面已经改过这笔订单 |
| `UNAUTHORIZED` | 401 | |
| `NOT_FOUND` | 404 | 包括错误的订单链接 |
| `INTERNAL` | 500 | 服务器内部错误（不返回任何细节，`message` 为「提交失败，请稍后再试」） |

`message` 是可以直接显示给顾客或店主看的中文。

## 2. 顾客接口（不需要登录）

### GET /api/menu

```json
{
  "orderingEnabled": true,
  "products": [{ "id": "…", "name": "奶酥红豆包", "description": "…", "imageUrl": null, "images": [], "field": { "bg": "#EFE7DA", "ink": "#…", "ink2": "#…" },
                 "unitPriceCents": 249, "bundleSize": 4, "bundlePriceCents": 899,
                 "status": "ACTIVE", "leadDays": 1 }],
  "pickupNote": "自提时间在下午 5 点以后，具体时间微信确认",
  "deliveryFeeCents": 500, "freeDeliveryMinCents": 2500, "maxQtyPerItem": 8
}
```

`images`：公开照片地址，按显示顺序，封面在前，0–6 张；`imageUrl` 永远等于 `images[0] ?? null`。`field`：这款商品的首页颜色（背景、字色、次要字色，十六进制），永远有值（没设置时是奶白）。订单视图里的商品 `imageUrl` 仍是封面。

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

返回顾客能看到的内容：订单号、明细（名称、数量、行金额、`imageUrl`：商品的公开照片，没有照片或商品已删除时为 `null`）、小计、运费、总额、取货日期、自提或配送、顾客版状态文案（`DATA_MODEL.md` 第 2 节）、店主微信号、`pickupNote`、`canCancel`、`cancelDeadlineLabel`。

**不返回**：内部状态枚举以外的任何内部字段、付款信息、其他订单的任何信息。token 不存在一律返回 404，不区分"格式错"和"不存在"。

### POST /api/o/{token}/cancel

- 可以取消的条件见 `CAPACITY_RULES.md` 第 9 节。
- 成功 `200`，写日志，入队 `customer_cancelled:<id>` 通知。
- 已经是已取消状态：`200`（幂等）。
- 已截止：`409 CUTOFF_PASSED`，`message` 为"已过取消时间，请微信联系店主"。

### GET /api/images/{key}

商品照片（公开，不需要登录）。`key` 形如 `<商品id>/<32位随机十六进制>.<jpg|png|webp>`，格式不对或不存在返回 404（`..` 等路径一律 404）。返回文件本身，带 `Cache-Control: public, max-age=31536000, immutable`（key 是随机的，换照片就换 key）和 `X-Content-Type-Options: nosniff`。文件存在 Netlify Blobs（store `product-images`），在 Netlify 上不需要任何密钥；本地开发和测试用内存存储。

### 消除大面包（D100–D105，`/api/game/**`，公开）

引擎在 `src/lib/game/`（纯 TS，固定步长 1/120 秒，只用 + − × ÷ 和 `Math.sqrt/min/max/abs/floor`，V8 和 JavaScriptCore 结果逐位一致）。服务端实现在 `src/server/game.ts`、`gameTiers.ts`、`gameWeek.ts`。三个接口都带 `Cache-Control: no-store`；JSON 内容类型必填，请求体有大小上限（start 4 KB，finish 64 KB）。

**`POST /api/game/start`** `{ wechatId, nickname }` → `201 { runId, seed, tiers: [{ id, radius, points, imageUrl, color: { bg, ink } }], expiresAt }`

- `wechatId` 规则同下单（1–40 字符）；`nickname` 去掉首尾空格后 1–10 个字符（按 Unicode 字符数），不能含控制字符、换行、双向覆盖字符。不合格 `422 VALIDATION`（带 `fields`）。
- 被禁的微信号（不区分大小写）：`422 VALIDATION`，`message` 为友好提示。
- `seed` 来自 `crypto.randomBytes`；每局只能结束一次，2 小时后过期。
- `tiers` 按从小到大排列，最后一项 `id` 恒为 `"big"`。店主配置了至少 2 个商品等级就用店主的（`GameTier`），否则用在售商品（按菜单顺序，最多 5 个）+ 大面包，图为商品封面。`radius` 以棋盘宽度为 1，约 0.082 → 0.28（商品等级 0.082 → 0.247，大面包 0.28；D106）。每次只掉最小的 3 档，商品等级 ≥ 7 时 4 档；`points` 为合成出该级得分（等级序号的三角数 × 10，大面包等级也是），`color` 来自商品首页背景色。
- 这一份等级配置在开始时存进 `GameRun.tiersSnapshot`，之后改配置只影响新的局。
- 同一 IP 每小时最多 60 次（`RATE_LIMITED`，`game_start_ip:<ipHash>`）。

**`POST /api/game/finish`** `{ runId, drops: [{ x, at }] }` → `200 { score, best, rank, week: { start, end } }`

- `x` ∈ [0,1]，`at` 为投放时的模拟步数（整数 0–200000），`drops` 最多 600 个，相邻两次至少 30 步（冷却 0.25 秒）。形状不对、超限、冷却违规、游戏结束后还在投放，一律 `422 VALIDATION`，这一局保持未结束，可以再提交。
- 服务器用这一局的 `seed` 和开始时的等级快照重放（最后一次投放之后继续模拟到静止或游戏结束，把连锁合成算进去），分数以服务器为准；客户端发来的任何分数字段都被忽略。
- 一局只结束一次：重复提交返回已保存的结果（以第一次的投放记录为准），并发重复也只写一次。未知 `runId` → `404 NOT_FOUND`；超过 2 小时 → `422 VALIDATION`；该微信号在此期间被禁 → `422 VALIDATION`。
- `weekKey` = 完成时刻所在周的周一（America/Chicago）`YYYY-MM-DD`。`best` 是该微信号（不区分大小写）本周最高分，`rank` 是本周排名（分数高在前，同分先完成者在前；隐藏的记录和被禁的微信号不参与），`week.start` 周一，`week.end` 周日。
- 引擎自己在 600 次投放（第 600 次之后冷却一过）或 200000 步（约 27 分钟）时结束游戏，客户端和服务器用同一套上限，所以很长的一局也能正常计分；超出上限的投放记录（601 条以上）才会被拒绝。
- 防作弊的真实时间检查：模拟的时长（`步数 / 120` 秒）不能超过从开始到提交的真实时间加 10 秒，否则 `422 VALIDATION`（真实玩家不可能比真实时间模拟得更快，这挡住"离线算好再一次性提交"）。
- 通过验证的局会保存证据，供店主发奖前人工确认（D103）：`GameRun.drops`（投放记录）、`dropCount`、`simSteps`（时长 = `simSteps / 120` 秒）。
- 跨周：周一 0:00（America/Chicago）之前开始、之后才提交的局算新的一周（`weekKey` 以提交时刻为准）。
- 同一 IP 每小时最多 60 次（`game_finish_ip:<ipHash>`）。

**`GET /api/game/leaderboard`** → `{ week: { start, end }, top: [{ rank, nickname, wechatMasked, score }] (最多 20), lastWinner: { nickname, wechatMasked, score } | null, myBest?: number }`

- 每个微信号只出现一次（取最高分）。永远不返回完整微信号：前 2 位 + `***` + 后 2 位（4 位及以下：首位 + `***`）。
- `lastWinner`：上周 `GameAward` 指向的那一局；没有就是上周榜首。
- `myBest`：调用者在查询参数 `?wechatId=` 或请求头 `x-game-wechat` 里带上自己的微信号时返回本周最高分（没有记录时不返回该字段）。

服务端导出（给后台用）：`hasOrdered(db, wechatId)`（不区分大小写，存在状态不是 CANCELLED/REJECTED 的订单），`isBanned(db, wechatId)`，`maskWechat`，`weekKeyOf`、`weekRange`（`gameWeek.ts`）。

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
| PATCH | `/api/admin/products/{id}` | 修改；改了名额相关字段时，返回因此超限的开放日期 |
| GET/POST | `/api/admin/products` | 列表 / 新增；每个商品带 `images: [{id, url, sortOrder}]`（封面在前）和 `fieldColor`（`#RRGGBB` 或 null，大小写不限、存成大写，格式不对 `VALIDATION`） |
| POST | `/api/admin/products/{id}/images` | 追加一张照片（D98）。`multipart/form-data`，字段 `file`，一次一张；最大 5 MB，只收 jpg/png/webp（按文件头字节）；第一张就是封面；已有 6 张返回 `VALIDATION`（中文提示）；成功 201 `{ product }`，同步 `imageUrl`，写 `product.update` 日志（before/after 含 `imageUrl` 和 `images`） |
| DELETE | `/api/admin/products/{id}/images/{imageId}` | 删除一张：文件一并删除，后面的往前补，删封面则下一张成为封面；找不到 404 |
| PUT | `/api/admin/products/{id}/images/order` | `{ ids }` 必须正好列出该商品所有照片各一次（最多 6），第一个是封面；对不上返回 409 `STALE`；顺序没变不写日志 |
| POST | `/api/admin/products/{id}/image` | 旧接口（保留）：替换封面（没有照片时就是添加第一张），其余照片不动，旧封面文件删除；返回 `{ product }` |
| DELETE | `/api/admin/products/{id}/image` | 旧接口（保留）：删除封面（没有照片时什么都不做），下一张成为封面 |
| GET/PUT | `/api/admin/settings` | |
| GET | `/api/admin/logs?entityId=&from=&to=` | |
| GET | `/api/admin/ledger?month=YYYY-MM` | 记账月汇总（D87）：`{ month, revenueCents, qty, deliveryFeeCents, receivableCents, byMethod: {WECHAT,ZELLE,VENMO,CASH,OTHER,UNSPECIFIED}, days: [{ date, revenueCents, qty, receivableCents }] }`。口径：按取货日；不含已取消/已拒绝；已付款订单（含运费）和手动记录计入营业额，未付款计入待收；件数只算已付款订单和手动记录里填的商品；已付款但 `paidMethod` 为空的订单算 `UNSPECIFIED`「未注明」（D94），与明确选的「其他」分开；月份格式错误 `VALIDATION` |
| GET | `/api/admin/ledger/day?date=YYYY-MM-DD` | 日明细：同样的汇总字段加 `orders`（每单：订单号、微信号、商品、金额、运费、是否已付款、付款方式）、`manual`（手动记录）、`products`（每款件数和金额，金额是各单实际行金额相加，不重新套用套餐价；手动记录里的商品只加件数） |
| POST | `/api/admin/ledger/manual` | 记一笔。`{ date, amountCents（整数 > 0）, note（1–100 字）, paidMethod（WECHAT/ZELLE/VENMO/CASH/OTHER）, items?: [{ productId 或 name（自由填写，≤ 60 字）, qty 1–999 }]（最多 30 行） }`；返回 201 `{ entry }`；写 `manual_income.create` 日志（entity `manual_income`） |
| PATCH | `/api/admin/ledger/manual/{id}` | 修改（字段同上，整条替换，商品行整体替换）；返回 `{ entry }`；日志 `manual_income.update`，记录修改前后的值；找不到 `NOT_FOUND` |
| DELETE | `/api/admin/ledger/manual/{id}` | 删除（连同商品行）；返回 `{ ok: true }`；日志 `manual_income.delete`，记录删除前的值；找不到 `NOT_FOUND` |

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
| POST `/api/cron/summary` | 每天 20:05 | 生成生产汇总（`CAPACITY_RULES.md` 第 10 节）并入队，`dedupeKey = summary:<明天日期>`，入队后立即发送（响应里的 `send` 是发送结果，失败的由 outbox 重试），重复调用只发一次 |

两个接口都必须可以安全地重复调用。

## 5. 环境变量

| 名称 | 说明 |
|---|---|
| `DATABASE_URL` | Neon 连接串（带连接池的那个） |
| `DIRECT_URL` | Neon 直连串，给 Prisma 迁移用 |
| `RESEND_API_KEY` | |
| `MAIL_FROM` | 例如 `🐰的大面包 <orders@bunbunnybakes.shop>` |
| `ADMIN_EMAIL` | 店主的通知邮箱（店主本人知道，不写进仓库） |
| `ADMIN_USERNAME`、`ADMIN_INITIAL_PASSWORD` | 只在第一次初始化时用，之后在后台改密码 |
| `SITE_URL` | 例如 `https://bunbunnybakes.shop`，用于邮件链接和 Origin 检查 |
| `CRON_SECRET` | |
| `IP_HASH_SECRET` | |

`.env.example` 进仓库（只有名称，没有值）；`.env` 不进仓库。
