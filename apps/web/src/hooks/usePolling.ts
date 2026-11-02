import { useEffect, useRef } from "react";

/**
 * Interval penyegaran latar dashboard (Hotfix Dashboard Realtime).
 *
 * Ini JEMBATAN sampai Fase 6G (apps/realtime — gateway WebSocket + Redis
 * pub/sub) live: saat itu transport utama menjadi push dan polling ini
 * turun pangkat menjadi fallback otomatis ketika WS terputus. Karena itu
 * semua penyegaran berkala dashboard WAJIB lewat hook ini + konstanta ini,
 * bukan setInterval liar per halaman — satu tempat untuk diganti nanti.
 */
export const LIVE_REFRESH_INTERVAL_MS = 5_000;

/**
 * Jalankan `callback` berkala selama komponen terpasang:
 * - Setiap `intervalMs`, HANYA bila tab terlihat (`document.hidden` = lewati).
 * - Satu penyegaran segera saat tab kembali terlihat / jendela fokus.
 * - Guard in-flight: siklus yang masih berjalan tidak ditumpuk request baru
 *   (kegagalan jaringan sesaat pun tidak menumpuk — siklus berikut mencoba
 *   lagi; error latar selalu ditelan diam oleh hook ini).
 * - Interval & listener dibersihkan penuh saat unmount / `enabled` mati.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number = LIVE_REFRESH_INTERVAL_MS,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const tick = async () => {
      if (document.hidden || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await callbackRef.current();
      } catch {
        /* kegagalan latar: diam — siklus berikut mencoba lagi */
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = setInterval(() => void tick(), intervalMs);
    const onWake = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [intervalMs, enabled]);
}
