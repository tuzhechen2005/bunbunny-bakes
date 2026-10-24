// Browser Back closes an open overlay (the product detail, the bag sheet) before it leaves the
// page (D90). Opening an overlay pushes one history entry with the same URL; Back pops it and
// calls `onPop` (the overlay then plays its closing animation); closing the overlay any other way
// (button, drag, Esc) calls the returned `close()`, which removes the entry again with
// `history.back()` so the page is never left with a spare entry behind it.
//
//   const close = pushOverlay(() => startClosing());   // on open
//   close();                                           // when it was closed by something else
//
// Safe to call from effects: `close()` is idempotent, does nothing after a Back already popped the
// entry, and does not touch the history when the entry is no longer the current one (for example
// the page navigated on to /checkout while the overlay was still open).

interface Entry {
  id: number;
  onPop: () => void;
}

const MARK = "bbOverlay";
let nextId = 1;
const stack: Entry[] = [];
let listening = false;

function stateId(state: unknown): number {
  const id = state && typeof state === "object" ? (state as Record<string, unknown>)[MARK] : 0;
  return typeof id === "number" ? id : 0;
}

function onPopState(e: PopStateEvent): void {
  // The entry we landed on tells how deep the history now is: every overlay above it is gone.
  const current = stateId(e.state);
  while (stack.length > 0 && stack[stack.length - 1].id > current) {
    stack.pop()!.onPop();
  }
}

export function pushOverlay(onPop: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const entry: Entry = { id: nextId++, onPop };
  if (!listening) {
    listening = true;
    window.addEventListener("popstate", onPopState);
  }
  try {
    // Keep whatever state the router put there (Next.js adds its own markers on top).
    const base = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.pushState({ ...base, [MARK]: entry.id }, "");
  } catch {
    return () => undefined; // history unavailable: the overlay just has no Back support
  }
  stack.push(entry);

  return function close() {
    const at = stack.indexOf(entry);
    if (at < 0) return; // popped by Back, or already closed
    stack.splice(at, 1);
    if (stateId(window.history.state) === entry.id) {
      try {
        window.history.back();
      } catch {
        /* nothing to undo */
      }
    }
  };
}
