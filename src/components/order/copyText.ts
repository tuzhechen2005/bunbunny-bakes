/** Fallback for WebViews without navigator.clipboard: select a temporary input and execCommand. */
function legacyCopy(text: string): boolean {
  const input = document.createElement("input");
  input.value = text;
  input.readOnly = true;
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(input);
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.blur();
    input.remove();
  }
}

/** Copies text to the clipboard; WeChat's in-app browser often lacks the async API, so fall back. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}
