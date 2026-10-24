import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // The home page is also rendered with the menu on the server (D91). Most e2e specs drive the menu
    // through mocked /api/menu answers, so they run without that copy; E2E_SERVER_MENU=1 starts the
    // server the way production runs it, for tests/e2e/server-menu.spec.ts (run that file alone).
    env: process.env.E2E_SERVER_MENU ? {} : { HOME_INITIAL_MENU: "off" },
  },
});
