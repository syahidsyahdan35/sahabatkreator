import { z } from "zod";

/** Versi aplikasi (semver paket root). */
export const APP_VERSION = "0.1.0";

/**
 * Baseline Meta Graph API: v26.0 (RANCANGAN §12.1).
 * Ter-pin secara eksplisit — TIDAK ada panggilan unversioned ke Meta.
 * Upgrade versi adalah proses terjadwal: cek changelog Meta + contract test.
 */
export const META_GRAPH_API_VERSION = "v26.0" as const;

export const META_GRAPH_API_VERSION_BY_CHANNEL = {
  whatsapp: META_GRAPH_API_VERSION,
  instagram: META_GRAPH_API_VERSION,
  messenger: META_GRAPH_API_VERSION,
} as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Port apps/realtime (Fase 6G) — gateway WebSocket mandiri. Bind
   * 127.0.0.1 di server; publik menjangkaunya lewat proxy `/realtime`
   * pada web preview (staging) / reverse-proxy (produksi).
   */
  REALTIME_PORT: z.coerce.number().int().positive().default(3103),
  DATABASE_URL: z.string().url().optional(),
  /** Better Auth (Fase 1B): secret penandatanganan sesi & URL publik aplikasi. */
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  /** Secret HMAC untuk token sesi pengunjung webchat (Fase 1F). */
  WEBCHAT_SECRET: z.string().min(16).optional(),
  /**
   * Kunci enkripsi kredensial channel (Fase 6A): base64 dari 32 byte acak,
   * dipakai AES-256-GCM untuk token bot Telegram (dan kelak token Meta).
   * Hanya di env server — tidak pernah masuk repo/log.
   */
  CHANNEL_TOKEN_SECRET: z.string().min(16).optional(),
  /**
   * Base URL Telegram Bot API (Fase 6A). Default https://api.telegram.org;
   * override hanya untuk uji mock lokal di staging.
   */
  TELEGRAM_API_BASE: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Pemilihan provider LLM agent (Fase 3A): 'mock' (default, deterministik,
   * tanpa biaya) atau 'openrouter' (model sungguhan via OpenRouter).
   */
  LLM_PROVIDER: z.enum(["mock", "openrouter"]).default("mock"),
  /** Provider AI untuk pengembangan (OpenRouter free tier). Mock LLM adalah default di test. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse & validasi env; gagal cepat (throw) bila ada nilai yang tidak valid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
