# 数据模型

> Postgres + Prisma。下面用接近 Prisma 的写法描述，字段名在代码里用 camelCase。
> 时间戳一律存 UTC（`timestamptz`）；取货日期存 `date`（不带时区，指芝加哥当地的那一天）。金额一律是美分整数。

## 1. 表

### Setting（只有一行）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| orderingEnabled | bool | **false** | 接单总开关 |
| cutoffTime | text | `"20:00"` | 截止时刻（芝加哥时间） |
| defaultDoughLimitG | int | 1600 | 开放日期没单独设置时用 |
| defaultDeliveryLimit | int | 8 | 同上 |
| deliveryFeeCents | int | 500 | 不满门槛时的运费 |
| freeDeliveryMinCents | int | 2500 | 免运费门槛（套餐折扣后的小计） |
| maxQtyPerItem | int | 8 | 每单每款上限 |
| ownerWechatId | text | `""` | 显示在成功页、订单页 |
| showWechatOnHome | bool | false | 是否在首页页脚也显示店主微信号 |
| pickupNote | text | `"自提时间在下午 5 点以后，具体时间微信确认"` | |
| bakingTextBread | text | `"正在为你制作大面包！"` | 订单含面团类商品时 |
| bakingTextOther | text | `"正在为你制作布蕾！"` | 订单只有独立限额商品时 |
| updatedAt | timestamptz | | |

### Product

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| name | text | 例如"奶酥红豆包" |
| description | text | |
| imageUrl | text? | 封面照片的冗余副本（= 第一张 ProductImage，每次改照片同步）；空时显示兔子占位图 |
| fieldColor | text? | 首页背景色 `#RRGGBB`（大写，CHECK 约束），空 = 默认奶白 `#EFE7DA`（D95）；字色由 `src/lib/fieldColor.ts` 按对比度算出 |
| unitPriceCents | int | |
| bundleSize | int | 默认 4 |
| bundlePriceCents | int? | 空 = 没有套餐 |
| capacityMode | enum | `DOUGH_PER_UNIT` / `DOUGH_PER_ROUND` / `INDEPENDENT` |
| doughG | int? | `DOUGH_PER_UNIT` 必填 |
| roundG | int? | `DOUGH_PER_ROUND` 必填 |
| piecesPerRound | int? | `DOUGH_PER_ROUND` 必填 |
| dailyLimit | int? | `INDEPENDENT` 必填，默认上限 |
| batchYield | int? | 只用于生产汇总（布蕾 3） |
| leadDays | int | 面团类默认 1，布蕾 2 |
| pickupWeekdays | int[] | 可取货的星期几（D115），0 = 周日 … 6 = 周六，按芝加哥取货日期算；`[]` = 每天都可以（默认，现有商品不变）。存成从小到大、不重复；选满 7 天存成 `[]`。CHECK：只能是 0–6、没有 NULL、不能 7 个都有。迁移 `20261027120000_product_pickup_weekdays` |
| status | enum | `ACTIVE` / `PAUSED` / `ARCHIVED`（下架，前台不显示） |
| sortOrder | int | |

用 Zod 校验"方式 ↔ 必填字段"的对应关系，数据库层加 CHECK 约束兜底。

### ProductImage（D98）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| productId | uuid → Product | 删商品时级联删除 |
| url | text | `/api/images/<key>` |
| sortOrder | int | 0 = 封面；每次增删/排序后重排成 0..n-1；索引 (productId, sortOrder)，不设唯一约束（交换顺序时不会冲突） |
| createdAt | timestamptz | |

每款商品最多 6 张（服务器在持有商品行锁的事务里检查）。迁移 `20261026120000_product_colour_and_photos`：已有 `imageUrl` 的商品各得一条 sortOrder 0 的 ProductImage；按名字给现有商品设 fieldColor（奶酥红豆包 #DCC5BB、岩烧乳酪包 #F0BF45、奶酪角 #CFDDEA、焦糖布蕾 #B05219、巧克力奶酥吐司 #5A3A2A，名字不存在就跳过）。

### OpenDate

