import { expect, test } from "@playwright/test";
import {
  createWorkspaceFromEmptyState,
  emailFor,
  registerViaUi,
  runId,
} from "../helpers";

/**
 * Workspace (Fase 1C): buat dari keadaan kosong Dashboard, buat kedua dari
 * pemilih sidebar, dan beralih konteks di antara keduanya.
 */
test.describe("workspace", () => {
  test("buat dua workspace dan beralih konteks lewat switcher", async ({
    page,
  }) => {
    const rid = runId();
    const first = `Studio Satu ${rid}`;
    const second = `Studio Dua ${rid}`;

    await registerViaUi(page, {
      name: `E2E WS ${rid}`,
      email: emailFor(rid, "ws"),
    });

    // Workspace pertama dari form keadaan kosong Dashboard.
    await createWorkspaceFromEmptyState(page, first);

    // Workspace kedua dari pemilih di sidebar ("+ New workspace").
    const aside = page.locator("aside");
    await aside.getByRole("button", { name: "+ New workspace" }).click();
    await aside.getByLabel("Workspace name").fill(second);
    await aside.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText(`Active workspace: ${second}`)).toBeVisible({
      timeout: 30_000,
    });

    // Beralih kembali ke workspace pertama → banner konteks berubah.
    await aside.getByLabel("Workspace").selectOption({ label: first });
    await expect(page.getByText(`Active workspace: ${first}`)).toBeVisible({
      timeout: 30_000,
    });

    // Dan sebaliknya sekali lagi untuk memastikan pilihan benar-benar aktif.
    await aside.getByLabel("Workspace").selectOption({ label: second });
    await expect(page.getByText(`Active workspace: ${second}`)).toBeVisible({
      timeout: 30_000,
    });
  });
});
