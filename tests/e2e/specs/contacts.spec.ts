import { expect, test } from "@playwright/test";
import { navTo, registerAndCreateWorkspace, runId } from "../helpers";

/**
 * Kontak (Fase 1E): tambah lewat form UI, pencarian, dan edit stage/tags
 * lewat modal detail — perubahan harus bertahan setelah pindah halaman.
 */
test.describe("contacts", () => {
  test("tambah, cari, dan ubah stage/tags kontak lewat UI", async ({
    page,
  }) => {
    const rid = runId();
    const name = `Kontak E2E ${rid}`;
    await registerAndCreateWorkspace(page, "contacts", rid);

    await navTo(page, "Contacts");
    await expect(
      page.getByRole("heading", { name: "Contacts", exact: true }),
    ).toBeVisible();

    // --- Tambah kontak lewat form ---
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.getByPlaceholder("Contact name").fill(name);
    await page.getByPlaceholder("e.g. +62 812 3456 7890").fill("+62 812 555 0199");
    await page.getByPlaceholder("name@example.com").fill(`kontak-${rid}@mail.test`);
    await page
      .getByPlaceholder("e.g. lead, webinar, vip")
      .fill("e2e-tag");
    await page.getByRole("button", { name: "Save contact" }).click();

    const row = page.locator("li", { hasText: name });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("New", { exact: true })).toBeVisible();
    await expect(row.getByText("e2e-tag", { exact: true })).toBeVisible();

    // --- Pencarian menemukan kontak; kata acak menampilkan keadaan kosong ---
    const search = page.getByPlaceholder("Search name, phone, or email…");
    await search.fill(`zzz-tidak-ada-${rid}`);
    await expect(
      page.getByRole("heading", { name: "No contacts match your search" }),
    ).toBeVisible({ timeout: 30_000 });
    await search.fill(name);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // --- Modal detail: ubah stage → Qualified, tambah tag ---
    await row.getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Contact detail" }),
    ).toBeVisible();
    await dialog.getByLabel(/Pipeline stage/).selectOption("qualified");
    await dialog
      .getByPlaceholder("e.g. lead, webinar, vip")
      .fill("e2e-tag, prioritas");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(row.getByText("Qualified", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText("prioritas", { exact: true })).toBeVisible();

    // --- Bertahan setelah pindah halaman dan kembali ---
    await navTo(page, "Dashboard");
    await navTo(page, "Contacts");
    const rowAfter = page.locator("li", { hasText: name });
    await expect(rowAfter).toBeVisible({ timeout: 30_000 });
    await expect(
      rowAfter.getByText("Qualified", { exact: true }),
    ).toBeVisible();
    await expect(
      rowAfter.getByText("prioritas", { exact: true }),
    ).toBeVisible();
  });
});
