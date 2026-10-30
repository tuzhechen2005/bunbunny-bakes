// Email rendering for outbox notifications (docs/NOTIFICATIONS.md §2–§5).
// Contract between the outbox (sends) and the templates (render).
import { copy } from "@/copy";
import { dayLabel, monthDay } from "@/domain/dates";
import { formatCents } from "@/domain/pricing";
import type { DailySummary } from "@/domain/summary";
import type { DbClient } from "./db";
import { fromDbDate } from "./dbDates";
import type { GameWinnerPayload, WinnerLine } from "./gameWinner";

export interface RenderedEmail {
  subject: string;
  text: string;
}

/** The fields of a Notification row the renderer needs. */
export interface NotificationToRender {
  id: string;
  kind: "NEW_ORDER" | "CUSTOMER_CANCELLED" | "DAILY_SUMMARY" | "PASSWORD_RESET" | "GAME_WINNER";
  dedupeKey: string;
  payload: unknown;
}

const t = copy.admin.emails;

/** Fills {placeholders}. A function replacer, so `$` in values is never special. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

function siteUrl(fallback?: unknown): string {
  const raw = process.env.SITE_URL || (typeof fallback === "string" ? fallback : "");
  if (!raw) throw new Error("SITE_URL is not set");
  return raw.replace(/\/+$/, "");
}

function payloadObject(notification: NotificationToRender): Record<string, unknown> {
  const p = notification.payload;
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    throw new Error(`${notification.kind} notification ${notification.id}: payload is not an object`);
  }
  return p as Record<string, unknown>;
}

async function loadOrder(db: DbClient, notification: NotificationToRender) {
  const orderId = payloadObject(notification).orderId;
  if (typeof orderId !== "string") {
    throw new Error(`${notification.kind} notification ${notification.id}: payload has no orderId`);
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    // OrderItem has no position column: follow the menu order (product sortOrder), id as tiebreak.
    include: {
      items: { orderBy: [{ product: { sortOrder: "asc" } }, { nameSnapshot: "asc" }, { id: "asc" }] },
    },
  });
  if (!order) throw new Error(`${notification.kind} notification ${notification.id}: order ${orderId} not found`);
  return order;
}

function itemLines(items: { nameSnapshot: string; qty: number }[]): string[] {
  return items.map((i) => fill(t.newOrder.itemLine, { name: i.nameSnapshot, qty: i.qty }));
}

async function renderNewOrder(db: DbClient, n: NotificationToRender): Promise<RenderedEmail> {
  const order = await loadOrder(db, n);
  const pickupLabel = dayLabel(fromDbDate(order.pickupDate));
  const fulfillment =
    order.fulfillment === "DELIVERY" ? copy.customer.order.delivery : copy.customer.order.pickup;
  const total = formatCents(order.totalCents);
  const note = order.note && order.note.trim() !== "" ? order.note : t.newOrder.noteNone;
  const text = [
    fill(t.newOrder.wechatLine, { wechatId: order.wechatId }),
    "",
    ...itemLines(order.items),
    "",
    fill(t.newOrder.totalsLine, {
      subtotal: formatCents(order.subtotalCents),
      fee: formatCents(order.deliveryFeeCents),
      total,
    }),
    fill(t.newOrder.pickupLine, { pickupLabel, fulfillment }),
    fill(t.newOrder.noteLine, { note }),
    "",
    fill(t.newOrder.openOrder, { url: `${siteUrl()}/admin/orders/${order.id}` }),
  ].join("\n");
  return {
    subject: fill(t.newOrder.subject, { orderNo: order.orderNo, pickupLabel, fulfillment, total }),
    text,
  };
}

async function renderCancelled(db: DbClient, n: NotificationToRender): Promise<RenderedEmail> {
  const order = await loadOrder(db, n);
  const pickupLabel = dayLabel(fromDbDate(order.pickupDate));
  const text = [...itemLines(order.items), "", t.cancelled.released].join("\n");
  return {
    subject: fill(t.cancelled.subject, {
      orderNo: order.orderNo,
      pickupLabel,
      wechatId: order.wechatId,
    }),
    text,
  };
}

function renderPasswordReset(n: NotificationToRender): RenderedEmail {
  const url = payloadObject(n).url;
  // A sent reset row has its url scrubbed (SECURITY.md); it must never be re-sent.
  if (typeof url !== "string" || url === "") {
    throw new Error(`PASSWORD_RESET notification ${n.id}: payload has no url (already scrubbed)`);
  }
  return {
    subject: t.passwordReset.subject,
    text: [t.passwordReset.intro, url, "", t.passwordReset.validity, t.passwordReset.ignore].join("\n"),
  };
}

type DailySummaryPayload = DailySummary & { siteUrl?: string };

function batchSection(
  header: string,
  lines: DailySummary["tonight"]["lines"],
): string[] {
  const body = lines.map((l) => {
    let core: string;
    if (l.batches === null || l.leftover === null) {
      core = fill(t.summary.batchLineNoYield, { qty: l.qty });
    } else if (l.leftover === 0) {
      core = fill(t.summary.batchLineExact, { qty: l.qty, batches: l.batches });
    } else {
      core = fill(t.summary.batchLine, { qty: l.qty, batches: l.batches, leftover: l.leftover });
    }
    return lines.length > 1 ? fill(t.summary.batchNamePrefix, { name: l.name }) + core : core;
  });
  return [header, ...body];
}

function renderDailySummary(n: NotificationToRender): RenderedEmail {
  const s = payloadObject(n) as unknown as DailySummaryPayload;
  const tomorrowLabel = dayLabel(s.tomorrow);
  const breadLines = s.bread?.lines ?? [];

  // Subject
  const breadQty = breadLines.reduce((sum, l) => sum + l.qty, 0);
  const tonightCups = s.tonight.lines.reduce((sum, l) => sum + l.qty, 0);
  let subject: string;
  if (s.bread === null) {
    subject = fill(t.summary.subjectClosed, { tomorrowLabel });
  } else {
    subject = fill(t.summary.subjectOpen, { tomorrowLabel });
    if (breadLines.length > 0) {
      subject += fill(t.summary.subjectBread, { count: breadQty, doughG: s.bread.doughG });
    }
  }
  if (tonightCups > 0) {
    subject += t.summary.subjectSeparator + fill(t.summary.subjectTonight, { cups: tonightCups });
  }

  // Body: sections joined by a blank line; empty sections omitted.
  const sections: string[][] = [];
  const breadHeader = fill(t.summary.breadHeader, { tomorrowLabel });
  if (s.bread === null) {
    sections.push([breadHeader, t.summary.closed]);
  } else if (breadLines.length > 0) {
    sections.push([
      breadHeader,
      ...breadLines.map((l) =>
        l.rounds
          ? fill(t.summary.breadLineRounds, {
              name: l.name,
              qty: l.qty,
              rounds: l.rounds.rounds,
              leftover: l.rounds.leftover,
            })
          : fill(t.summary.breadLine, { name: l.name, qty: l.qty }),
      ),
      fill(t.summary.dough, { used: s.bread.doughG, limit: s.bread.doughLimitG }),
    ]);
  }
  if (s.tonight.lines.length > 0) {
    sections.push(
      batchSection(fill(t.summary.tonightHeader, { md: monthDay(s.tonight.date) }), s.tonight.lines),
    );
  }
  if (s.tomorrowNight.lines.length > 0) {
    sections.push(
      batchSection(
        fill(t.summary.tomorrowNightHeader, { md: monthDay(s.tomorrowNight.date) }),
        s.tomorrowNight.lines,
      ),
    );
  }
  if (s.deliveries.pickup + s.deliveries.delivery > 0) {
    sections.push([
      t.summary.deliveryHeader,
      fill(t.summary.deliveryLine, { pickup: s.deliveries.pickup, delivery: s.deliveries.delivery }),
    ]);
  }
  if (s.unconfirmed.length > 0) {
    sections.push([
      t.summary.unconfirmedHeader,
      ...s.unconfirmed.map((u) =>
        fill(t.summary.unconfirmedLine, {
          orderNo: u.orderNo,
          wechatId: u.wechatId,
          status: t.summary.unconfirmedStatus[u.status],
        }),
      ),
    ]);
  }
  sections.push([fill(t.summary.openAdmin, { url: `${siteUrl(s.siteUrl)}/admin` })]);

  return { subject, text: sections.map((sec) => sec.join("\n")).join("\n\n") };
}

function winnerLines(l: WinnerLine): string[] {
  const g = t.gameWinner;
  return [
    fill(g.nicknameLine, { nickname: l.nickname }),
    fill(g.wechatLine, { wechatId: l.wechatId }),
    fill(g.scoreLine, { score: l.score }),
    fill(g.orderedLine, { ordered: l.ordered ? g.yes : g.no }),
  ];
}

/** One game's content in the winner email: #1 and the ⚠️ path. */
function winnerSections(w: WinnerLine, runnerUp: WinnerLine | null): string[][] {
  const g = t.gameWinner;
  const sections: string[][] = [winnerLines(w)];
  if (!w.ordered) {
    sections.push([g.warn]);
    sections.push(runnerUp ? [fill(g.runnerUpHeader, { rank: runnerUp.rank }), ...winnerLines(runnerUp)] : [g.noRunnerUp]);
  }
  return sections;
}

