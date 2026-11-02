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
  /**
   * Base URL Meta Graph API (Fase 7A). Default https://graph.facebook.com
   * (versi ter-pin v26.0 ditambahkan klien sebagai segmen path); override
   * hanya untuk uji mock lokal di staging — pola yang sama dengan
   * TELEGRAM_API_BASE.
   */
  META_API_BASE: z.string().url().optional(),
  /**
   * Secret Meta App milik PLATFORM (Fase 7A): memverifikasi tanda tangan
   * `X-Hub-Signature-256` pada webhook /api/meta/webhook. Hanya di env
   * server — tidak pernah masuk repo/log. Belum diset = webhook Meta
   * menjawab 503 META_NOT_CONFIGURED (fail-closed). Nilai staging saat
   * ini PLACEHOLDER dan WAJIB diganti secret Meta App asli sebelum
   * trafik live (lihat docs/DEPLOY-STAGING.md).
   */
  META_APP_SECRET: z.string().min(1).optional(),
  /**
   * Token verifikasi handshake webhook Meta (Fase 7A): nilai bebas yang
   * KITA tentukan dan ditempel pemilik platform ke dashboard Meta App
   * (Webhook > Verify Token). Bukan rahasia dari Meta — ia dibagikan ke
   * owner/admin workspace lewat endpoint meta-webhook-info agar mereka
   * bisa memasang webhook. Hanya di env server.
   */
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
  /**
   * Identifier PUBLIK Meta untuk OAuth (Fase 7D) — FALLBACK env saja;
   * sumber utama adalah Panel Admin (kunci `meta_app_id` /
   * `meta_ig_config_id` / `meta_wa_config_id` di platform_settings).
   * Ketiganya bukan rahasia: App ID muncul di URL dialog OAuth dan
   * config ID diakui Meta bukan rahasia.
   */
  META_APP_ID: z.string().min(1).optional(),
  META_IG_CONFIG_ID: z.string().min(1).optional(),
  META_WA_CONFIG_ID: z.string().min(1).optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Pemilihan provider LLM agent (Fase 3A): 'mock' (default, deterministik,
   * tanpa biaya) atau 'openrouter' (model sungguhan via OpenRouter).
   */
  LLM_PROVIDER: z.enum(["mock", "openrouter"]).default("mock"),
  /**
   * Pemilihan provider EMBEDDING untuk retrieval semantik KB (Fase 12D):
   * - tidak diisi (auto): embedding aktif memakai OpenRouter bila ada
   *   kunci efektif (Panel Admin → env), selain itu NONAKTIF dan
   *   retrieval jatuh ke full-text murni;
   * - 'mock': paksa provider mock deterministik (rantai uji — vektor
   *   diturunkan dari hash token + peta konsep kecil, BUKAN model asli);
   * - 'openrouter': paksa OpenRouter (tetap nonaktif-anggun tanpa kunci,
   *   tidak pernah gagal keras seperti LLM_PROVIDER).
   */
  EMBEDDING_PROVIDER: z.enum(["mock", "openrouter"]).optional(),
  /** Model embedding OpenRouter (wajib 1536 dimensi); default di kode provider. */
  OPENROUTER_EMBEDDING_MODEL: z.string().min(1).optional(),
  /**
   * Jendela batching balasan AI (Fase 9A): job `agent.respond` untuk
   * pesan pemicu dijadwalkan worker dengan delay sebesar ini; job yang
   * pesannya sudah disusul pesan masuk yang lebih baru MENYERAH
   * (audit agent.batched) sehingga satu rentetan pesan beruntun hanya
   * dijawab sekali. Trade-off yang disengaja: balasan agent tiba
   * ±satu jendela lebih lambat. 0 = tanpa penundaan (penyerahan tetap
   * mungkin bila pesan berikutnya tiba sebelum job berjalan).
   */
  AGENT_BATCH_WINDOW_MS: z.coerce.number().int().min(0).max(120_000).default(5_000),
  /** Provider AI untuk pengembangan (OpenRouter free tier). Mock LLM adalah default di test. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).optional(),
  /**
   * Panel Admin Platform (Fase 6C): daftar email pemilik platform yang
   * boleh membuka /api/admin/* & halaman /admin — koma-terpisah,
   * pencocokan tidak peka huruf. Kosong = tidak ada admin (panel terkunci).
   * Ini SATU-SATUNYA gerbang admin v1; peran per-tenant tidak terlibat.
   */
  PLATFORM_ADMIN_EMAILS: z.string().min(1).optional(),
  /**
   * Kunci induk enkripsi Panel Admin (Fase 6C): base64 dari 32 byte acak,
   * AES-256-GCM untuk nilai `platform_settings` di DB. Hanya di env server
   * (bootstrap secret) — nilai panel yang ia lindungi TIDAK pernah di env.
   */
  PLATFORM_SETTINGS_SECRET: z.string().min(16).optional(),
  /**
   * Kredensial Cloudflare R2 sebagai FALLBACK env (Fase 6C): sumber utama
   * adalah Panel Admin (tabel platform_settings terenkripsi); env hanya
   * dipakai bila panel kosong untuk kunci itu. Nilai fallback lama dari
   * masa pra-panel; jangan menambah pemasangan baru lewat env.
   */
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Override nama bucket R2; default diturunkan dari NODE_ENV (lihat R2_BUCKET_NAMES). */
  R2_BUCKET: z.string().min(1).optional(),
  /**
   * Email transaksional via Resend (keputusan user 2026-11-02; Fase 11B)
   * — FALLBACK env saja; sumber utama adalah Panel Admin (kunci
   * `resend_api_key` / `resend_from_email` / `resend_from_name` di
   * platform_settings, resolusi panel → env seperti kunci lain).
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  RESEND_FROM_NAME: z.string().min(1).optional(),
  /**
   * Base URL API Resend (Fase 11B). Default https://api.resend.com di
   * kode klien core; override hanya untuk mock rantai uji — pola yang
   * sama dengan TELEGRAM_API_BASE / META_API_BASE.
   */
  RESEND_API_BASE: z.string().url().optional(),
});

/**
 * Cloudflare R2 (keputusan user 2026-11-01) — konfigurasi BUKAN rahasia:
 * account id & nama bucket boleh tampil di UI Panel Admin sebagai info
 * tetap. Endpoint S3-compatible diturunkan dari account id. Yang rahasia
 * hanya Access Key ID + Secret Access Key (panel/env, lihat di atas).
 */
export const R2_ACCOUNT_ID = "bb2c1b6af93981fdd0a97da3b26aa82c";
export const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
export const R2_BUCKET_NAMES = {
  staging: "sahabat-kreator-staging",
  production: "sahabat-kreator-prod",
} as const;

/**
 * Bucket aktif: override env `R2_BUCKET` menang; tanpa override defaultnya
 * bucket STAGING. Sengaja TIDAK diturunkan dari NODE_ENV — di server
 * staging pun NODE_ENV=production (mode runtime), jadi turunan dari sana
 * akan salah sasaran. Deployment production WAJIB men-set R2_BUCKET ke
 * bucket prod secara eksplisit (arah gagal yang aman: ke bucket dev).
 */
export function resolveR2Bucket(override?: string): string {
  return override || R2_BUCKET_NAMES.staging;
}

export type Env = z.infer<typeof EnvSchema>;

/** Parse & validasi env; gagal cepat (throw) bila ada nilai yang tidak valid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
