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
| `WEEKDAY_UNAVAILABLE` | 409 | 购物车里有商品这天（星期几）不能取（D115），附 `productIds` |
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
                 "status": "ACTIVE", "leadDays": 1, "pickupWeekdays": [] }],
  "pickupNote": "自提时间在下午 5 点以后，具体时间微信确认",
  "deliveryFeeCents": 500, "freeDeliveryMinCents": 2500, "maxQtyPerItem": 8
}
```

`pickupWeekdays`：可取货的星期几（0 = 周日 … 6 = 周六），`[]` = 每天（D115）。`images`：公开照片地址，按显示顺序，封面在前，0–6 张；`imageUrl` 永远等于 `images[0] ?? null`。`field`：这款商品的首页颜色（背景、字色、次要字色，十六进制），永远有值（没设置时是奶白）。订单视图里的商品 `imageUrl` 仍是封面。

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
    { "date": "2026-10-31", "state": "FULL",
      "hints": [{ "kind": "REDUCE", "remove": [{ "productId": "…", "qty": 1 }] },
                { "kind": "SPLIT", "reason": "CAPACITY", "here": [{ "productId": "…", "qty": 2 }],
                  "rest": [{ "productId": "…", "qty": 1 }], "restDate": "2026-10-30" }] },
    { "date": "2026-11-01", "state": "DELIVERY_FULL" },
    { "date": "2026-11-02", "state": "WEEKDAY",
      "hints": [{ "kind": "SPLIT", "reason": "WEEKDAY", "here": [{ "productId": "…", "qty": 2 }],
                  "rest": [{ "productId": "…", "qty": 1 }], "restDate": null }] }
  ]
}
```

- `state`：`AVAILABLE` / `CUTOFF` / `WEEKDAY` / `FULL` / `DELIVERY_FULL`（优先级见 `CAPACITY_RULES.md` §7）。`WEEKDAY`：这天开放、没截止，但购物车里至少有一款商品这天（星期几）不能取。只列出今天之后、60 天之内的开放日期。
- `hints`（可选）：只出现在 `FULL` / `WEEKDAY` 的日期上，而且只有算得出提示时才有（规则见 `CAPACITY_RULES.md` §7.2）。只有购物车数量，没有克数、上限、已用量、剩余量。`REDUCE`：购物车去掉 `remove` 后，这天能作为一单放下。`SPLIT`：这天先下 `here`，`rest` 留在购物车；`restDate` 是 `rest` 单独能订的最近日期（`WEEKDAY` 时可能为 `null`）。
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

### 游戏大厅与本周发奖游戏（D133、D134）

`GET /api/game/hub`（公开，`Cache-Control: no-store`）→
`{ week: { start, end }, prizeGame: "BIG" | "TU", games: [{ kind, name, href, weekBest: number | null }] }`。
周日期是 America/Chicago 的周一到周日（`YYYY-MM-DD`）。只返回已启用游戏的名字、链接和有效周榜最高分；无人上榜为 `null`，0 分保留为 0，不返回昵称、微信号或内部局记录。现有启用列表在 `src/lib/gameCatalog.ts`，第三个游戏接入时再加入。

首次读取该周时持久化随机发奖游戏，排除上周选择；并发读取不会重复抽取。周一冠军 cron 也会初始化新一周。

- `GET /api/admin/game/prize` → `{ weekKey, game, chosenBy: "RANDOM" | "OWNER", createdAt }`。
- `PATCH /api/admin/game/prize` `{ game: "BIG" | "TU" }` → 同上。仅可改当前周，不接受 `week` 或其他字段。需要后台登录、同源 Origin；非法或未启用游戏为 `422 VALIDATION`。写入 `chosenBy = OWNER`，同一事务写 `game.prize` AuditLog（before / after）；重复相同 OWNER 选择不重复记日志。读取不覆盖手动选择。

### 消除大面包（D100–D105，`/api/game/**`，公开）

引擎在 `src/lib/game/`（纯 TS，固定步长 1/120 秒，只用 + − × ÷ 和 `Math.sqrt/min/max/abs/floor`，V8 和 JavaScriptCore 结果逐位一致）。服务端实现在 `src/server/game.ts`、`gameTiers.ts`、`gameWeek.ts`。三个接口都带 `Cache-Control: no-store`；JSON 内容类型必填，请求体有大小上限（start 4 KB，finish 64 KB）。

