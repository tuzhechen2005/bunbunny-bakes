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
    // The home page is also rendered with the menu on the server (D91). The e2e tests drive the
    // menu through mocked /api/menu answers, so they run without that copy.
    env: { HOME_INITIAL_MENU: "off" },
  },
});
