// Email rendering for outbox notifications (docs/NOTIFICATIONS.md §2–§5).
// Contract between the outbox (sends) and the templates (render). The
// templates task replaces the body of renderNotification; the signature stays.
import type { DbClient } from "./db";

export interface RenderedEmail {
  subject: string;
  text: string;
}

/** The fields of a Notification row the renderer needs. */
export interface NotificationToRender {
  id: string;
  kind: "NEW_ORDER" | "CUSTOMER_CANCELLED" | "DAILY_SUMMARY" | "PASSWORD_RESET";
  dedupeKey: string;
  payload: unknown;
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
  void db;
  void now;
  throw new Error(`renderNotification not implemented for ${notification.kind}`);
}
