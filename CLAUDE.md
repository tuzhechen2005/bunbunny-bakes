# 🐰的大面包（Bunbunny Bakes）— instructions for Claude

一人面包店的在线预订网站和后台。店主本人就是用户，也和你一起开发。这是真实店铺，会收真实顾客的订单。

开始任何工作前，先读 `docs/HANDOFF.md`，再读当前任务对应的 spec。

## 文档地图

- `docs/PRD.md`：产品定义、范围、验收标准（取代旧的 V1.0–V1.2 三份 PRD）
- `docs/DECISIONS.md`：所有决策及来源。**其他文档与它冲突时以它为准**；改决策要在末尾追加一行
- `docs/CAPACITY_RULES.md`：名额、价格、截止的公式和例子。**每个例子都必须是一条测试**
- `docs/DATA_MODEL.md`：表、状态机、下单事务、数据库测试
- `docs/API_SPEC.md`、`docs/PAGES.md`、`docs/NOTIFICATIONS.md`、`docs/SECURITY.md`
- `docs/TASKS.md`：里程碑和验收标准

## 不能违反的规则

1. **不超卖。** 下单、改单、取消都在数据库事务里，先 `SELECT … FOR UPDATE` 锁住那一天的 `OpenDate` 行，再统计、再写入。并发测试必须在真实 Postgres 上跑，不能用 mock。
2. **奶酪角（以及任何"按大圆包"的商品）按当天所有占名额订单的总数向上取整。** 判断能不能放进一天，要把新内容并进去整体重算（after），不能只算新订单自己的用量。
3. **名额一律按取货日期算。** 截止 = (取货日 − 购物车里最大的 `leadDays`) 当天 20:00 America/Chicago；`now < cutoff` 才能下单。时区转换要能正确处理夏令时。
4. **价格、运费、名额全部在服务器端重新计算**，前端传来的金额一律忽略。金额用美分整数。
5. **订单不会悄悄变化**：不自动失效、不自动改日期、不自动拆单。
6. **顾客永远不能超限；店主可以超限，但必须写原因并记日志。** 所有后台修改都写 AuditLog。
7. **邮件发送失败不能让下单失败。** 通知走 outbox，入队和业务写入在同一个事务里，发送在事务之后。
8. **隐私**：只存微信号；IP 只存哈希；订单只能通过随机 `viewToken` 查看；顾客永远看不到内部数据（克数、上限、已用量、付款状态）。
9. `src/domain/` 是纯函数：不 import Prisma，不读 `Date.now()`，时间作为参数传入。
10. 不加用不上的东西：没有在线支付、没有顾客账号、没有统计脚本。

## 结构

```
src/domain/      纯函数：pricing、capacity、cutoff、availability、status、summary
src/server/      数据库事务、邮件、认证
src/app/         页面和 app/api/** route handlers（薄的一层）
src/copy.ts      所有中文文案
prisma/          schema、迁移、种子
tests/           unit/、db/（需要 Postgres）、e2e/（Playwright）
```

## 前端约定（改版，见 `docs/FRONTEND.md`）

- 物理和手势在 `src/lib/motion/`（纯 TS + 单元测试，用法见该目录 README）；React Bits 只用 BlurText / CountUp / ShinyText，放 `src/components/reactbits/`（保留署名和许可证）；品牌组件（BunnyMark）放 `src/components/brand/`；飞进纸袋的接口在 `src/lib/flyToBag.ts`。
- 颜色只用 `globals.css` 里的 token（`bg-background`、`text-accent`、`border-line` 等），组件里不写十六进制颜色。顾客端固定浅色；后台在根节点加 `theme-admin` 才有深色。
- 标题字体用 `font-serif`（子集化的思源宋体 600，`npm run fonts` 重新生成；新增文案后要重跑）。
- 所有可见文字只写在 `src/copy.ts`（品牌文案在 `copy.customer.brand`）。
- 动效必须尊重 `prefers-reduced-motion`（用 `useMotionPrefs().reduced`，只淡入淡出、不晃不飞不旋转）和自动降级（`degraded`：关闭钟摆和侧转）。动效永远不能挡住或延迟下单；全部静止后停止 rAF。
- 性能预算（D73）：首页首屏改版新增的 JS + CSS 压缩后 ≤ 60 KB（对比 main，框架本身约 203 KB 不计），标题字体子集 ≤ 125 KB；`motion` 只用 `m.*`，外面包 `MotionProvider`（LazyMotion，特性按需加载，不放在根 layout）。
- 不用 GSAP、WebGL、持续运行的 Canvas；纸张颗粒是静态 SVG 背景。

## 工作方式

- 先写测试再写实现；每完成 `docs/TASKS.md` 的一项就跑全部测试、提交、打勾。
- 改变了任何决策 → 写进 `docs/DECISIONS.md`。遇到文档没写清楚的地方，停下来问店主，给出推荐和理由，一次只问一个问题。
- 店主用中文交流；代码、注释、提交信息用英文；网站界面全中文，文案只写在 `src/copy.ts`。
- 手机优先：顾客基本在微信内置浏览器里打开，店主主要在手机上用后台。
- 密钥只放在环境变量里，`.env` 不进仓库。