**`POST /api/game/start`** `{ wechatId, nickname }` → `201 { runId, seed, tiers: [{ id, radius, points, imageUrl, color: { bg, ink }, name }], expiresAt }`

- `wechatId` 规则同下单（1–40 字符）；`nickname` 去掉首尾空格后 1–10 个字符（按 Unicode 字符数），不能含控制字符、换行、双向覆盖字符。不合格 `422 VALIDATION`（带 `fields`）。
- 被禁的微信号（不区分大小写）：`422 VALIDATION`，`message` 为友好提示。
- `seed` 来自 `crypto.randomBytes`；每局只能结束一次。`expiresAt` = 开始之后的下一个周一 0:00（America/Chicago，夏令时自动处理），这一局在此之前都可以提交（D111，客户端存档用同一个时间作废）；没有 2 小时的限制了。
- `tiers` 按从小到大排列，最后一项 `id` 恒为 `"big"`。店主配置了至少 2 个商品等级就用店主的（`GameTier`），否则用在售商品（按菜单顺序，最多 8 个）+ 大面包，图为商品封面。`radius` 以棋盘宽度为 1，约 0.071 → 0.268（商品等级 0.071 → 0.215，大面包 0.268；D106）。每次只掉最小的 3 档，商品等级 ≥ 7 时 4 档；`points` 为合成出该级得分（等级序号的三角数 × 10，大面包等级也是），`color` 来自商品首页背景色。
- 这一份等级配置在开始时存进 `GameRun.tiersSnapshot`，之后改配置只影响新的局。
- 每个等级带 `name`（游戏专用面包自己的名字，否则是商品名；大面包是店名；只用于显示，不进重放快照）。没有图片的等级（游戏专用面包在店主上传图片之前）画成底色圆 + 名字的第一个字。

**后台等级接口**（`/api/admin/game/tiers`，需要登录 + Origin 检查，写入都记 AuditLog；商品等级 + 游戏专用面包合计最多 8 档、至少 2 档，`422 VALIDATION`）

- `GET`：`{ configured, tiers: [{ id, productId, productName, isBig, gameOnly, name, fieldColor, imageUrl, productImageUrl, color }], products }`。`gameOnly` = 没有商品的非大面包等级；`fieldColor` 是这一档自己的底色（空 = 用商品的）。
- `POST` `{}` 保存默认；`{ productId }` 加商品等级；`{ name, fieldColor }` 加游戏专用面包（`name` 去首尾空格后 1–12 个字符、无控制字符，`fieldColor` 为 `#RRGGBB`）→ `201`，审计 `game.tier.add`。
- `PATCH /tiers/{id}`：`{ productId }` 换商品；或 `{ name?, fieldColor? }` 改名字 / 底色（任何非大面包等级；`fieldColor: null` 恢复成商品的颜色，游戏专用面包不能清空底色）→ 审计 `game.tier.update`。
- `DELETE /tiers/{id}`、`PUT /tiers/order`、`POST|DELETE /tiers/{id}/image`：对游戏专用面包同样适用。
- 同一 IP 每小时最多 60 次（`RATE_LIMITED`，`game_start_ip:<ipHash>`）。

**`POST /api/game/finish`** `{ runId, drops: [{ x, at }] }` → `200 { score, best, rank, week: { start, end }, personalBest, newRecord }`

