import { useEffect } from "react";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface WebchatDemoPageProps {
  t: Translate;
  locale: Locale;
}

/**
 * Halaman demo publik webchat (Fase 1F) — DI LUAR shell & tanpa login.
 * Memasang widget persis seperti situs tenant: satu <script src="/widget.js"
 * data-site-key="..."> dengan siteKey dari query (?key=wc_...). Pemilik
 * workspace bisa mencoba rantai pengunjung sungguhan dari browser.
 */
export function WebchatDemoPage({ t, locale }: WebchatDemoPageProps) {
  const siteKey =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("key")
      : null;

  useEffect(() => {
    if (!siteKey) return;
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.dataset.siteKey = siteKey;
    script.dataset.lang = locale;
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [siteKey, locale]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl bg-bg px-4 py-10 text-ink">
      <div className="text-lg font-bold">{t("app.name")}</div>
      <h1 className="mt-6 text-2xl font-bold">{t("channels.demoTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("channels.demoBody")}</p>
      {siteKey ? (
        <p className="mt-4 text-sm">
          {t("channels.siteKeyLabel")}:{" "}
          <code className="font-mono">{siteKey}</code>
        </p>
      ) : (
        <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm">
          {t("channels.demoMissingKey")}
        </p>
      )}
    </main>
  );
}
