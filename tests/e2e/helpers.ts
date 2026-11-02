import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Helper bersama suite E2E (Fase QA-1).
 *
 * Prinsip selektor: berbasis role/teks yang terlihat pengguna (label menu,
 * label form, placeholder) — BUKAN class CSS atau struktur internal, supaya
 * tes tidak rapuh terhadap perubahan styling.
 *
 * Setiap run memakai akun uji BARU berawalan `e2e-...@sk.test` dan nama
 * unik per run (runId) agar suite bisa diulang tanpa konflik data di
 * staging (akun uji lama memang dibiarkan tertinggal di staging).
 */

export const TEST_PASSWORD = "E2eTest!234";

/** Id unik per pemanggilan: waktu (base36) + acak pendek. */
export function runId(): string {
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(36)
    .padStart(3, "0");
  return `${Date.now().toString(36)}${rand}`;
}

export function emailFor(rid: string, label: string): string {
  return `e2e-${label}-${rid}@sk.test`;
}

/**
 * Klik tombol submit form auth dan tunggu hasilnya, TAHAN terhadap rate
 * limit bawaan Better Auth: staging berada di balik Cloudflare Tunnel
 * sehingga semua lalu lintas tampak dari satu IP dan jendela rate limit
 * sign-up/sign-in terbagi untuk semua — suite yang mendaftarkan banyak
 * akun uji bisa menabraknya, sama seperti pengguna sungguhan dari IP
 * bersama. Bila alert "Too many requests" muncul, tunggu jendelanya
 * lewat (nilai formulir tetap terisi) lalu kirim ulang. Assertion akhir
 * TIDAK dilemahkan: keberhasilan tetap wajib terlihat.
 */
async function submitAuthForm(
  page: Page,
  buttonName: string,
  success: Locator,
): Promise<void> {
  const button = page.getByRole("button", { name: buttonName, exact: true });
  const rateLimitAlert = page
    .getByRole("alert")
    .filter({ hasText: "Too many requests" });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await button.click();
    try {
      await success.waitFor({ state: "visible", timeout: 20_000 });
      return;
    } catch {
      // Belum berhasil: hanya rate limit yang boleh memicu kirim ulang.
      if (attempt < 4 && (await rateLimitAlert.isVisible())) {
        await page.waitForTimeout(30_000);
        continue;
      }
      break;
    }
  }
  await expect(success).toBeVisible({ timeout: 30_000 });
}

/** Daftar akun baru lewat UI register; berakhir di shell (dashboard). */
export async function registerViaUi(
  page: Page,
  input: { name: string; email: string; password?: string },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(input.name);
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password ?? TEST_PASSWORD);
  // Shell termuat: user baru belum punya workspace → keadaan kosong dashboard.
  await submitAuthForm(
    page,
    "Create account",
    page.getByRole("heading", { name: "Create your first workspace" }),
  );
}

/** Login lewat UI; berakhir di shell (Dashboard termuat — berlaku juga di viewport mobile yang menyembunyikan sidebar). */
export async function loginViaUi(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await submitAuthForm(
    page,
    "Sign in",
    page.getByRole("heading", { name: "Creator Dashboard" }),
  );
}

/** Buat workspace pertama dari keadaan kosong Dashboard. */
export async function createWorkspaceFromEmptyState(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText(`Active workspace: ${name}`)).toBeVisible({
    timeout: 30_000,
  });
}

/** Kombinasi umum: daftar akun baru + buat workspace pertamanya. */
export async function registerAndCreateWorkspace(
  page: Page,
  label: string,
  rid: string,
): Promise<{ email: string; workspaceName: string }> {
  const email = emailFor(rid, label);
  const workspaceName = `Studio E2E ${label} ${rid}`;
  await registerViaUi(page, { name: `E2E ${label} ${rid}`, email });
  await createWorkspaceFromEmptyState(page, workspaceName);
  return { email, workspaceName };
}