- `x` ∈ [0,1]，`at` 为投放时的模拟步数（整数 0–200000），`drops` 最多 600 个，相邻两次至少 30 步（冷却 0.25 秒）。形状不对、超限、冷却违规、游戏结束后还在投放，一律 `422 VALIDATION`，这一局保持未结束，可以再提交。
- 服务器用这一局的 `seed` 和开始时的等级快照重放（最后一次投放之后继续模拟到静止或游戏结束，把连锁合成算进去），分数以服务器为准；客户端发来的任何分数字段都被忽略。
- 一局只结束一次：重复提交返回已保存的结果（以第一次的投放记录为准），并发重复也只写一次。未知 `runId` → `404 NOT_FOUND`；到了 `expiresAt`（含这一刻）→ `422 VALIDATION`（「这一局已经过期，请重新开始」）；该微信号在此期间被禁 → `422 VALIDATION`。
- `weekKey` = 完成时刻所在周的周一（America/Chicago）`YYYY-MM-DD`。`best` 是该微信号（不区分大小写）本周最高分，`rank` 是本周排名（分数高在前，同分先完成者在前；隐藏的记录和被禁的微信号不参与），`week.start` 周一，`week.end` 周日。
- 引擎自己在 600 次投放（第 600 次之后冷却一过）或 200000 步（约 27 分钟）时结束游戏，客户端和服务器用同一套上限，所以很长的一局也能正常计分；超出上限的投放记录（601 条以上）才会被拒绝。
- 防作弊的真实时间检查：模拟的时长（`步数 / 120` 秒）不能超过从开始到提交的真实时间加 10 秒，否则 `422 VALIDATION`（真实玩家不可能比真实时间模拟得更快，这挡住"离线算好再一次性提交"）。
- 通过验证的局会保存证据，供店主发奖前人工确认（D103）：`GameRun.drops`（投放记录）、`dropCount`、`simSteps`（时长 = `simSteps / 120` 秒）。
- 跨周：周一 0:00（America/Chicago）之前开始的局，过了 0:00 就过期，不能再提交，所以一局永远算在开始的那一周（`weekKey` 仍按提交时刻计算，两者相同）。
- `personalBest`：该微信号（不区分大小写）所有时间的最高分，包括这一局；隐藏的记录不算。
- `newRecord`：这一局现在就是排行榜上的 `allTime`（全站历史最高）。因为同分时先完成的在前，这等于"分数严格高于之前所有算数的局"；全站第一局完成时也是 `true`。重复提交时重新计算（被别人超过后就是 `false`）。
- 同一 IP 每小时最多 60 次（`game_finish_ip:<ipHash>`）。

**`GET /api/game/leaderboard`** → `{ week: { start, end }, top: [{ rank, nickname, wechatMasked, score }] (最多 20), lastWinner: { nickname, wechatMasked, score } | null, allTime: { nickname, wechatMasked, score } | null, myBest?: number }`

- 每个微信号只出现一次（取最高分）。永远不返回完整微信号：前 2 位 + `***` + 后 2 位（4 位及以下：首位 + `***`）。
- `lastWinner`：上周 `GameAward` 指向的那一局；没有就是上周榜首。
- `allTime`（D113「👑 历史最高」）：所有周里已完成、未隐藏、微信号未被禁的局中分数最高的一局，同分先完成者在前；还没有这样的局时为 `null`。只有荣誉没有奖品。
- `myBest`：调用者在查询参数 `?wechatId=` 或请求头 `x-game-wechat` 里带上自己的微信号时返回本周最高分（没有记录时不返回该字段）。

服务端导出（给后台用）：`hasOrdered(db, wechatId)`（不区分大小写，存在状态不是 CANCELLED/REJECTED 的订单），`isBanned(db, wechatId)`，`maskWechat`，`weekKeyOf`、`weekRange`（`gameWeek.ts`）。

**后台排行榜接口**（`/api/admin/game/*`，需要登录 + Origin 检查，写入都记 AuditLog）。都接受 `?game=m3`（兔兔三连烤）、`?game=tu`（兔了个兔）或 `?game=big` / 不带（消除大面包，默认）；其他值 `422 VALIDATION`。禁止名单三个游戏共用（`/bans` 不看 `game`）。

- `GET /leaderboard?week=&game=` → `{ week, currentWeek, weeks, rows: [{ id, wechatId, nickname, score, finishedAt, verified, hidden, banned, ordered, dropCount, durationSec, suspicious, rank }], winner, bans }`，只含这个游戏的局和有局的周。兔了个兔：`dropCount` = 点击次数，`durationSec` = 最后一次点击的 `at` / 1000；`suspicious`（见下）。兔兔三连烤：`dropCount` = 交换步数，`durationSec` = 最后一步 `at` / 1000 四舍五入到秒。消除大面包的 `suspicious` 恒为 `false`。
- `PATCH /runs/{id}?game=` `{ hidden }`：这一局必须属于这个游戏，否则 `404`。
- `PATCH /award?game=` `{ week, contacted?, redeemed?, note? }`：每个游戏每周一条 `GameAward`；兔了个兔的审计 `entityId` 为 `TU:<week>`，兔兔三连烤为 `M3:<week>`。

