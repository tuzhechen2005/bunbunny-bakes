/**
 * Focus without a ring after a touch (a ring around a button the finger never targeted looks like a bug).
 * `focusVisible: false` is not supported everywhere: detected once by reading the option.
 */
let supported: boolean | null = null;

export function supportsFocusVisibleOption(): boolean {
  if (supported !== null) return supported;
  let read = false;
  try {
    document.createElement("button").focus({
      get focusVisible() {
        read = true;
        return false;
      },
    } as FocusOptions);
  } catch {
    /* no focus support at all */
  }
  supported = read;
  return supported;
}

/** Focus `el`. `ring: false` suppresses the focus-visible ring where the browser lets us; otherwise returns false and does nothing. */
export function focusQuietly(el: HTMLElement | null | undefined, ring: boolean): boolean {
  if (!el) return false;
  if (ring) {
    el.focus({ preventScroll: true });
    return true;
  }
  if (!supportsFocusVisibleOption()) return false;
  el.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  return true;
}
