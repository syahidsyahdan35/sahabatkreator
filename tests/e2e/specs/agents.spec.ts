import { expect, test, type Page } from "@playwright/test";
import {
  agentsNavButton,
  createWebchatChannel,
  expectWidgetText,
  navBadge,
  navTo,
  openWidget,
  registerAndCreateWorkspace,
  runId,
  widgetSend,
} from "../helpers";

/**
 * AI Agent mode suggest (Fase 3A/3B): agent + dokumen Knowledge dibuat
 * lewat UI; pertanyaan pengunjung menjadi draf di antrean persetujuan
 * (badge nav bertambah); Setujui → teks terkirim ke pengunjung;
 * draf kedua → Tolak → hilang dari antrean.
 * Provider staging adalah mock yang mengutip chunk KB teratas — fakta
 * unik per run di kalimat pertama dokumen membuktikan retrieval bekerja.
 */

/** Navigasi pergi-pulang agar halaman Agents memuat ulang data dari API. */
async function refreshAgentsPage(page: Page): Promise<void> {
  await navTo(page, "Dashboard");
  await navTo(page, "AI Agents");
}

test.describe("agents", () => {
  test("draf saran agent disetujui terkirim, draf berikutnya ditolak hilang", async ({
    browser,
  }) => {
    test.setTimeout(480_000);
    const rid = runId();
    const fact = `Rp3${rid.slice(-4)} ribu`;
    const agentName = `Agent E2E ${rid}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "agent", rid);
    const siteKey = await createWebchatChannel(owner, `Webchat Agent ${rid}`);

    // --- Buat agent mode suggest (default form) lewat UI ---
    await navTo(owner, "AI Agents");
    await owner.getByRole("button", { name: "New agent" }).first().click();
    const agentDialog = owner.getByRole("dialog");
    await agentDialog
      .getByPlaceholder("e.g. Sales assistant")
      .fill(agentName);
    await agentDialog
      .getByPlaceholder(/You are the friendly assistant/)
      .fill(
        `Kamu adalah asisten penjualan kelas rekaman E2E ${rid}. Jawab singkat dan sebutkan harga serta garansi dari basis pengetahuan.`,
      );
    // Mode "Needs my approval" adalah default; pastikan terpilih & aktif.
    await agentDialog.getByLabel(/Needs my approval/).click();
    await agentDialog.getByLabel(/Active — this agent answers/).check();
    await agentDialog.getByRole("button", { name: "Create agent" }).click();
    await expect(agentDialog).toHaveCount(0, { timeout: 30_000 });
    const agentCard = owner.locator("li", { hasText: agentName });
    await expect(
      agentCard.getByText("Needs my approval", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(agentCard.getByText("Active", { exact: true })).toBeVisible();

    // --- Tambah dokumen Knowledge lewat UI (fakta unik di kalimat pertama) ---
    await navTo(owner, "Knowledge Base");
    await owner.getByRole("button", { name: "Add document" }).first().click();
    const kbDialog = owner.getByRole("dialog");
    await kbDialog
      .getByPlaceholder("e.g. Class prices & FAQ")
      .fill(`Fakta Kelas E2E ${rid}`);
    await kbDialog
      .getByPlaceholder(/Write the facts here/)
      .fill(
        `Harga kelas rekaman e2e${rid} adalah ${fact} dan garansi 7 hari. ` +
          `Kelas rekaman e2e${rid} mencakup materi mixing, mastering, dan workflow produksi untuk kreator.`,
      );
    await kbDialog.getByRole("button", { name: "Save document" }).click();
    await expect(kbDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(owner.getByText(`Fakta Kelas E2E ${rid}`)).toBeVisible({
      timeout: 30_000,
    });

    // --- Pengunjung bertanya sesuai isi KB ---
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor, siteKey);
    await widgetSend(visitor, `berapa harga kelas rekaman e2e${rid}?`);

    // --- Draf muncul di antrean + badge nav AI Agents = 1 ---
    const draftWithFact = owner.locator("li", { hasText: fact });
    await expect(async () => {
      await refreshAgentsPage(owner);
      await expect(draftWithFact.first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [3_000] });
    await expect(navBadge(agentsNavButton(owner))).toHaveText("1", {
      timeout: 30_000,
    });

    // --- Setujui → draf hilang, pengunjung menerima teksnya ---
    await draftWithFact
      .first()
      .getByRole("button", { name: "Approve & send" })
      .click();
    await expect(
      owner.getByText("No drafts waiting. When an approval-mode agent writes a reply, it will appear here."),
    ).toBeVisible({ timeout: 30_000 });
    await expectWidgetText(visitor, fact, 90_000);

    // --- Pertanyaan kedua → draf kedua → Tolak → hilang, badge bersih ---
    await widgetSend(visitor, `kelas rekaman e2e${rid} garansinya berapa lama?`);
    await expect(async () => {
      await refreshAgentsPage(owner);
      await expect(draftWithFact.first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [3_000] });
    await draftWithFact
      .first()
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await expect(
      owner.getByText("No drafts waiting. When an approval-mode agent writes a reply, it will appear here."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(navBadge(agentsNavButton(owner))).toHaveCount(0, {
      timeout: 30_000,
    });

    await visitorContext.close();
    await ownerContext.close();
  });
});