### 兔了个兔（D121–D124，`/api/game/tu/**`，公开，C6）

引擎在 `src/lib/tu/`（见该目录 README），服务端在 `src/server/tu.ts`，排行榜、历史最高、个人最高的查询和消除大面包共用（`src/server/game.ts`，按 `GameRun.game` 分开）。规则和上面消除大面包完全一样，以下只写不同的地方。三个接口都带 `Cache-Control: no-store`，请求体上限 start 4 KB；finish 按 `MAX_TAPS × 30 bytes × 1.25 + 4 KiB` 推导（当前 754096 bytes）。

**`POST /api/game/tu/start`** `{ wechatId, nickname }` → `201 { runId, seed, tiers, expiresAt }`

- `tiers` 是消除大面包的面包等级去掉大面包（D123，`TierView` 形状相同：`id, radius, points, imageUrl, color, name`；兔了个兔只用 `id`、图片、颜色、名字），2–8 个，按等级顺序。少于 2 个（例如店里只有 1 个在售商品、店主又没配置）→ `422 VALIDATION`「兔了个兔还没准备好，请稍后再来」，不建局。
- 频率：同一 IP 每小时 60 次，key `tu_start_ip:<ipHash>`（和消除大面包分开计）。

**`POST /api/game/tu/finish`** `{ runId, taps: [{ id, at } | { p, at }] }` → `200 { score, best, rank, week, personalBest, newRecord }`（同消除大面包）

- `{ id, at }` 是点了一张牌（`id` 是牌的 id），`{ p, at }` 是用了一个道具（`p` 为 `"peek" | "bag" | "swap"`，D131）；两种写在同一个记录里，`at` 是从这一局开始（客户端）算起的整数毫秒，整体严格递增；合计最多 `MAX_TAPS`（20000）条。服务器用 `replayTu` 和开始时的等级快照重放（含道具、得道具和结束时的道具奖励；D141 每种最多 2 个，每 3 张订单的随机抽取命中已满类型时不发放、不重抽，仍消耗该次随机数）；被压住/不存在/已拿走的牌、没有或不能用的道具、游戏结束后还在点、形状不对（多余的键也算）、超限 → `422 VALIDATION`，这一局保持未结束。
- 引擎版本（C8）：`seed` 形如 `v4.<32 位十六进制>`，前缀是开局时的 `TU_ENGINE_VERSION`。版本和当前引擎不同的局（例如规则改动上线前开的局，旧种子是纯十六进制 = 版本 1）不能再提交，`422`「这一局已经过期，请重新开始」，不会按新规则错误重放；这些局本来也会在周一重置时过期，并像其他没结束的局一样被清理。客户端的自动保存键也带版本号，旧存档直接丢弃。
- 真实性检查：相邻两次点击至少 `MIN_TAP_GAP_MS`（120 ms）；最后一次的 `at` 不能超过开始到提交的真实时间加 10 秒。否则 `422`（「这一局的成绩没能通过验证」）。
- 没玩完（还没结束）的点击记录也可以提交，按已经得到的分数计。
- 保存证据（D103）：`drops` = 点击记录，`dropCount` = 点击次数，`playMs` = 最后一次 `at`，`suspicious` = 点满 `MAX_TAPS` 或点击间隔的中位数 < 300 ms。可疑的局照常上榜，只在后台标出来，店主发奖前看一下（脚本可以在客户端算出解法，服务器无法区分）。
- `消除大面包` 的 `runId` 交给这里 → `404 NOT_FOUND`（反过来也一样）。
- 频率：`tu_finish_ip:<ipHash>`，每小时 60 次。

**`GET /api/game/tu/leaderboard?wechatId=`** → 和 `/api/game/leaderboard` 同形状（`week, top, lastWinner, allTime, myBest?`），只算兔了个兔的局；`lastWinner` 看兔了个兔自己的 `GameAward`。

