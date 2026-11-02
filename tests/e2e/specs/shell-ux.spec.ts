import { expect, test } from "@playwright/test";
import {
  createWebchatChannel,
  expectNoHorizontalOverflow,
  loginViaUi,
  navTo,
  openWidget,
  registerAndCreateWorkspace,
  runId,
  widgetSend,
  emailFor,
  registerViaUi,
  createWorkspaceFromEmptyState,
} from "../helpers";

/**
 * Shell & UX (RANCANGAN §10–§11): bahasa EN↔ID mengubah label menu,
 * tema dark persisten setelah reload, dan tata letak mobile
 * (bottom bar 4 tab + More, sheet More, Inbox daftar↔utas) tanpa
 * elemen yang meluber horizontal.
 */
test.describe("shell & ux", () => {
  test("tema dark persisten dan ganti bahasa mengubah label menu", async ({
    page,
  }) => {
    const rid = runId();
    await registerAndCreateWorkspace(page, "shell", rid);
    const aside = page.locator("aside");

    // --- Tema: Dark → <html> ber-class dark + persisten setelah reload ---
    await aside.getByRole("button", { name: "Dark", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark")),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => localStorage.getItem("sk-theme")),
    ).toBe("dark");
    await page.reload();
    await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark")),
      )
      .toBe(true);
    // Kembali ke Light → class dark hilang.
    await aside.getByRole("button", { name: "Light", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark")),
      )
      .toBe(false);

    // --- Bahasa: EN → ID mengubah label navigasi sidebar ---
    await aside.getByRole("button", { name: "ID", exact: true }).click();
    await expect(
      aside.getByRole("button", { name: /^Kontak(\s|$)/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      aside.getByRole("button", { name: /^Produk(\s|$)/ }),
    ).toBeVisible();
    await expect(
      page.evaluate(() => document.documentElement.lang),
    ).resolves.toBe("id");
    // Kembali ke EN.
    await aside.getByRole("button", { name: "EN", exact: true }).click();
    await expect(
      aside.getByRole("button", { name: /^Contacts(\s|$)/ }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("tidak ada overflow horizontal di halaman utama desktop", async ({
    page,
  }) => {
    const rid = runId();
    await registerAndCreateWorkspace(page, "wide", rid);
    for (const label of [
      "Dashboard",
      "Contacts",
      "Inbox",
      "Channels",
      "Automations",
      "AI Agents",
      "Knowledge Base",
      "Products",
    ]) {
      await navTo(page, label);
      await page.waitForTimeout(400);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("mobile: bottom bar + More sheet + Inbox daftar ke utas dan kembali", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const rid = runId();
    const visitorText = `Pesan mobile E2E ${rid}`;

    // Persiapan data lewat konteks desktop (akun + workspace + channel).
    const setupContext = await browser.newContext();
    const setup = await setupContext.newPage();
    const email = emailFor(rid, "mobile");
    await registerViaUi(setup, { name: `E2E Mobile ${rid}`, email });
    await createWorkspaceFromEmptyState(setup, `Studio Mobile ${rid}`);
    const siteKey = await createWebchatChannel(setup, `Webchat Mobile ${rid}`);
    await setupContext.close();

    // Pengunjung mengirim pesan.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor, siteKey);
    await widgetSend(visitor, visitorText);
    await visitorContext.close();

    // Pemilik membuka aplikasi dari viewport mobile.
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    await loginViaUi(mobile, email);

    // Bottom bar: 4 tab + More terlihat.
    const bottomBar = mobile.locator("nav.fixed");
    await expect(bottomBar).toBeVisible();
    for (const label of ["Dashboard", "Inbox", "AI Agents", "Broadcasts", "More"]) {
      await expect(
        bottomBar.getByRole("button", { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }
    await expectNoHorizontalOverflow(mobile);

    // More membuka sheet berisi menu lain; pilih Contacts dari sheet.
    await bottomBar.getByRole("button", { name: /^More/ }).click();
    const sheet = mobile.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^Contacts/ }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^Products/ }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: /^Contacts/ }).click();
    await expect(
      mobile.getByRole("heading", { name: "Contacts", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(mobile);

    // Inbox mobile: daftar → ketuk percakapan → utas + tombol kembali → daftar.
    await bottomBar.getByRole("button", { name: /^Inbox/ }).click();
    const item = mobile.locator("li button", { hasText: visitorText }).first();
    await expect(async () => {
      await mobile.getByRole("button", { name: "Reload" }).click();
      await expect(item).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000] });
    await expectNoHorizontalOverflow(mobile);
    await item.click();
    // Gelembung utas adalah elemen <p>; cuplikan daftar adalah <span>
    // (teks sama → getByText polos akan ambigu/strict-mode violation).
    await expect(mobile.locator("p", { hasText: visitorText })).toBeVisible({
      timeout: 30_000,
    });
    const backButton = mobile.getByRole("button", { name: /Back/ });
    await expect(backButton).toBeVisible();
    await backButton.click();
    await expect(item).toBeVisible({ timeout: 30_000 });

    await mobileContext.close();
  });
});
