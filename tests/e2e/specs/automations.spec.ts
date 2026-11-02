import { expect, test, type Page } from "@playwright/test";
import {
  createWebchatChannel,
  expectWidgetText,
  navTo,
  openWidget,
  registerAndCreateWorkspace,
  runId,
  widgetSend,
} from "../helpers";

/**
 * Automation (Fase 2A/2B keyword + 2C sequence):
 * - Keyword: dibuat lewat form UI → dipicu pengunjung lewat widget →
 *   balasan otomatis tiba; runCount naik & riwayat berisi eksekusi;
 *   sakelar dimatikan → pemicu berikutnya tidak dibalas.
 * - Sequence: dibuat lewat editor langkah UI → pengunjung terdaftar
 *   (enrollment terlihat di modal) dan langkah pertama (jeda 0) tiba.
 */

async function createKeywordAutomation(
  page: Page,
  input: { name: string; keyword: string; reply: string },
): Promise<void> {
  await navTo(page, "Automations");
  await page.getByRole("button", { name: "New automation" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "New automation" }),
  ).toBeVisible();
  await dialog.getByPlaceholder("e.g. Price auto-reply").fill(input.name);
  await dialog
    .getByPlaceholder("e.g. price, pricing, cost")
    .fill(input.keyword);
  await dialog.getByLabel(/Message contains the keyword/).click();
  await dialog
    .getByPlaceholder("e.g. Hi {name}, here is our price list…")
    .fill(input.reply);
  await dialog.getByRole("button", { name: "Create automation" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(input.name)).toBeVisible({ timeout: 30_000 });
}

test.describe("automations", () => {
  test("keyword automation membalas pengunjung, tercatat, dan berhenti saat dimatikan", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const rid = runId();
    const keyword = `promo${rid}`;
    const name = `Promo E2E ${rid}`;
    const reply = `Balasan otomatis E2E ${rid} untuk {name}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "auto", rid);
    const siteKey = await createWebchatChannel(owner, `Webchat Auto ${rid}`);
    await createKeywordAutomation(owner, { name, keyword, reply });

    // Kartu automation tampil aktif dengan 0 runs.
    const card = owner.locator("li", { hasText: name });
    await expect(card.getByText("Active", { exact: true })).toBeVisible();
    await expect(card.getByText("0 runs")).toBeVisible();

    // --- Pengunjung memicu keyword ---
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor, siteKey);
    await widgetSend(visitor, `halo kak, ada ${keyword} hari ini?`);
    await expectWidgetText(visitor, `Balasan otomatis E2E ${rid}`, 90_000);

    // --- runCount naik & riwayat berisi eksekusi Completed ---
    await navTo(owner, "Dashboard");
    await navTo(owner, "Automations");
    const cardAfter = owner.locator("li", { hasText: name });
    await expect(cardAfter.getByText("1 runs")).toBeVisible({
      timeout: 30_000,
    });
    await cardAfter.getByRole("button", { name: "History" }).click();
    const history = owner.getByRole("dialog");
    await expect(
      history.getByRole("heading", { name: "Run history" }),
    ).toBeVisible();
    await expect(history.getByText("Completed").first()).toBeVisible({
      timeout: 30_000,
    });
    await history.getByRole("button", { name: "Close" }).click();
    await expect(history).toHaveCount(0);

    // --- Matikan automation → pemicu berikutnya TIDAK dibalas ---
    const toggle = owner.getByRole("switch", { name });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", {
      timeout: 30_000,
    });
    await expect(cardAfter.getByText("Inactive", { exact: true })).toBeVisible();

    const replyBubbles = visitor.getByText(`Balasan otomatis E2E ${rid}`);
    const before = await replyBubbles.count();
    expect(before).toBeGreaterThanOrEqual(1);
    await widgetSend(visitor, `${keyword} lagi dong kak`);
    // Beri waktu lebih dari cukup untuk relay+evaluasi (biasanya <10 dtk);
    // tidak boleh ada balasan otomatis baru.
    await visitor.waitForTimeout(20_000);
    expect(await replyBubbles.count()).toBe(before);

    await visitorContext.close();
    await ownerContext.close();
  });

  test("sequence dibuat lewat editor langkah dan mendaftarkan pengunjung", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const rid = runId();
    const keyword = `seq${rid}`;
    const name = `Sequence E2E ${rid}`;
    const stepOne = `Langkah satu E2E ${rid}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "seq", rid);
    const siteKey = await createWebchatChannel(owner, `Webchat Seq ${rid}`);

    // --- Buat sequence 2 langkah lewat editor UI ---
    await navTo(owner, "Automations");
    await owner.getByRole("button", { name: "New automation" }).first().click();
    const dialog = owner.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Price auto-reply").fill(name);
    await dialog.getByLabel(/Message sequence/).click();
    await dialog
      .getByPlaceholder("e.g. price, pricing, cost")
      .fill(keyword);
    await dialog.getByLabel(/Message contains the keyword/).click();
    // Langkah 1: jeda 0 (default) + teks.
    await dialog
      .getByPlaceholder("e.g. Hi {name}, just a reminder about…")
      .first()
      .fill(stepOne);
    // Langkah 2: jeda 1 menit (tidak wajib ditunggu sampai terkirim).
    await dialog.getByRole("button", { name: "Add message" }).click();
    const stepRows = dialog.locator('input[type="number"]');
    await expect(stepRows).toHaveCount(2);
    await stepRows.nth(1).fill("1");
    await dialog
      .getByPlaceholder("e.g. Hi {name}, just a reminder about…")
      .nth(1)
      .fill(`Langkah dua E2E ${rid}`);
    await dialog.getByRole("button", { name: "Create automation" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    const card = owner.locator("li", { hasText: name });
    await expect(card.getByText("Sequence", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText("2 messages")).toBeVisible();

    // --- Pengunjung memicu → langkah pertama (jeda 0) tiba ---
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor, siteKey);
    await widgetSend(visitor, `ikut ${keyword} ya kak`);
    await expectWidgetText(visitor, stepOne, 90_000);

    // --- Enrollment terlihat di modal enrollments ---
    await card.getByRole("button", { name: "Enrollments" }).click();
    const enrollments = owner.getByRole("dialog");
    await expect(
      enrollments.getByRole("heading", { name: "Sequence enrollments" }),
    ).toBeVisible();
    await expect(enrollments.getByText("Active").first()).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await ownerContext.close();
  });
});