### 兔兔三连烤（D135，S2，`/api/game/m3/**`，公开）

服务端 `src/server/m3.ts`，引擎 `src/lib/m3/`。昵称/微信校验、共用封禁名单、周一 Chicago 00:00 过期、隐藏成绩、幂等提交、脱敏周榜、👑 历史最高和奖励资格沿用 TU。三个成功响应均为 `Cache-Control: no-store`。S2 仅开放服务端和后台，**不加入大厅和随机奖品池**，公开页面与启用由 S3 完成。

**`POST /api/game/m3/start`** `{ wechatId, nickname }` → `201 { runId, seed, tiers, expiresAt }`

- `tiers` 与 BIG 的 `TierView` 相同，按配置 `sortOrder` 取非大面包的前 6 种；沿用 BIG 的默认商品配置回退。少于 `M3_MIN_TIERS = 6` → `422 VALIDATION`「兔兔三连烤还没准备好，请稍后再来」，不建局；不使用引擎支持的 4/5 种模式参与排名。
- 将这六种的完整有序配置保存为 `tiersSnapshot`；重放严格使用其中的六个 id，不重读、重排或重新截取当前配置。
- `m3Seed` 生成 `v<M3_ENGINE_VERSION>.<32 位随机十六进制>`（当前版本 1）。未完成局缺少版本或版本不匹配 → finish `422 VALIDATION`「这一局已经过期，请重新开始」。
- start 请求体 ≤ 4096 bytes；`m3_start_ip:<ipHash>` 每小时 60 次。

**`POST /api/game/m3/finish`** `{ runId, moves: [{ a: { r, c }, b: { r, c }, at }] }` → `200 { score, best, rank, week, personalBest, newRecord }`

- 最多 `MAX_MOVES = 30` 步；`r,c` 为 0–7 整数，`at` 为非负安全整数毫秒（从开局算起），首步可为 0。每个 move 和坐标对象禁止额外字段。服务端从头 `replayM3`，忽略客户端分数；非法交换、无消除的交换、超限、非递增时间等 → `422 VALIDATION`，保持未完成。空记录、未玩完的记录也可计分。
- 相邻步至少 `MIN_MOVE_GAP_MS = 150` ms，末步 `at` ≤ 真实经过时间 + 10000 ms。保存 `drops = moves`、`dropCount = moves.length`、`playMs = 末步 at`（空记录为 0），`simSteps` 留空。
- `suspicious` 仅当相邻步间隔中位数 < `M3_SUSPICIOUS_MEDIAN_GAP_MS = 400` ms；不足两步为 false，正常完成 30 步不自动标记。可疑局仍上榜，由店主发奖前核查。
- 已完成局返回第一次保存的结果；并发 finish 只有一次写入。BIG/TU 的 runId → `404 NOT_FOUND`，反向同理。
- `m3_finish_ip:<ipHash>` 每小时 60 次；JSON 请求体上限 `ceil(MAX_MOVES × 60 bytes × 1.25) + 4096`，当前 **6346 bytes**；沿用 TU 的 `readGameJson` 检查 Content-Length 和解析前文本长度。

**`GET /api/game/m3/leaderboard?wechatId=`** → `{ week, top, lastWinner, allTime, myBest? }`，与 TU 同形状；也支持 `x-game-wechat`。只查询 M3 成绩与奖励，每个微信号取最高，大小写不敏感，同分先完成优先；隐藏/封禁排除，公开微信号脱敏。

### POST /api/assistant（小小🐰，D117、D118）

实现在 `src/server/assistant/`。需要 `Origin` 等于 `SITE_URL`（否则 `403 FORBIDDEN_ORIGIN`），JSON 内容类型，请求体最多 64 KB，`Cache-Control: no-store`。

请求：

```ts
{
  messages: { role: "user" | "assistant"; content: string }[]; // 1–12 条，每条 1–500 字符（按 Unicode 字符数），最后一条是 user
  cart: { productId: string; qty: number }[];                // 顾客纸袋，最多 50 行；只作为上下文
  fulfillment?: "PICKUP" | "DELIVERY";                         // 不填按自提查
}
```

返回：

