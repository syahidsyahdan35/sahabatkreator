import { expect, test } from "@playwright/test";
import {
  navTo,
  registerAndCreateWorkspace,
  runId,
} from "../helpers";

/**
 * Produk & tautan bayar (Fase 4A): produk dibuat lewat UI, tautan bayar
 * dibuat dari UI, halaman publik /pay/:code menampilkan label SIMULASI
 * dan harga Rp yang benar, pembayaran simulasi mengubah status menjadi
 * Lunas — dan status itu terbaca kembali di daftar tautan dashboard.
 */
test.describe("products & payment links", () => {
  test("produk → tautan bayar → bayar simulasi → status Lunas", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const rid = runId();
    const productName = `Produk E2E ${rid}`;

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerAndCreateWorkspace(owner, "prod", rid);

    // --- Buat produk lewat UI ---
    await navTo(owner, "Products");
    await owner.getByRole("button", { name: "Add product" }).first().click();
    const dialog = owner.getByRole("dialog");
    await dialog
      .getByPlaceholder("e.g. Kilat Recording Class")
      .fill(productName);
    await dialog
      .getByPlaceholder("What the buyer gets: materials, access, guarantee…")
      .fill(`Materi lengkap kelas E2E ${rid}, akses selamanya.`);
    await dialog.getByPlaceholder("e.g. 349000").fill("349000");
    await dialog.getByRole("button", { name: "Save product" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    const card = owner.locator("li", { hasText: productName });
    await expect(card).toBeVisible({ timeout: 30_000 });

    // --- Buat tautan bayar dari UI, tangkap URL-nya ---
    await card.getByRole("button", { name: "Create payment link" }).click();
    const linkDialog = owner.getByRole("dialog");
    await expect(
      linkDialog.getByRole("heading", { name: "Payment link is ready" }),
    ).toBeVisible({ timeout: 30_000 });
    const urlText =
      (await linkDialog.locator("p").filter({ hasText: "/pay/" }).innerText()).trim();
    const codeMatch = urlText.match(/\/pay\/(pay_[A-Za-z0-9]+)/);
    if (!codeMatch) throw new Error(`Kode tautan tidak ditemukan: ${urlText}`);
    const code = codeMatch[1];
    await linkDialog.getByRole("button", { name: "Close" }).click();

    // --- Halaman bayar publik di konteks baru (tanpa login) ---
    const buyerContext = await browser.newContext();
    const buyer = await buyerContext.newPage();
    await buyer.goto(`/pay/${code}`);
    await expect(
      buyer.getByText("SIMULATION — not a real payment"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      buyer.getByRole("heading", { name: productName }),
    ).toBeVisible();
    await expect(buyer.getByText(/Rp\s?349\.000/)).toBeVisible();
    await expect(buyer.getByText("Waiting for payment")).toBeVisible();

    await buyer.getByRole("button", { name: "Pay (simulation)" }).click();
    await expect(buyer.getByText("Payment successful")).toBeVisible({
      timeout: 30_000,
    });
    await expect(buyer.getByText(/Paid at/)).toBeVisible();

    // --- Kembali ke dashboard: daftar tautan membaca status Paid ---
    await navTo(owner, "Dashboard");
    await navTo(owner, "Products");
    const linkRow = owner.locator("li", { hasText: productName }).last();
    await expect(linkRow).toBeVisible({ timeout: 30_000 });
    await expect(linkRow.getByText("Paid", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await buyerContext.close();
    await ownerContext.close();
  });
});