/** D133: keep the winner section format, but render only the selected prize game. */
function renderGameWinner(n: NotificationToRender): RenderedEmail {
  const g = t.gameWinner;
  const p = payloadObject(n) as unknown as GameWinnerPayload;
  if (!p.week || !p.winner) throw new Error(`GAME_WINNER notification ${n.id}: payload has no winner`);
  const names: Record<GameWinnerPayload["game"], string> = { BIG: g.gameBig, TU: g.gameTu, M3: g.gameM3 };
  const name = names[p.game];
  if (!name) throw new Error(`GAME_WINNER notification ${n.id}: unknown game`);
  const weekHeader = fill(g.weekHeader, { start: dayLabel(p.week.start), end: dayLabel(p.week.end) });
  const [first, ...rest] = winnerSections(p.winner, p.runnerUp);
  const part = fill(g.subjectPart, { game: name, nickname: p.winner.nickname, score: p.winner.score });
  return {
    subject: fill(p.winner.ordered ? g.twoSubject : g.twoSubjectWarn, { games: part }),
    text: [[weekHeader], [fill(g.sectionTitle, { game: name }), ...first], ...rest,
      [fill(g.openAdmin, { url: `${siteUrl(p.siteUrl)}/admin/game` })]]
      .map((section) => section.join("\n")).join("\n\n"),
  };
}

/**
 * Render one notification to the owner's email. Reads whatever it needs
 * (order, settings) from the database at send time. Must not have side effects.
 */
export async function renderNotification(
  db: DbClient,
  notification: NotificationToRender,
  now: Date,
): Promise<RenderedEmail> {
  void now;
  switch (notification.kind) {
    case "NEW_ORDER":
      return renderNewOrder(db, notification);
    case "CUSTOMER_CANCELLED":
      return renderCancelled(db, notification);
    case "PASSWORD_RESET":
      return renderPasswordReset(notification);
    case "DAILY_SUMMARY":
      return renderDailySummary(notification);
    case "GAME_WINNER":
      return renderGameWinner(notification);
    default:
      throw new Error(`renderNotification: unknown kind ${String(notification.kind)}`);
  }
}
