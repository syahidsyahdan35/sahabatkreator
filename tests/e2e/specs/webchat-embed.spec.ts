import { expect, test, type Page } from "@playwright/test";
import {
  createWebchatChannel,
  navTo,
  registerAndCreateWorkspace,
  runId,
  waitConversationListed,
} from "../helpers";

/**
 * Webchat TERTANAM di origin asing (hotfix 2026-11-02).
 *
 * Meniru persis cara user memakai widget: halaman HTML polos di situs
 * LAIN (di sini http://situs-tenant.test, disajikan lewat route
 * fulfillment — origin-nya sungguh berbeda dari botara.my.id) berisi
 * snippet resmi:
 *   <script src="https://botara.my.id/widget.js" data-site-key="wc_...">
 *
 * Yang dibuktikan:
 * 1. Chat dua arah bekerja dari origin asing (CORS publik webchat) dan
 *    tombol chat TIDAK bergeser posisi saat panel dibuka/ditutup
 *    (root flex rata kanan; asersi tepi kanan/bawah tombol ≤2px).
 * 2. siteKey bogus dari origin asing + halaman berbahasa Indonesia →
 *    panel menampilkan status error dwibahasa + tombol "Coba lagi",
 *    BUKAN "Menghubungkan…" abadi.
 * 3. Request sesi pertama DIBLOKIR jaringan (route abort) → widget
 *    pulih sendiri lewat retry otomatis, tanpa reload halaman.
 */

const FOREIGN_ORIGIN = "http://situs-tenant.test";

/** Sajikan halaman tenant polos berisi snippet persis seperti file user. */
async function openForeignEmbedPage(
  page: Page,
  siteKey: string,
  lang: "en" | "id" = "en",
): Promise<void> {
  await page.route(`${FOREIGN_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Situs Tenant Uji</title>
</head>
<body>
  <h1>Selamat Datang di Situs Tenant</h1>
  <p>Widget chat akan dimuat secara otomatis.</p>

<script src="https://botara.my.id/widget.js" data-site-key="${siteKey}"></script>
</body>
</html>`,
    }),
  );
  await page.goto(`${FOREIGN_ORIGIN}/`);
}

/** Buat automation keyword lewat form UI (pola spec automations). */
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

test.describe("webchat embed (origin asing)", () => {
  test("chat bekerja dari situs lain dan tombol tidak bergeser saat panel dibuka", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const rid = runId();
    const keyword = `embed${rid}`;
    const visitorText = `halo kak, info ${keyword} dong`;
    const replyText = `Balasan embed E2E ${rid} untuk {name}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "embed", rid);
    const siteKey = await createWebchatChannel(owner, `Webchat Embed ${rid}`);
    await createKeywordAutomation(owner, {
      name: `Embed E2E ${rid}`,
      keyword,
      reply: replyText,
    });

    // --- Pengunjung di situs LAIN (origin asing) ---
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openForeignEmbedPage(visitor, siteKey);

    const chatButton = visitor.getByRole("button", { name: "Chat with us" });
    await expect(chatButton).toBeVisible({ timeout: 30_000 });
    const before = await chatButton.boundingBox();
    expect(before).not.toBeNull();

    await chatButton.click();
    const input = visitor.getByPlaceholder("Type a message…");
    await expect(input).toBeVisible({ timeout: 30_000 });

    // Posisi tombol TIDAK boleh berubah saat panel membuka: tepi kanan
    // & bawah berlabuh di pojok yang sama (toleransi ≤2px).
    const afterOpen = await chatButton.boundingBox();
    expect(afterOpen).not.toBeNull();
    expect(
      Math.abs(afterOpen!.x + afterOpen!.width - (before!.x + before!.width)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        afterOpen!.y + afterOpen!.height - (before!.y + before!.height),
      ),
    ).toBeLessThanOrEqual(2);

    // Kirim pesan dari origin asing → gelembung sendiri tampil (berarti
    // sesi + POST pesan lolos CORS) dan balasan automation tiba.
    await input.fill(visitorText);
    await visitor.getByRole("button", { name: "Send", exact: true }).click();
    await expect(visitor.getByText(visitorText, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      visitor.getByText(`Balasan embed E2E ${rid}`).first(),
    ).toBeVisible({ timeout: 90_000 });

    // Tutup panel: tombol kembali ke posisi persis semula.
    await chatButton.click();
    const afterClose = await chatButton.boundingBox();
    expect(afterClose).not.toBeNull();
    expect(
      Math.abs(afterClose!.x + afterClose!.width - (before!.x + before!.width)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        afterClose!.y + afterClose!.height - (before!.y + before!.height),
      ),
    ).toBeLessThanOrEqual(2);

    await visitorContext.close();
    await ownerContext.close();
  });

  test("siteKey bogus dari origin asing: status error + tombol coba lagi (dwibahasa)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Halaman berbahasa Indonesia (seperti file chat.html user) → widget
    // ikut berbahasa Indonesia lewat deteksi <html lang>.
    await openForeignEmbedPage(page, "wc_bogus_embed_bukan_kunci_asli", "id");
    await page.getByRole("button", { name: "Chat dengan kami" }).click();
    // Dalam batas wajar panel WAJIB menunjukkan error + retry — bukan
    // "Menghubungkan…" yang tidak pernah selesai.
    await expect(page.getByText(/Tidak dapat terhubung/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Coba lagi" }),
    ).toBeVisible();
  });

  test("request sesi pertama diblokir: widget pulih sendiri tanpa reload", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const rid = runId();

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "embedretry", rid);
    const siteKey = await createWebchatChannel(
      owner,
      `Webchat EmbedRetry ${rid}`,
    );

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    // Blokir upaya sesi PERTAMA (mensimulasikan gangguan sesaat persis
    // seperti yang dialami user); upaya berikutnya dibiarkan lewat.
    let sessionAttempts = 0;
    await visitor.route("**/api/webchat/*/session", async (route) => {
      sessionAttempts += 1;
      if (sessionAttempts === 1) await route.abort();
      else await route.continue();
    });
    await openForeignEmbedPage(visitor, siteKey);

    await visitor.getByRole("button", { name: "Chat with us" }).click();
    const input = visitor.getByPlaceholder("Type a message…");
    await expect(input).toBeVisible({ timeout: 30_000 });

    // Tanpa reload: retry otomatis membuat sesi, status error hilang,
    // dan pesan benar-benar terkirim — dibuktikan dari sisi server:
    // percakapannya muncul di Inbox pemilik (gelembung lokal saja tidak
    // cukup sebagai bukti, karena ia tampil sebelum server menjawab).
    const text = `Pesan pulih sendiri E2E ${rid}`;
    await input.fill(text);
    await visitor.getByRole("button", { name: "Send", exact: true }).click();
    await expect(visitor.getByText(text, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(sessionAttempts).toBeGreaterThanOrEqual(2);
    await expect(visitor.getByText(/Couldn't connect/)).toBeHidden({
      timeout: 30_000,
    });
    await waitConversationListed(owner, text, 90_000);

    await visitorContext.close();
    await ownerContext.close();
  });
});