- `200 { reply, suggestion?, remaining }`：`reply` 纯文本（去掉 HTML/Markdown/链接/不可见字符，最多 400 字符）；`suggestion = { items: { productId, qty }[], date: "YYYY-MM-DD" | null, note }`（`note` 最多 100 字符），只有模型调用了 `propose_cart` 且通过校验才有；`remaining` = 这个访客今天还能问几句。
- `429 { error: "ASSISTANT_LIMIT" }`：同一 IP 哈希每天（America/Chicago）20 句，或全站每天 500 句。先计访客、没超才计全站：访客自己超限不占全站额度；被全站上限拒绝的那一句仍算访客的一句。
- `503 { error: "ASSISTANT_UNAVAILABLE" }`：没配 `DEEPSEEK_API_KEY`（不计次数）、缺 `IP_HASH_SECRET`（不计次数）、DeepSeek 返回错误（含 402 余额不足）、网络错误、超时（见下）。网站其他功能不受影响。
- `400 { error: "VALIDATION", message, fields }`：请求体不对（注意：这里是 400，其他顾客接口是 422）。
- `403 { error: "FORBIDDEN_ORIGIN" }`：`Origin` 不对。

流程：校验 → 有 key → 计数（在调用 DeepSeek 之前，原子加一）→ 把所有消息里像微信号/电话/邮箱/地址的内容换成 `***` → 调用 `${DEEPSEEK_BASE_URL}/chat/completions`（`fetch`，非流式，`tools` + `tool_choice: "auto"`，`temperature 0.3`，`max_tokens 250`）→ 最多 3 次模型调用：最多 2 轮工具调用，第 3 次 `tool_choice: "none"` 必须直接回答。

时间预算（Netlify 函数 10 秒就会被杀）：从请求到达开始整个请求 8.5 秒（数据库读取也算在内）；每次模型调用最多 `min(剩余, 4.5 秒)`；剩余不足 1.5 秒就不再发起调用。超时或 DeepSeek 出错时：如果已经有通过校验的建议卡片 → `200 { reply: copy.assistantApi.suggestionReply, suggestion, remaining }`；否则 `503 ASSISTANT_UNAVAILABLE`。

系统提示（`prompt.ts`）：小小🐰 的身份和规则、今天日期、接单开关、截止时间、自提说明、运费和免运费门槛、每单每种上限、菜单（名字、价格、组合价、提前天数、可取货的星期、简介）、顾客纸袋和取货方式。没有店主微信号、克数、名额。

工具（全部只读，只返回公开数据；没有任何读订单的工具；参数用 Zod 校验，错了返回 `{ error }` 让模型改）：

| 工具 | 参数 | 返回 |
|---|---|---|
| `get_menu` | — | 商品（短 id `p1…`、名字、价格、组合价、状态、提前天数、可取货的日子、简介）、每种上限、是否接单 |
| `check_date` | `items, date, fulfillment?` | 服务器算的小计（配送时含运费、合计）、这一天的状态（`planCart`；不开放的日子是 `NOT_OFFERED`）、可订时的截止时间、FULL/WEEKDAY 时的办法（REDUCE / SPLIT，只有商品名和件数） |
| `find_dates` | `items, fulfillment?` | 最近 ≤ 5 个 AVAILABLE 的日子和截止时间 |
| `propose_cart` | `items, date?, note` | 校验（商品存在且在售、每种 ≤ `maxQtyPerItem`、日期填了就必须 AVAILABLE）后成为响应里的 `suggestion`，并返回服务器算的小计（配送时含运费、合计） |