| 字段 | 类型 | 说明 |
|---|---|---|
| date | date，主键 | 取货日期 |
| isOpen | bool | 店主取消勾选后为 false，行保留（锁和历史都需要它） |
| doughLimitG | int? | 空 = 用默认值 |
| deliveryEnabled | bool | 默认 true |
| deliveryLimit | int? | 空 = 用默认值 |
| note | text? | 店主备注 |

### OpenDateProductLimit

`(date, productId)` 主键，`limit int`。为独立限额商品按天覆盖上限。

### Order

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| pickupDate | date | 外键 → OpenDate.date |
| seq | int | 这一取货日的第几单；`unique(pickupDate, seq)` |
| orderNo | text | 显示用，`MMDD-NNN`，例如 `1024-003` |
| viewToken | text，unique | 32 字节随机数的 base64url（43 个字符） |
| wechatId | text | 去掉首尾空格，1–40 个字符 |
| fulfillment | enum | `PICKUP` / `DELIVERY` |
| status | enum | 见第 2 节 |
| subtotalCents / deliveryFeeCents / totalCents | int | 下单或改单时算好存下 |
| note | text? | 顾客备注，最多 300 字 |
| cutoffAt | timestamptz | 见 `CAPACITY_RULES.md` 第 6 节 |
| source | enum | `WEB` / `ADMIN` |
| paid | bool | 默认 false |
| paidMethod | enum? | `WECHAT` / `ZELLE` / `VENMO` / `CASH` / `OTHER` |
| paidAt | timestamptz? | |
| idempotencyKey | text?，unique | 前端每次打开确认页生成一个 UUID |
| ipHash | text? | sha256(ip + 服务器密钥)，只用于频率限制 |
| createdAt / updatedAt / confirmedAt / cancelledAt | timestamptz | |
| cancelledBy | enum? | `CUSTOMER` / `ADMIN` |

### OrderItem

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| orderId | uuid | |
| productId | uuid | |
| nameSnapshot | text | 下单时的商品名 |
| qty | int | ≥ 1 |
| unitPriceCents / bundleSize / bundlePriceCents | 快照 | 价格按快照算，以后改价不影响 |
| lineTotalCents | int | |

**名额按商品的当前设置计算，价格按快照计算。** 店主改了某个商品的克数或切法，是因为以后真的要这么做，所以已有订单也按新设置占面团。改完之后，日历上会把因此超限的日期标红。

### AuditLog

| 字段 | 说明 |
|---|---|
| id、at | |
| actor | `ADMIN` / `CUSTOMER` / `SYSTEM` |
| action | 例如 `order.create`、`order.status`、`order.edit`、`order.override`、`order.cancel`、`order.paid`、`date.update`、`product.update`、`settings.update`、`ordering.toggle`、`admin.login`、`admin.login_failed` |
| entityType、entityId | |
| before、after | JSON |
| reason | 超限强制、拒绝订单时必填 |

### Notification（待发队列）

| 字段 | 说明 |
|---|---|
| id | |
| kind | `NEW_ORDER` / `CUSTOMER_CANCELLED` / `DAILY_SUMMARY` / `PASSWORD_RESET` |
| dedupeKey | unique，例如 `new_order:<orderId>`、`summary:2026-10-23` |
| payload | JSON |
| status | `PENDING` / `SENT` / `FAILED`（重试 8 次后） |
| attempts、lastError、nextAttemptAt、createdAt、sentAt | |

### 管理员

- **AdminUser**：`username` unique、`passwordHash`（argon2id）、`failedCount`、`lockedUntil`。
- **AdminSession**：`tokenHash`（cookie 里存原始随机值，表里只存 sha256）、`userId`、`expiresAt`（30 天）、`lastSeenAt`。
- **PasswordReset**：`tokenHash`、`expiresAt`（15 分钟）、`usedAt`。

### ManualIncome（手动记账，D87）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| date | date | 记在哪一天（和订单的取货日同一口径） |
| amountCents | int | > 0，美分 |
| note | text | 1–100 字 |
| paidMethod | PaidMethod | 微信 / Zelle / Venmo / 现金 / 其他 |
| createdAt / updatedAt | timestamptz | |

