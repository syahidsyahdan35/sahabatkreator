import { expect, test } from "@playwright/test";
import { emailFor, loginViaUi, registerViaUi, runId } from "../helpers";

/**
 * Autentikasi (Fase 1C): register lewat UI → shell, logout, login lagi,
 * error password salah, dan proteksi route tanpa sesi.
 */
test.describe("auth", () => {
  test("register lewat UI masuk shell, logout, lalu login lagi", async ({
    page,
  }) => {
    const rid = runId();
    const email = emailFor(rid, "auth");

    await registerViaUi(page, { name: `E2E Auth ${rid}`, email });

    // Keluar dari sidebar (blok profil).
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();

    // Masuk lagi dengan kredensial yang sama.
    await loginViaUi(page, email);
    await expect(
      page.getByRole("heading", { name: "Create your first workspace" }),
    ).toBeVisible();
  });

  test("login dengan password salah menampilkan pesan error", async ({
    page,
  }) => {
    const rid = runId();
    const email = emailFor(rid, "authwrong");
    await registerViaUi(page, { name: `E2E AuthWrong ${rid}`, email });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("PasswordSalah!99");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText("Email or password is incorrect.");
    // Tetap di halaman login (tidak masuk shell).
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("aside")).toHaveCount(0);
  });

  test("akses / tanpa sesi diarahkan ke /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });
});
