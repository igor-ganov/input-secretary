import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: "http://localhost:4329" },
  webServer: {
    command: "bun run build && bun run preview",
    url: "http://localhost:4329",
    reuseExistingServer: false,
  },
});
