import { OCCUPYING_STATUSES, type DayOrder } from './types';

export type PoolDecision = 'OPEN' | 'CONFIRMED' | 'FAILED';
export interface PoolProgress {
  pieces: number; min: number; cakes: number; last: number; spare: number;
  formed: boolean; status: PoolDecision | 'FORMED'; needMore: number;
}

/** Last cake determines formation; confirmation persists even after cancellation. */
export function groupPool(input: { pieces: number; batchYield: number; min: number; decision?: PoolDecision; cutoffAt: Date; now: Date }): PoolProgress {
  const { pieces, batchYield, min, decision = 'OPEN', cutoffAt, now } = input;
  if (!Number.isInteger(pieces) || pieces < 0 || !Number.isInteger(batchYield) || batchYield < 1 || !Number.isInteger(min) || min < 1 || min > batchYield) throw new Error('Invalid pool configuration');
  const cakes = Math.ceil(pieces / batchYield);
  const last = pieces ? pieces - (cakes - 1) * batchYield : 0;
  const formed = pieces > 0 && (last >= min || decision === 'CONFIRMED');
  const status = decision === 'FAILED' ? 'FAILED' : decision === 'CONFIRMED' ? 'CONFIRMED' : now >= cutoffAt && !formed ? 'FAILED' : formed ? 'FORMED' : 'OPEN';
  return { pieces, min, cakes, last, spare: cakes * batchYield - pieces, formed, status, needMore: decision === 'CONFIRMED' ? 0 : Math.max(0, min - last) };
}

export function poolPieces(orders: DayOrder[], productId: string, flavorId: string | null): number {
  return orders.filter(o => OCCUPYING_STATUSES.includes(o.status)).flatMap(o => o.items)
    .filter(i => !i.stockLotId && i.productId === productId && (i.flavorId ?? null) === flavorId).reduce((n, i) => n + i.qty, 0);
}

export function stockLeft(qty: number, sold: number, closed: boolean, sellUntil: Date, now: Date): number {
  return closed || now >= sellUntil ? 0 : Math.max(0, qty - sold);
}
