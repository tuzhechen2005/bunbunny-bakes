# 名额、价格与截止规则

> 这是最需要写对的部分。所有规则都写成**纯函数**（输入 → 输出，不读数据库、不读系统时间），放在 `src/domain/`，用本文的每一个例子做单元测试。
> 金额单位：美分（整数）。时间：America/Chicago。

## 1. 名额状态

一笔订单处于以下状态时**占名额**：

`NEW`（新订单）、`CONTACTED`（已联系）、`CONFIRMED`（已确认）、`BAKING`（制作中）、`READY`（待取货/待配送）、`COMPLETED`（已完成）

`CANCELLED`（已取消）、`REJECTED`（已拒绝）**不占**。

## 2. 价格

### 2.1 单行金额

```
line_total(qty, unit_price, bundle_size, bundle_price)
  = floor(qty / bundle_size) × bundle_price + (qty mod bundle_size) × unit_price
  （bundle_price 为空时 = qty × unit_price）
```

- 套餐只在**同一款商品**内计算，不同款不混合。
- 订单保存下单时的商品名称、单价、套餐大小、套餐价快照。之后改价格，旧订单不受影响。

### 2.2 运费与总额

```
subtotal     = Σ line_total
delivery_fee = 配送 且 subtotal < 2500 ? 500 : 0
total        = subtotal + delivery_fee
```

### 2.3 例子（默认价格）

| 商品 | 单价 | 4 件套餐 |
|---|---:|---:|
| 奶酥红豆包 | $2.49 | $8.99 |
| 岩烧乳酪包 | $2.49 | $8.99 |
| 奶酪角 | $2.99 | $10.99 |
| 焦糖布蕾 | $2.49 | $8.99 |

| # | 购物车 | 小计 | 配送运费 | 配送总额 |
|---|---|---:|---:|---:|
| P1 | 红豆包 ×3 | $7.47 | $5.00 | $12.47 |
| P2 | 红豆包 ×4 | $8.99 | $5.00 | $13.99 |
| P3 | 红豆包 ×5 | $11.48 | $5.00 | $16.48 |
| P4 | 奶酪角 ×5 | $13.98 | $5.00 | $18.98 |
| P5 | 红豆包 ×3 + 岩烧乳酪包 ×1（不混合凑套餐） | $9.96 | $5.00 | $14.96 |
| P6 | 红豆包 ×4 + 奶酪角 ×4 | $19.98 | $5.00 | $24.98 |
| P7 | 红豆包 ×4 + 岩烧乳酪包 ×4 + 奶酪角 ×4 | $28.97 | $0.00 | $28.97 |
| P8 | 布蕾 ×8 | $17.98 | $5.00 | $22.98 |
| P9 | 奶酪角 ×8 + 红豆包 ×1 | $24.47 | $5.00 | $29.47 |
| P10 | 奶酪角 ×8 + 红豆包 ×2 | $26.96 | $0.00 | $26.96 |

P9、P10 用来测 $25 的边界：$24.47 收运费，$26.96 免运费。另外要单独测**正好 2500 美分免运费、2499 美分收运费**（用纯函数直接传小计）。

## 3. 面团

### 3.1 商品的名额计算方式（每个商品三选一）

| 方式 | 字段 | 当天用量 |
|---|---|---|
| `DOUGH_PER_UNIT` 按个算面团 | `dough_g` | 当天总个数 × `dough_g` |
| `DOUGH_PER_ROUND` 按大圆包算面团 | `round_g`、`pieces_per_round` | ⌈当天总个数 ÷ `pieces_per_round`⌉ × `round_g` |
| `INDEPENDENT` 独立限额 | `daily_limit` | 不占面团，单独计数 |

默认商品：

| 商品 | 方式 | 参数 |
|---|---|---|
| 奶酥红豆包 | 按个算面团 | 70 g |
| 岩烧乳酪包 | 按个算面团 | 70 g |
| 奶酪角 | 按大圆包算面团 | 340 g，切 4 份 |
| 焦糖布蕾 | 独立限额 | 每天 24 杯，提前 2 天，一批 3 杯（只用于汇总） |

### 3.2 当天面团用量

```
dough_used(date) = Σ(按个算商品) 当天总个数 × dough_g
                 + Σ(每个按大圆包算的商品，分别计算) ⌈当天总个数 ÷ pieces⌉ × round_g
```

