/**
 * Browser Back closes an open overlay first (D90): the product detail, the bag sheet.
 *
 * `pushOverlay(onPop)` adds a history entry. When the user goes back (phone back key, swipe),
 * `onPop` runs and plays its normal closing animation; the page itself stays where it is.
 * The returned `close()` is for every other way of closing (button, pull, Esc, backdrop): it
 * steps back in history so the entry does not pile up. Both paths can race harmlessly:
 * whichever comes second finds the entry already gone.
 *
 * Entries are numbered and the number is stored in `history.state`, so a `popstate` is read
 * from the state it lands on (no counters to keep in sync). The existing state is spread, to
 * keep what the Next.js router keeps there.
 */
interface Entry {
  id: number;
  onPop: () => void;
}

const stack: Entry[] = [];
let seq = 0;
let listening = false;

function currentId(): number {
  const s = window.history.state as { bbOverlay?: unknown } | null;
  return typeof s?.bbOverlay === "number" ? s.bbOverlay : 0;
}

function onPopState() {
  const cur = currentId();
  // Everything above the entry we landed on has been left.
  while (stack.length > 0 && stack[stack.length - 1].id > cur) {
    stack.pop()!.onPop();
  }
}

export function pushOverlay(onPop: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  // The id lives in history.state, which survives a reload or a restored tab while `seq` restarts:
  // never reuse a number that an older entry of this session already carries.
  seq = Math.max(seq, currentId());
  const entry: Entry = { id: ++seq, onPop };
  const prev = (window.history.state ?? {}) as Record<string, unknown>;
  try {
    window.history.pushState({ ...prev, bbOverlay: entry.id }, "");
  } catch {
    // Safari throws a SecurityError when pushState is called too often: no entry, Back just leaves the page.
    return () => {};
  }
  stack.push(entry);
  return function close() {
    const at = stack.indexOf(entry);
    if (at === -1) return; // the browser already popped it
    stack.splice(at, 1);
    // Only step back when our entry is still the page the user is on.
    if (currentId() === entry.id) {
      try {
        window.history.back();
      } catch {
        /* nothing to undo */
      }
    }
  };
}
