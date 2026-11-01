import type { Locale } from "@sahabat-kreator/i18n";

function intlLocale(locale: Locale): string {
  return locale === "id" ? "id-ID" : "en-US";
}

/** Format tanggal+waktu lengkap lewat Intl (RANCANGAN §11.1 — tanpa format manual). */
export function formatDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Label waktu ringkas untuk daftar percakapan: jam hari ini, tanggal bila lebih lama. */
export function formatListTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...(sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" }),
  }).format(d);
}

/** Jam menit untuk meta gelembung pesan. */
export function formatTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
