import { en, type Resources } from "./resources/en";
import { id } from "./resources/id";

export { en, id };
export type { Resources };

export type Locale = "en" | "id";
export const DEFAULT_LOCALE: Locale = "en";
export const resources: Record<Locale, Resources> = { en, id };

/** Union semua kunci terjemahan dalam notasi dot, diturunkan dari resource `en`. */
type DotKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotKeys<T[K]>}`;
}[keyof T & string];
export type TranslationKey = DotKeys<Resources>;

function getByPath(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * Buat fungsi t() untuk satu locale. Fallback selalu ke `en` (RANCANGAN §11.1).
 * Contoh: const t = createTranslator("id"); t("nav.inbox") // "Inbox"
 */
export function createTranslator(locale: Locale) {
  return function t(key: TranslationKey): string {
    return getByPath(resources[locale], key) ?? getByPath(en, key) ?? key;
  };
}

/** Format angka sesuai locale aktif (selalu lewat Intl, RANCANGAN §11.1). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US").format(value);
}