`items` 里的 `product` 是 `get_menu` 的短 id（也接受商品 id 或完整商品名），同一商品会合并。

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
| GET | `/api/admin/orders` | 筛选：`date`（日期或 `all`）、`from`、`to`、`status`（可多选）、`fulfillment`、`paid`、`productId`、`q`（订单号或微信号）；`cursor` 翻页，见下 |
| GET | `/api/admin/orders/{id}` | 完整信息 + 专属链接 + 操作日志 |
| POST | `/api/admin/orders` | 代客下单：`{ items, pickupDate, fulfillment, wechatId, note, override?, reason? }`，从 `CONFIRMED` 开始 |
| PATCH | `/api/admin/orders/{id}` | 改单：上面任意字段 + `expectedUpdatedAt`；超限时返回 `OVER_LIMIT` |
| POST | `/api/admin/orders/{id}/status` | `{ to, reason?, expectedUpdatedAt }`；只能往前走；`REJECTED`、`CANCELLED` 必须写原因 |
| POST | `/api/admin/orders/{id}/correct-status` | `{ to, reason }`：点错时往回改，必须写原因 |
| POST | `/api/admin/orders/{id}/payment` | `{ paid, method? }` |
| GET | `/api/admin/calendar?from=&to=` | 每天：是否开放、各项上限、已用量、超限标记、订单数和生产汇总 `production`（D138，见下） |
| PUT | `/api/admin/dates/{date}` | `{ isOpen, doughLimitG, deliveryEnabled, deliveryLimit, productLimits: { productId: n }, note }`；把上限调到低于已用量时返回警告，要店主确认 |
| PATCH | `/api/admin/products/{id}` | 修改；改了名额相关字段时，返回因此超限的开放日期。`pickupWeekdays`（D115）：0–6 的整数数组、不能重复，存成从小到大，选满 7 天存成 `[]`（= 每天），格式不对 `VALIDATION`；改动写 `product.update` 日志 |
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

**订单列表日期与分页（D137）**：未指定 `date/from/to` 时仍只显示芝加哥当天及以后，按 `pickupDate ASC, seq ASC`。`date=YYYY-MM-DD` 只看该天；`from/to` 是含首尾的日期范围。`date=all` 不设日期上下界（优先于 `from/to`），按 `pickupDate DESC, seq DESC`，其他筛选仍有效。返回 `{ orders, nextCursor, today, products }`；每页最多 50 笔，`nextCursor` 为末笔的 `YYYY-MM-DD:seq`，无下一页时为 `null`。下一页须保留相同筛选；升序取游标之后的较大日期／同日较大序号，全部日期模式取较小日期／同日较小序号。

**日历生产汇总（D138）**：仅店主会话可访问，未登录返回 401；不加到任何顾客接口。返回 `{ independentProducts, days }`，日期范围含首尾，最多 92 天。每个 day 保留 `date/isOpen/hasRow/note/limits/overrides/usage/orderCount/over`，新增：

```ts
production: {
  bread: { productId, name, qty, rounds: { rounds, leftover } | null }[],
  independent: { productId, name, qty, batches: number | null, leftover: number | null }[],
  totalPieces: number,
  orderCount: number,
  unconfirmedCount: number
}
```

`bread/independent` 复用每日汇总的商品排序、当前商品参数和整天合计后的大圆包／批次取整（包含已有订单引用的暂停、下架商品）。`totalPieces` 为订单件数之和，不含取整多出的余量；`orderCount` 与 day 原有订单数相同，排除 `CANCELLED/REJECTED`；`unconfirmedCount` 统计 `NEW + CONTACTED`（D38），与每日汇总邮件一致。关闭日期上已有订单照算；无有效订单返回空行数组、三个计数均为 0。`PUT /api/admin/dates/{date}` 成功也返回此 day 形状。

**`expectedUpdatedAt`**：店主在两个页面里同时改同一笔订单时，后提交的那个返回 `STALE`，提示刷新，不会悄悄覆盖。

**`OVER_LIMIT` 响应例子**：

```json
{ "error": "OVER_LIMIT", "message": "这样会超过上限",
  "violations": [{ "kind": "DOUGH", "date": "2026-10-30", "limit": 1600, "after": 1720, "over": 120 },
                 { "kind": "DELIVERY", "date": "2026-10-30", "limit": 8, "after": 9, "over": 1 }] }
```

`violations` 的 `kind`：`DOUGH`、`PRODUCT`（附 `productId`）、`DELIVERY`、`DELIVERY_DISABLED`、`WEEKDAY`（D115：`{ "kind": "WEEKDAY", "date", "productId", "weekdays": [3] }`，这款商品这天不能取，`weekdays` 是它可以取的星期几）。代客下单、改单、更正状态重新占名额时都会检查。

店主填写原因后，带 `override: true, reason: "…"` 再提交一次。