**"当天总个数"是这一天所有占名额订单的合计**，绝不能每单分别向上取整。

### 3.3 一笔新订单（或改单）能不能放进这一天

```
before = dough_used(这一天已占名额的订单，改单时不含这笔订单原来的内容)
after  = dough_used(上面这些订单 + 这笔订单的新内容)
允许 ⇔ after ≤ dough_limit(date)
```

必须用 `after` 整体重算，**不能**只算"这笔订单自己要多少面团"再加上去，否则奶酪角的余量会被算错。

### 3.4 例子（每天上限 1600 g）

当天已有：红豆包 8、岩烧乳酪包 8、奶酪角 4 → 560 + 560 + 340 = **1460 g**，剩 140 g。

| # | 新订单 | 加入后 | 结果 |
|---|---|---|---|
| D1 | 红豆包 ×2 | 1600 g | 可以（正好等于上限） |
| D2 | 红豆包 ×3 | 1670 g | 已满 |
| D3 | 奶酪角 ×1 | 奶酪角共 5 个 → 2 个大圆包 → 1800 g | 已满 |
| D4 | 布蕾 ×10 | 面团仍是 1460 g | 面团不受影响（另查布蕾名额） |

余量例子：当天已有红豆包 ×18（1260 g）+ 奶酪角 ×3（1 个大圆包，340 g）= **1600 g**，已经到上限。

| # | 新订单 | 加入后 | 结果 |
|---|---|---|---|
| D5 | 奶酪角 ×1 | 奶酪角共 4 个，仍是 1 个大圆包 → 1600 g | **可以**（用掉切剩的那一角） |
| D6 | 奶酪角 ×2 | 奶酪角共 5 个 → 2 个大圆包 → 1940 g | 已满 |
| D7 | 红豆包 ×1 | 1670 g | 已满 |

取消例子：在 D5 之后，奶酪角 ×3 的那笔订单取消 → 奶酪角剩 1 个，仍是 1 个大圆包，用量仍是 1600 g。**取消不一定会释放面团**，这是正确的。

## 4. 独立限额商品（布蕾）

```
used(product, date) = 当天所有占名额订单里这款商品的总数
允许 ⇔ used + 新订单数量 ≤ limit(product, date)
```

| # | 当天已有布蕾 | 新订单 | 结果 |
|---|---|---|---|
| B1 | 22 | 2 | 可以（24） |
| B2 | 22 | 3 | 已满（25） |
| B3 | 0，但店主把这天上限调成 0 | 1 | 已满 |

## 5. 配送名额

```
delivery_count(date) = 当天占名额且选了配送的订单数
允许配送 ⇔ 这天开放配送 且 delivery_count < delivery_limit(date)
```

配送满了不影响自提。

## 6. 截止时间

```
lead_days(cart)   = max(购物车里每个商品的 lead_days)   # 面包类 1，布蕾 2
cutoff(cart, D)   = (D − lead_days) 当天的 20:00，America/Chicago
可以下单 ⇔ now < cutoff                                 # 20:00:00 整点起就不行了
```

- `cutoff_time`（默认 20:00）在设置里统一设置；`lead_days` 是每个商品的字段。
- 订单创建时把算出的 `cutoff_at`（UTC 时间戳）存在订单上；店主改单时重新计算。
- 店主代客下单、改单**不受**截止时间限制。

例子（2026 年夏令时 11 月 1 日 02:00 结束）：

| # | 取货日 | 购物车 | 截止（芝加哥时间） | 截止（UTC） |
|---|---|---|---|---|
| C1 | 10/30 周五 | 只有面包 | 10/29 周四 20:00 CDT | 10/30 01:00Z |
| C2 | 10/30 周五 | 面包 + 布蕾 | 10/28 周三 20:00 CDT | 10/29 01:00Z |
| C3 | 11/01 周日 | 只有面包 | 10/31 周六 20:00 CDT | 11/01 01:00Z |
| C4 | 11/02 周一 | 只有面包 | 11/01 周日 20:00 **CST** | 11/02 02:00Z |
| C5 | 11/03 周二 | 只有布蕾 | 11/01 周日 20:00 CST | 11/02 02:00Z |

C3、C4 一定要测：同样是"前一天 20:00"，因为夏令时结束，对应的 UTC 时间差了一小时。

另外测：`now` = 截止前 1 秒 → 可以；`now` = 截止那一刻 → 不行。