/** Klik item navigasi di SIDEBAR desktop (registry §10.1, state-based). */
export async function navTo(page: Page, label: string): Promise<void> {
  await page
    .locator("aside")
    .getByRole("button", { name: new RegExp(`^${label}(\\s|$)`) })
    .click();
}

/** Tombol nav Inbox di sidebar (untuk memeriksa badge unread-nya). */
export function inboxNavButton(page: Page): Locator {
  return page.locator("aside").getByRole("button", { name: /^Inbox(\s|$)/ });
}

/** Tombol nav AI Agents di sidebar (untuk memeriksa badge persetujuan). */
export function agentsNavButton(page: Page): Locator {
  return page
    .locator("aside")
    .getByRole("button", { name: /^AI Agents(\s|$)/ });
}

/**
 * Span badge angka di dalam tombol nav (struktur tombol: ikon, span label,
 * lalu span badge bila ada). Mengembalikan locator span badge (bisa kosong).
 */
export function navBadge(navButton: Locator): Locator {
  return navButton.locator("span").nth(1);
}

/**
 * Buat channel Webchat dari halaman Channels dan kembalikan siteKey-nya
 * persis seperti yang ditampilkan UI kepada pemilik workspace.
 */
export async function createWebchatChannel(
  page: Page,
  channelName: string,
): Promise<string> {
  await navTo(page, "Channels");
  await expect(
    page.getByRole("heading", { name: "Channels", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Channel name").fill(channelName);
  await page.getByRole("button", { name: "Create Webchat channel" }).click();
  const card = page.locator("article", { hasText: channelName });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const codeText = await card.locator("code").first().innerText();
  const match = codeText.match(/wc_[A-Za-z0-9_-]+/);
  if (!match) {
    throw new Error(`siteKey tidak ditemukan pada kartu channel: ${codeText}`);
  }
  return match[0];
}

/** Buka halaman demo webchat sebagai pengunjung dan buka panel widget. */
export async function openWidget(page: Page, siteKey: string): Promise<void> {
  await page.goto(`/webchat-demo?key=${siteKey}`);
  await page.getByRole("button", { name: "Chat with us" }).click();
  await expect(page.getByPlaceholder("Type a message…")).toBeVisible({
    timeout: 30_000,
  });
}

/** Kirim pesan dari widget pengunjung; gelembung pesan sendiri harus tampil. */
export async function widgetSend(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("Type a message…").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** Tunggu teks muncul di panel widget pengunjung (balasan pemilik/automation/agent). */
export async function expectWidgetText(
  page: Page,
  text: string,
  timeoutMs = 60_000,
): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({
    timeout: timeoutMs,
  });
}

/** Jumlah kemunculan teks persis di halaman (untuk cek balasan TIDAK ganda). */
export async function countExactText(page: Page, text: string): Promise<number> {
  return page.getByText(text, { exact: true }).count();
}

/**
 * Buka Inbox dan tunggu sampai percakapan yang cuplikan pesan terakhirnya
 * memuat `previewText` tampil di daftar, menekan tombol Reload berkala
 * (daftar Inbox tidak memuat ulang sendiri saat halaman sudah terbuka).
 * Mengembalikan locator tombol baris percakapannya.
 */
export async function waitConversationListed(
  page: Page,
  previewText: string,
  timeoutMs = 60_000,
) {
  await navTo(page, "Inbox");
  const item = page.locator("li button", { hasText: previewText }).first();
  await expect(async () => {
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(item).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: timeoutMs, intervals: [2_000] });
  return item;
}

/** Tunggu percakapan tampil di daftar Inbox lalu klik untuk membuka utasnya. */
export async function openConversationByPreview(
  page: Page,
  previewText: string,
  timeoutMs = 60_000,
): Promise<void> {
  const item = await waitConversationListed(page, previewText, timeoutMs);
  await item.click();
  // Utas terbuka: kotak balas tampil.
  await expect(page.getByPlaceholder("Write a reply…")).toBeVisible({
    timeout: 30_000,
  });
}

/** Cek tidak ada elemen yang meluber horizontal pada halaman saat ini. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}