## 4. 定时任务接口

由 cron-job.org 调用，请求头带 `Authorization: Bearer <CRON_SECRET>`，否则返回 401。

| 路径 | 频率（America/Chicago） | 做什么 |
|---|---|---|
| POST `/api/cron/outbox` | 每 5 分钟 | 发送 `nextAttemptAt ≤ now` 的待发通知；清理过期的频率记录和登录会话、今天以前的小小🐰 计数（`AssistantUsage`）；删除开始于本周一 0:00 之前、一直没完成且从未验分上报的游戏局（已过期；S5 保留已有进度成绩） |
| POST `/api/cron/game-winner` | 每周一 09:00 | 上周（刚结束的那一周）选中的发奖游戏排行榜第一名的邮件（D114，`NOTIFICATIONS.md` 第 6 节）入队，`dedupeKey = game_winner:<上周一>`，入队后立即发送（`send` 同 summary），重复调用只发一次；上周发奖游戏没有算数的局时返回 `{ status: "empty" }`，什么都不发 |
| POST `/api/cron/summary` | 每天 20:05 | 生成生产汇总（`CAPACITY_RULES.md` 第 10 节）并入队，`dedupeKey = summary:<明天日期>`，入队后立即发送（响应里的 `send` 是发送结果，失败的由 outbox 重试），重复调用只发一次 |

三个接口都必须可以安全地重复调用。

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
| `DEEPSEEK_API_KEY` | 小小🐰 用（D117）。不设 = `/api/assistant` 返回 503，其他不受影响。预充值余额就是花费上限 |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com` |
| `ASSISTANT_MODEL` | 可选，默认 `deepseek-chat` |

`.env.example` 进仓库（只有名称，没有值）；`.env` 不进仓库。

### 实时游戏成绩（S5 / D136，BIG、TU、M3）

- `POST /api/game/progress`、`POST /api/game/tu/progress`、`POST /api/game/m3/progress`：统一请求 `{ runId, log }`，`log` 是这一局到目前为止的完整投放／点击与道具／交换记录。返回 `{ score, live }`；从头重放，复用各游戏 finish 的结构、引擎版本、冷却和真实时间检查，不要求游戏已结束，不信任客户端分数。请求体大小上限同对应 finish。
- 每局至少间隔 8 秒；原子占位先于日志解析和重放，失败的验证也占用间隔，提前重试返回 `429`。未知／跨游戏局返回 `404`；过周、版本过期、封禁、非法操作或回退已接受日志返回 `422`。完成的局不再改写，返回已存分数及 `live: false`。
- 客户端游戏进行时每 10 秒上报，退出、`pagehide`、切后台也尝试发送完整日志；结束继续走 finish。失败不打断游戏，下次周期重试；小日志退出使用 fetch keepalive，大于 60 KiB 的日志使用普通 fetch（浏览器后台退出投递为尽力而为）。
- 已完成和未完成局的最后验分共同参与每周排名、历史最高、大厅、后台和冠军邮件。每微信号取最高分，分数相同按完成时刻／最后验分时刻升序，再按局 id 升序。周一芝加哥零点起不再接受旧局更新；已验分的未完成局保留，以最后分数结算，邮件仍按周幂等。
- 三游戏 leaderboard 响应新增 `liveScores: boolean`，`top` 每行新增 `live: boolean`；未完成且最近 30 秒内验分才为 live。大厅响应也有 `liveScores`，各游戏项有 `live`，表示当前榜首是否正在玩。页面可见时每 15 秒刷新；切后台暂停请求。显示小字「● 正在玩」，圆点使用 `c-red`。
- `LIVE_SCORES=off` 为运行时关停开关（未设置时开启，含 dev/test）：progress 在读请求体和访问数据库之前返回 404；客户端收到首次 404 后本次页面会话停止所有游戏上报。榜单返回 `liveScores: false`，只按已完成局排名、不显示 live、不自动刷新。finish 保持可用；已经保存的历史验分数据不删除。
- 四个时间常量统一在 `src/lib/liveScores.ts`；服务端开关在 `src/server/liveScores.ts`。生产部署前只需应用增量迁移 `20261030210000_game_live_scores`。