## 7. 一个日期对某个购物车是否可选

按顺序检查，第一个不满足的决定显示什么：

| 顺序 | 条件 | 不满足时 |
|---|---|---|
| 0 | 接单开关已开启 | 整个下单功能关闭，显示"暂未开放预订 🍞" |
| 1 | 这一天是店主勾选的开放日期，且在今天之后 | **不显示**这一天 |
| 2 | `now < cutoff(cart, D)` | 已截止 |
| 2b | 购物车里每个商品都能在 D 的星期几取货（`pickupWeekdays` 为空 = 每天，D115） | 这天不能取（`WEEKDAY`），写明原因，例如「泡芙仅周三」 |
| 3 | 购物车里每个商品都在售 | 不能结账（购物车里标出暂停供应的商品） |
| 4 | 每款数量 ≤ 每单上限（默认 8） | 不能结账（提示"大量订购请加微信联系"） |
| 5 | 面团 `after ≤ dough_limit` | 已满 |
| 6 | 每个独立限额商品都没超 | 已满 |
| 7 | 选了配送时：这天开放配送且没满 | 显示"配送已满，可选自提" |

- 显示状态的优先级：**已截止 `CUTOFF` > 不能取 `WEEKDAY` > 已满 `FULL` > 配送已满 `DELIVERY_FULL` > 可选 `AVAILABLE`**。空购物车永远不是 `WEEKDAY`。
- 第 3、4 条与日期无关，在购物车阶段就检查。
- 页面上的状态只用来展示；**提交时服务器在事务里重新检查第 0–7 条**（见 `DATA_MODEL.md` 第 4 节）。

### 7.1 推荐下一个日期

顾客选的日期是"已满"时：从这一天往后，按日期顺序找**第一个**对整个购物车（含所选的自提或配送）第 1–7 条都满足的开放日期。找到就显示"这一天的预订名额已经满啦，可以选择 X 月 X 日～"并提供一键切换；找不到就显示"暂时没有可以容纳这个订单的日期，可以减少数量或加微信联系店主"。**不自动改日期、不自动拆单。**

### 7.2 订不下时的提示（D116）

只给 `FULL` 和 `WEEKDAY` 的日期，而且只在购物车不为空、没有第 3、4 条问题时给。提示**只有购物车里的数量**，不写克数、上限、已用量、剩余量。"放得下"一律用第 1–7 条（含所选的自提或配送）判断为可选（`AVAILABLE`）。

- **REDUCE（只给 `FULL`）**：去掉**件数最少**的一部分，剩下的这天能作为一单放下；件数相同时，先从购物车里**最后加入**的那一行去掉（也就是尽量保留前面的行）。会把购物车去空就不给。最多一条。
- **SPLIT CAPACITY（只给 `FULL`）**：`here` = 这天能放下的最大一部分（按件数，同样的平局规则，所以就是 REDUCE 留下的那部分），`rest` = 剩下的；`restDate` = 其他可见日期里离这天最近（按相差天数，相同时取较早的）、`rest` 单独可选的那天。`here` 为空或没有 `restDate` 时不给。
- **SPLIT WEEKDAY（只给 `WEEKDAY`）**：`here` = 这天的星期几能取的那些行，`rest` = 不能取的行；只有 `here` 不为空、而且 `here` 单独这天可选时才给。`restDate` 同上，可以是 `null`（界面只说「只能周三取」，不给日期按钮）。
- 顺序：REDUCE 在前，SPLIT 在后。按钮只先下 `here` 那一单；不自动拆单，两单都由顾客自己点下单。

计算是纯函数（提示搜索在 `src/domain/hints.ts`，`src/domain/availability.ts` 的 `planCart(input, date)` 返回某一天的 `{ state, hints }`，`listAvailability` 共用同一套计算）。找"最大能放下的部分"用按件数的动态规划：每行保留 0…qty 件，面团按当天总数（含已有订单）重算，大圆包照样整体向上取整；独立限额商品每行最多保留到它的剩余名额。最后结果再用第 1–7 条复核一遍。

- **空值**：接单关闭、这天不是开放日期，或不在「今天 < 日期 ≤ 今天 + 60 天」内时，`planCart(input, date)` 返回 `null`；调用方必须处理，不能直接读取 `state`、`hints`。
- **开销**：子购物车搜索是 O(n·K²)（n 行、共 K 件）；找 `restDate` 还要把其他可见开放日期按距离排序，逐个检查 `rest` 能否单独放下，找到就停，最坏全部试完。因此计算整个日期列表时，这部分状态检查次数最坏随可见开放天数的平方增长。购物车超过 300 件时不给提示。

