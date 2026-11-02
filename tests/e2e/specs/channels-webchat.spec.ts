import { expect, test } from "@playwright/test";
import {
  createWebchatChannel,
  expectWidgetText,
  inboxNavButton,
  navBadge,
  navTo,
  openWidget,
  waitConversationListed,
  registerAndCreateWorkspace,
  runId,
  widgetSend,
} from "../helpers";

/**
 * Webchat dua arah (Fase 1F + Inbox 1E): pemilik membuat channel dari UI,
 * pengunjung (konteks browser kedua) mengirim pesan lewat widget, pemilik
 * melihatnya di Inbox dan membalas dari UI — balasan sampai ke widget.
 * Badge unread: muncul saat pesan masuk, dan HARUS hilang setelah
 * percakapan dibuka (perilaku standar inbox: membuka = menandai terbaca).
 */
test.describe("channels & webchat", () => {
  test("pengunjung mengirim pesan, pemilik membalas dari Inbox", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const rid = runId();
    const visitorText = `Halo E2E ${rid} dari pengunjung`;
    const replyText = `Balasan pemilik E2E ${rid}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "webchat", rid);
    const siteKey = await createWebchatChannel(owner, `Webchat E2E ${rid}`);

    // Belum ada pesan: badge Inbox tidak tampil.
    await expect(navBadge(inboxNavButton(owner))).toHaveCount(0);

    // --- Konteks pengunjung: kirim pesan lewat widget ---
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor, siteKey);
    await widgetSend(visitor, visitorText);

    // --- Pemilik: percakapan muncul di Inbox, badge unread = 1 ---
    const item = await waitConversationListed(owner, visitorText);
    await expect(navBadge(inboxNavButton(owner))).toHaveText("1", {
      timeout: 30_000,
    });

    // Buka utasnya: pesan pengunjung tampil sebagai gelembung utas
    // (elemen <p> gelembung — cuplikan daftar adalah <span>, jadi locator
    // ini tidak ambigu walau teksnya sama).
    await item.click();
    await expect(
      owner.getByPlaceholder("Write a reply…"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      owner.locator("p", { hasText: visitorText }),
    ).toBeVisible();

    // Membuka percakapan menandai terbaca: setelah daftar dimuat segar,
    // chip unread di baris dan badge navigasi harus bersih.
    await owner.getByRole("button", { name: "Reload" }).click();
    const rowItem = owner.locator("li", { hasText: visitorText }).first();
    await expect(rowItem.getByText("1", { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(navBadge(inboxNavButton(owner))).toHaveCount(0, {
      timeout: 30_000,
    });

    // --- Pemilik membalas dari UI → pengunjung menerima di widget ---
    await owner.getByPlaceholder("Write a reply…").fill(replyText);
    await owner.getByRole("button", { name: "Send", exact: true }).click();
    await expect(owner.locator("p", { hasText: replyText })).toBeVisible({
      timeout: 30_000,
    });
    await expectWidgetText(visitor, replyText, 60_000);

    await visitorContext.close();
    await ownerContext.close();
  });
});
