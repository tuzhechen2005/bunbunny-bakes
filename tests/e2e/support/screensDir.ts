import path from "node:path";

// Keep screenshot output configurable without hard-coding a local machine path.
export function screensDir(): string {
  return process.env.E2E_SCREENS_DIR ?? path.join(process.cwd(), "test-results", "screens");
}