例子（每天上限 1600 g；今天 10/22 周四；10/28 周三、10/29 周四、10/30 周五）：

| # | 情况 | 购物车（按加入顺序） | 提示 |
|---|---|---|---|
| H1 | 周三剩 70 g、周四剩 140 g，看周四 | 红豆包 ×3 | REDUCE 去掉红豆包 1；SPLIT 周四先订 2、剩 1 个订周三 |
| H2 | 同上，看周三 | 红豆包 ×3 | REDUCE 去掉 2；SPLIT 周三先订 1、剩 2 个订周四 |
| H3 | 同上，看周四 | 红豆包 ×2、岩烧 ×1 | 去掉最后加入的岩烧 1 |
| H4 | 同上，看周四 | 岩烧 ×1、红豆包 ×2 | 去掉红豆包 1 |
| H5 | 当天已有红豆包 18 + 奶酪角 3（1600 g） | 奶酪角 ×2、红豆包 ×1 | REDUCE 去掉奶酪角 1、红豆包 1（留下的 1 个奶酪角用切剩的那一角） |
| H6 | 剩 340 g | 红豆包 ×1、奶酪角 ×4 | REDUCE 去掉红豆包 1（只去 1 件；去奶酪角要去 4 件） |
| H7 | 剩 340 g | 红豆包 ×4、奶酪角 ×4 | 两种都是 4 件 → 保留前面的红豆包，去掉奶酪角 4 |
| H8 | 剩 140 g | 奶酪角 ×1（要新开一个大圆包） | 没有提示（会去空购物车） |
| H9 | 布蕾已有 22（上限 24） | 布蕾 ×3、红豆包 ×1 | REDUCE 去掉布蕾 1 |
| H10 | 只有周四开放，剩 140 g | 红豆包 ×3 | 只有 REDUCE（没有 restDate） |
| H11 | 周三、周五都开放 | 红豆包 ×3（周四剩 140 g） | restDate 周三（距离相同取较早）；周三放不下时是周五 |
| H12 | 现在 10/27 周二中午，周四布蕾已满 | 红豆包 ×1、布蕾 ×2 | REDUCE 去掉布蕾 2；SPLIT restDate 周五（周三的布蕾已截止） |
| H13 | 泡芙只能周三，看周四 | 红豆包 ×2、泡芙 ×1 | `WEEKDAY`；SPLIT WEEKDAY 周四先订红豆包 2、泡芙订周三 |
| H14 | 同上，但周三不开放 | 红豆包 ×2、泡芙 ×1 | SPLIT WEEKDAY，restDate `null` |
| H15 | 周四剩 70 g | 红豆包 ×2、泡芙 ×1 | `WEEKDAY`，没有提示（红豆包 2 个这天也放不下）；只有泡芙时也没有提示 |
| H16 | — | 空购物车 / 有暂停商品 / 超过每单上限 / 这天可选 / 配送也满了 | 没有提示 |

星期几的例子：W1 `[6, 3, 3]` 存成 `[3, 6]`，7 天全选存成 `[]`；W2 有泡芙时周四 `WEEKDAY`、周三可选；W3 周四已满又有泡芙 → `WEEKDAY`，过了截止 → `CUTOFF`；W4 空购物车不会是 `WEEKDAY`。

## 8. 店主在后台下单或改单

- 检查第 2b、5–7 条（星期几限制和名额一样：不满足时列出来，店主写原因后可以强制确认）。不满足时返回所有超限项，例如"会超过面团上限 120 g；配送已满"。
- 店主可以写一句原因后**强制确认**，原因与超限项一起写进操作日志。
- 不检查第 0、2、4 条（接单开关、截止、每单上限），也不受频率限制。
- 改单时，"已占用"不含这笔订单原来的内容（见 3.3）。

## 9. 顾客取消

```
可以取消 ⇔ 状态 ∈ {NEW, CONTACTED, CONFIRMED} 且 now < order.cutoff_at
```

取消后状态变为 `CANCELLED`，名额立即按第 3–5 节重新计算（可能不释放面团，见 3.4 的取消例子）。

## 10. 生产汇总（每天 20:05，设为第 X 天）

