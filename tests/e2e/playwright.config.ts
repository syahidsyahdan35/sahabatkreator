import { defineConfig, devices } from "@playwright/test";

/**
 * Konfigurasi Playwright E2E Sahabat Kreator (Fase QA-1).
 *
 * Target default: staging publik https://botara.my.id. Arahkan ke target
 * lain lewat env E2E_BASE_URL (mis. tunnel SSH lokal ke server staging).
 *
 * Suite berjalan SERI (workers: 1): banyak skenario real-time berbagi
 * staging yang sama (relay worker ±2 dtk, poller API ±2 dtk), dan urutan
 * yang deterministik lebih penting daripada kecepatan di sini.
 * retries: 0 — kegagalan dilaporkan apa adanya, tidak ditutup retry.
 */
const baseURL = process.env.E2E_BASE_URL ?? "https://botara.my.id";

export default defineConfig({
  testDir: "./specs",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