### ManualIncomeItem（手动记账里选填的商品）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| incomeId | uuid → ManualIncome | 删除记录时一起删 |
| productId | uuid → Product，可空 | 商品被删时置空 |
| nameSnapshot | text | 记录时的商品名 |
| qty | int | 1–999 |

增删改都写 AuditLog（entity `manual_income`）。

### RateLimitHit

`key`（例如 `order_ip:<ipHash>`）、`at`。查询最近 10 分钟的条数（D86）；超过 24 小时的记录在每 5 分钟的定时任务里清理。

### 消除大面包的表（D100–D105）

**GameTier**：店主配置的等级（最多 8 档面包 + 大面包，D107）。`id`、`productId`（→ Product，商品被删时置空）、`sortOrder`（从小到大）、`imageUrl`（去掉白底的图，可空，空则用商品封面）、`name`（可空，1–12 字符：游戏专用面包的名字，或覆盖商品名）、`fieldColor`（可空，`#RRGGBB`，有 CHECK：游戏专用面包的底色，或覆盖商品颜色；空 = 商品颜色，再空 = 预设色轮换）、`isBig`（大面包那一行，logo 图）、`createdAt`、`updatedAt`。非大面包且 `productId` 为空 = 游戏专用面包（商品被删后留下的等级也一样，名字可能为空，后台提示要先起名字）。没有任何配置时用在售商品作默认。

**GameRun**：一局。`id`、`seed`、`wechatId`、`nickname`、`tiersSnapshot`（开始时的等级配置，JSON）、`startedAt`、`finishedAt`（可空；有值说明已验证并保存）、`score`（服务器重放得到）、`drops`（通过验证的投放记录，JSON）、`dropCount`、`simSteps`（模拟步数，时长 = simSteps / 120 秒，后台给店主看）、`weekKey`（完成时所在周的周一，America/Chicago，`YYYY-MM-DD`）、`ipHash`（24 小时后由定时清理置空）、`hidden`（店主隐藏，默认 false）。索引：`(weekKey, score desc)`、`wechatId`、`lower(wechatId)`、`startedAt`。

**GameBan**：被禁的微信号，`wechatId`、`reason`、`createdAt`。唯一性不区分大小写（数据库里 `lower("wechatId")` 的唯一索引，Prisma 里写不出来，只在迁移 SQL 里）；查询用 `mode: "insensitive"`。

**GameAward**：每周一条，`weekKey`（唯一）、`runId`（→ GameRun，Restrict）、`contactedAt`、`redeemedAt`、`note`。

后台对这些表的写入都写 AuditLog（后台页面任务负责）。游戏接口使用 `RateLimitHit`，key 为 `game_start_ip:<ipHash>`、`game_finish_ip:<ipHash>`，窗口 1 小时。

## 2. 订单状态机

```
NEW ──▶ CONTACTED ──▶ CONFIRMED ──▶ BAKING ──▶ READY ──▶ COMPLETED
 │          │             │  └──────────────────▲（可跳过 BAKING）
 │          │             └──▶ READY / COMPLETED（可跳过）
 ├──────────┼─────────────┴──▶ CANCELLED（顾客：截止前；店主：任何未完成状态，需原因）
 └──────────┴──▶ REJECTED（只能从 NEW、CONTACTED，需原因）
```

- 只能往前走（可以跳过中间状态），不能退回。店主点错了，用"改单"里的"更正状态"，必须写原因并记入日志。
- 代客下单直接从 `CONFIRMED` 开始。
- `READY` 在前台按 `fulfillment` 显示"可以取货了"或"正在配送"。
- 进入 `CONFIRMED` 时写 `confirmedAt`。

### 顾客看到的状态

| 状态 | 文案 |
|---|---|
| NEW、CONTACTED | 已收到，等待确认（请加店主微信 {ownerWechatId}） |
| CONFIRMED | 已确认 |
| BAKING | 订单里有面团类商品 → `bakingTextBread`，否则 `bakingTextOther` |
| READY + PICKUP | 可以取货了 |
| READY + DELIVERY | 正在配送 |
| COMPLETED | 已完成 |
| CANCELLED、REJECTED | 订单已取消 |