| 部分 | 内容 |
|---|---|
| 明天（X+1）的面包 | 每款个数；按大圆包算的商品写"做 N 个大圆包，多出 M 份"；面团合计克数 / 当天上限 |
| 今晚要做的布蕾（X+1 取货） | 杯数；⌈杯数 ÷ 一批杯数⌉ 批，多出几杯 |
| 明晚要做的布蕾（X+2 取货，刚截止） | 同上 |
| 明天的交付 | 自提 N 单、配送 N 单 |
| 还没确认的订单 | X+1、X+2 取货、状态为新订单或已联系的订单：订单号、微信号 |

X+1 不是开放日期时写"明天没有开放"。只统计占名额的订单。

例子：X+1 有红豆包 6、岩烧乳酪包 6、奶酪角 6；X+1 取货的布蕾 20 杯。

- 面包：红豆包 6、岩烧乳酪包 6、奶酪角 6（**做 2 个大圆包，多出 2 角**）；面团 420 + 420 + 680 = **1520 g / 1600 g**。
- 今晚布蕾：20 杯 → **7 批**，多出 1 杯。

## F2 — flavour limits and bundles (D180)

A flavour line uses its own unit price and nullable bundle price, and the product's
bundle size. A null flavour bundle never inherits the base product bundle. Bundles
remain separate by product + flavour. Existing order lines keep their snapshots.

Flavour capacity is an additional constraint in every product mode, in pieces:
`effective = OpenDateFlavorLimit.limit ?? ProductFlavor.dailyLimit ?? unlimited`.
After locking OpenDate, sum all occupying orders for that pickup date and flavour,
exclude the edited order, merge its replacement, then compare the entire after total.
Product overrides, product daily capacity, whole-day round rounding and delivery
checks continue to apply. Null historical flavour lines consume product capacity only.
Owner overrides require a reason and AuditLog, including status restoration.
Customer availability exposes only sold-out IDs, never limits/usage. A flavour is sold
out if adding one piece fails either its flavour limit or the product/dough limit;
cutoff, weekdays and delivery continue to have separate date states.

Every example below is tested in `tests/unit/flavorLimits.test.ts`:

| ID | Inputs | Result |
|---|---|---|
| FP1 | 5 pieces, flavour unit 450, size 4, bundle 1600 | 2050 cents |
| FP2 | Same, flavour bundle null, base product bundle 1000 | 2250 cents |
| FP3 | Flavour A ×3 + B ×1, each unit 450 / bundle 4 for 1600 | 1800 cents, no mixing |
| FC1 | Round 4 pieces / 340 g; dough limit 340; flavour A limit 3, existing A2, add A1 | allowed, flavour after 3 |
| FC2 | Same, add A2 | flavour after 4 exceeds 3 although round still fits |
| FC3 | Same, date override 0 then 4 | A1 rejected at 0; A2 allowed at 4 |
| FC4 | Same, override 9, add A3 | product round after 5 needs 680 g: rejected |
| FC5 | Replace existing A2 order with A3, flavour limit 3 | allowed, after 3 rather than 5 |
| FC6 | Existing A2 is CANCELLED or REJECTED, add A3 | allowed |
| FC7 | Independent product default 8; existing A2; B unlimited, add B3 | product date limit 5 allows; limit 4 rejects |
| FH1 | FC1 settings, cart A3 + unlimited B3 | keep A1 + B1; both flavour and shared round fit |

Real Postgres tests in `tests/db/flavors.test.ts` additionally cover the last-slot
race, owner create/edit/restoration override audits, cancellation release, per-date
set/clear and below-usage confirmation, and immutable bundle snapshots.

## 11. 拼单、口味轮换与现货（D192–D194，店主 11/08）

`NORMAL` 完全保留原单位和算法。`GROUP` 使用 `INDEPENDENT`，不占面团；
`batchYield=B` 是每只块数，`groupMin=M` 是最后一只开做门槛（店主采用 4），
`dailyLimit` 和 `OpenDateProductLimit.limit` 的单位是**所有口味合计的只数**。
口味默认/按日限额仍是**块数**。套餐仍按每条商品/口味行的 bundleSize/bundlePriceCents 定价。

