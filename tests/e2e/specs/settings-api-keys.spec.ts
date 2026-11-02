import { expect, test } from "@playwright/test";
import { navTo, registerAndCreateWorkspace, runId } from "../helpers";

/**
 * API Keys (Fase 5A) — alur penuh lewat UI Settings:
 * buat kunci (nama + centang scope tulis) → modal menampilkan kunci UTUH
 * satu kali berawalan sk_live_ → daftar hanya menampilkan awalan →
 * kunci dipakai memanggil API publik /api/v1/me (tenant cocok) →
 * kunci dicabut lewat UI (konfirmasi) → panggilan yang sama ditolak 401.
 *
 * Nilai kunci utuh hanya hidup di variabel tes & header request —
 * TIDAK PERNAH dicetak ke log (assertion hanya memakai awalannya).
 */
test.describe("settings — API keys", () => {
  test("kunci dibuat lewat UI, bekerja di /api/v1, dan mati setelah dicabut", async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const rid = runId();
    const keyName = `Kunci E2E ${rid}`;

    const { workspaceName } = await registerAndCreateWorkspace(
      page,
      "apikeys",
      rid,
    );

    // --- Buka Settings → bagian API Keys ---
    await navTo(page, "Settings");
    await expect(
      page.getByRole("heading", { name: "API keys", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No API keys yet")).toBeVisible();

    // --- Buat kunci lewat form UI (nama + scope tulis dicentang eksplisit) ---
    await page.getByRole("button", { name: "Create API key" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: "New API key" }),
    ).toBeVisible();
    await createDialog
      .getByPlaceholder("e.g. My website integration")
      .fill(keyName);
    // Scope baca tercentang bawaan; tambahkan satu scope tulis.
    await createDialog
      .getByRole("checkbox", { name: /Create contacts/ })
      .check();
    await createDialog.getByRole("button", { name: "Create key" }).click();

    // --- Modal hasil: kunci UTUH tampil satu kali, berawalan sk_live_ ---
    const createdDialog = page.getByRole("dialog");
    await expect(
      createdDialog.getByRole("heading", { name: "Your new API key" }),
    ).toBeVisible({ timeout: 30_000 });
    const fullKey = (
      await createdDialog
        .getByText(/^sk_live_[A-Za-z0-9_-]+$/)
        .innerText()
    ).trim();
    expect(fullKey.startsWith("sk_live_")).toBe(true);
    expect(fullKey.length).toBeGreaterThan(20);
    const keyPrefix = fullKey.slice(0, "sk_live_".length + 4);
    await createdDialog
      .getByRole("button", { name: "Done, I saved it" })
      .click();
    await expect(createdDialog).toHaveCount(0);

    // --- Daftar hanya menampilkan AWALAN, bukan kunci utuh ---
    const card = page.locator("li", { hasText: keyName });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(`Key: ${keyPrefix}…`)).toBeVisible();
    await expect(card.getByText("Active", { exact: true })).toBeVisible();
    await expect(card.getByText("contacts:write", { exact: true })).toBeVisible();
    // Kunci utuh tidak boleh muncul di mana pun di halaman setelah modal tutup.
    await expect(page.getByText(fullKey)).toHaveCount(0);

    // --- Kunci bekerja di API publik: /api/v1/me menunjuk workspace ini ---
    const meOk = await request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(meOk.status()).toBe(200);
    const me = (await meOk.json()) as {
      tenantId: string;
      tenantName: string;
      scopes: string[];
    };
    expect(me.tenantName).toBe(workspaceName);
    expect(me.tenantId).toBeTruthy();
    expect(me.scopes).toContain("contacts:write");
    expect(me.scopes).toContain("contacts:read");

    // --- Cabut lewat UI (dengan modal konfirmasi) ---
    await card.getByRole("button", { name: "Revoke" }).click();
    const revokeDialog = page.getByRole("dialog");
    await expect(
      revokeDialog.getByRole("heading", { name: "Revoke this key?" }),
    ).toBeVisible();
    await revokeDialog.getByRole("button", { name: "Revoke" }).click();
    await expect(revokeDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(card.getByText("Revoked", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // --- Kunci yang sama sekarang ditolak 401 ---
    const meRevoked = await request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${fullKey}` },
    });
    expect(meRevoked.status()).toBe(401);
  });
});
