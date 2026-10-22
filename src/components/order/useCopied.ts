import { useEffect, useState } from "react";

/** "Copied" flag that resets itself after 2 seconds. */
export function useCopied() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return [copied, setCopied] as const;
}