池键为 `(取货日期, productId, flavorId 或 null)`。仅 §1 占额状态的**预订行**参与进度；
现货行不参与。`cakes=ceil(n/B)`，`last=n>0 ? n-(cakes-1)*B : 0`，
`spare=cakes*B-n`，`formed=n>0 && (last>=M || decision=CONFIRMED)`。
状态优先级：显式 FAILED → FAILED；显式 CONFIRMED → CONFIRMED（即使取消到 0）；
截止后且未成团 → FAILED；已成团 → FORMED；否则 OPEN。
`needMore=CONFIRMED ? 0 : max(0,M-last)`；n=7 时表示下一只还差 3 块。
时间是纯函数参数，不依赖定时任务；FAILED 不取消、不移动、不修改任何订单。

下单时合并新内容整体重算 `Σ_flavour ceil(n_f/B) <= limit`，未成团也占一只。
只有新增/改变占额内容时检查；已有超限日保留并展示。修改普通备注不追溯拒绝旧订单。
每条新 GROUP 预订行必须选择 `ifNotFormed=CONTACT|CANCEL`；这只是店主处理依据，绝不自动取消。
NORMAL 与现货行保存 null。NORMAL→GROUP 同事务对今天及未来已有有效预订的每个池设置
CONFIRMED，备注「改为拼单前已有订单」，旧行保持 null。

口味 `pickupWeekdays=[]` 继承商品允许的星期；非空必须是商品星期集合的子集（商品空则任意）。
按 Chicago 日期检查每一条口味，不按商品去重跳过后面的口味。顾客不能越过，店主须原因和日志。
现货已经制作完成，不受预订的星期轮换限制。

现货 `StockLot` 的 `sold` 是 §1 状态里引用该 lot 的件数；`left=max(0,qty-sold)`。
购买必须 `!closed && now<sellUntil`，默认当日 Chicago 12:00；整点不可买。
只限 lot 的日期；当日可买。混合预订时照常按**预订行**最大 leadDays 检查 CUTOFF。
纯现货单的取消截止存 lot 最早 sellUntil。现货不占面团、只数或口味预订限额，配送名额与每单上限仍适用。
店主也不能超卖现货；减少 lot.qty 不能低于 sold，售罄/删除操作软关闭保留历史。

余块转现货只对 FORMED/CONFIRMED 池开放，同池最多一个未关闭 lot。关闭后可再转，
数量为 `spare - 该池历史关闭 lots 的有效已售数`。已转出的余块不能再作为预订余量出售：
日期容量检查额外保留该池未关闭 lot 的 qty、已关闭 lot 的 sold，再与预订块数合并取整。
这是原批次的生产预留，不是一般现货占产能。已转 lot 不允许增量或重新开启，以免凭空增加余块。

以下例子全部在 `tests/unit/groupPool.test.ts`；数据库端在 `tests/db/groupStock.test.ts`：

| 例子 | 输入 | 结果 |
|---|---|---|
| G1 | 周五原味 3/4、周五抹茶 1/4、周六原味 2/4 | 分别还差 1、3、2，互不合并 |
| G2 | B=6 M=4，n=4 | 1 只、余 2、FORMED |
| G3 | n=6 | 1 只、余 0、FORMED |
| G4 | n=7 | 2 只、最后 1、余 5、OPEN、下一只还差 3 |
| G5 | n=10 | 2 只、余 2、FORMED |
| G6 | n=12 | 2 只、余 0、FORMED |
| G7 | 限 2 只，原味 3、抹茶 1 | 第三口味第 1 块拒绝；原味再 3/抹茶再 5 可；原味再 4 拒绝 |
| G8 | 原味已有 3，口味当日上限 4，商品当日 1 只，加 2 | 因口味 5>4 拒绝，只数未超 |
| G9 | 商品/口味预订上限都是 0，现货 100 块 | 不占面团、只数、口味预订限额（另检查 lot 库存） |
| G10 | 商品周五/六，原味周五、抹茶周六，周五各订 1 | 抹茶 WEEKDAY；抹茶现货不受此限 |
| G11 | n=3，minOverride=3 | 立即 FORMED；清除后回到商品门槛 |
| G12 | n=4 后取消 1 | OPEN、还差 1；CONFIRMED 即使取消到 0 也不倒退 |
| G13 | n=3 到截止；或 n=6 店主判定 FAILED | FAILED，原订单与选择保留 |
| G14 | lot.qty=2 sold=2；或 now=sellUntil | 可卖 0；qty=2 sold=1 且未截止可卖 1 |