## 3. 索引

- `Order(pickupDate, status)`：统计某天名额。
- `Order(wechatId, pickupDate)`：每个微信号的未确认订单数。
- `Order(createdAt desc)`：后台列表。
- `Notification(status, nextAttemptAt)`：重试。
- `RateLimitHit(key, at)`。

## 4. 下单事务（不超卖的关键）

在**一个**数据库事务里，按顺序：

1. `SELECT … FROM "OpenDate" WHERE date = $1 FOR UPDATE`。不存在或 `isOpen = false` → 拒绝。**同一天的下单从这里开始排队。**
2. 读 `Setting`：`orderingEnabled = false` → 拒绝。
3. 读购物车里的商品：有不在售的 → 拒绝；数量超过 `maxQtyPerItem` → 拒绝。
4. 算 `cutoffAt`；`now ≥ cutoffAt` → 拒绝。`now` 由调用方传入，便于测试。
4b. 购物车里有商品这天（星期几）不能取（D115）→ 拒绝 `WEEKDAY_UNAVAILABLE`（附 `productIds`）。在同一个锁住这一天的事务里检查。
5. 频率限制：IP 最近 10 分钟 ≥ 5 笔（D86），或这个微信号这天已有 2 笔 `NEW`/`CONTACTED` → 拒绝。
6. 读这一天所有占名额订单的明细，用 `CAPACITY_RULES.md` 的纯函数算 before / after：面团、每个独立限额商品、配送单数。任何一项超 → 拒绝，并返回推荐日期（推荐日期在事务外另算即可，只是展示）。
7. `seq = coalesce(max(seq), 0) + 1`（这一天已被锁住，所以安全）；生成 `orderNo`、`viewToken`。
8. 插入 Order、OrderItem、AuditLog（`order.create`）、Notification（`new_order:<id>`）。
9. COMMIT。
10. 事务**之后**尝试发送这条通知；失败只更新 Notification 的 `attempts` / `nextAttemptAt`，不影响已经成功的下单响应。

**幂等**：`idempotencyKey` 冲突时，不报错，直接返回已有订单的 `viewToken`，让前端跳转到同一个订单页。

**店主改单**：同样的流程，但第 6 步的 before 不含这笔订单原来的明细；如果改了取货日期，就**按日期从早到晚**依次锁住新旧两天，避免死锁；超限时返回所有超限项（包括 `WEEKDAY`：商品这天不能取），店主填写原因后带 `override=true` 重新提交。店主代客下单同样：星期几限制和名额一样可以写原因超限。

**顾客或店主取消**：锁住这一天 → 改状态 → 写日志 →（顾客取消时）写入 `customer_cancelled:<id>` 通知。

## 5. 必须有的数据库测试

在真实的 Postgres 上跑（本地 Docker，或 Neon 的测试分支），不能用 mock。并发测试里每个请求用**不同的微信号和 IP**，否则会先被频率限制挡住，测不到名额逻辑：

1. **并发不超卖**：某天还剩 2 个红豆包的面团（140 g），20 个请求同时各下 1 个红豆包 → 恰好 2 个成功，18 个返回"已满"，最终用量正好等于上限。
2. **奶酪角并发**：某天面团已满、奶酪角 3 个（剩 1 角），10 个请求同时各下 1 个奶酪角 → 恰好 1 个成功。
3. **布蕾并发**：剩 2 杯，10 个请求各下 1 杯 → 恰好 2 个成功。
4. **配送并发**：配送剩 1 单，5 个配送订单同时提交 → 恰好 1 个成功，其余返回"配送已满，可选自提"。
5. **幂等**：同一个 `idempotencyKey` 并发提交 5 次 → 只生成 1 笔订单，5 次都返回同一个 `viewToken`。
6. **跨日改单不死锁**：两个改单请求同时把 A→B、B→A 互换日期 → 都能完成或其中一个按超限拒绝，不会卡住。
7. **seq 唯一**：并发下单后，同一天的 `seq` 连续且不重复。
