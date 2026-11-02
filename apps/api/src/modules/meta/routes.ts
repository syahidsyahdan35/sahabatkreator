import { Hono } from "hono";
import {
  decryptChannelSecret,
  fetchAndStoreMetaContactProfile,
  recordMetaInboundMessage,
  resolveMetaAccountByExternalId,
  type MetaAccountRef,
  type MetaProvider,
} from "@sahabat-kreator/core";
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookSignature,
} from "@sahabat-kreator/channel-messenger";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";

/**
 * Modul meta publik (Fase 7A) — webhook TUNGGAL Meta untuk Messenger +
 * Instagram. TANPA sesi dashboard.
 *
 *   GET  /meta/webhook   handshake verifikasi (hub.mode/hub.verify_token/
 *                        hub.challenge dari dashboard Meta App)
 *   POST /meta/webhook   event messaging bertanda tangan
 *
 * Kepercayaan berlapis (berbeda dari Telegram yang per-akun):
 * 1. Handshake: `hub.verify_token` harus sama persis dengan env
 *    `META_WEBHOOK_VERIFY_TOKEN` (nilai yang KITA tentukan dan ditempel
 *    pemilik platform ke Meta App). Selain itu 403.
 * 2. Event: header `X-Hub-Signature-256` = HMAC-SHA256(raw body, env
 *    `META_APP_SECRET`). App secret belum diset → 503 META_NOT_CONFIGURED
 *    (fail-closed: tanpa secret, tidak ada payload yang bisa dipercaya);
 *    tanda tangan salah → 401 META_SIGNATURE_INVALID.
 * 3. Sesudah tanda tangan lolos, akun diselesaikan dari `entry.id`
 *    payload per (provider, external_id) lewat lengan RLS 0020;
 *    objek `page` → messenger, `instagram` → instagram. Akun tak
 *    dikenal / tidak 'connected' → event diabaikan (tetap 200 agar Meta
 *    tidak me-retry; disconnect di sisi kita memang memutus arus ini).
 *
 * Handler menjawab cepat: event non-teks & echo (pantulan kiriman kita
 * sendiri, `message.is_echo`) dilewati; DM teks disimpan lewat core
 * (kontak + percakapan + pesan + outbox `message.received` dalam satu
 * transaksi) — automation/agent bekerja di worker lewat relay outbox.
 * Identitas yang BARU pertama kali terlihat memicu pengambilan profil
 * Graph kontaknya (nama + foto, pola Fase 6D) secara fire-and-forget.
 */
export interface MetaModuleOptions {
  /** Secret Meta App platform (env META_APP_SECRET) untuk verifikasi tanda tangan. */
  appSecret?: string;
  /** Verify token handshake (env META_WEBHOOK_VERIFY_TOKEN). */
  verifyToken?: string;
  /** Material kunci dekripsi kredensial channel (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret?: string;
  /** Base URL Graph API (env META_API_BASE; default graph.facebook.com). */
  metaApiBase?: string;
  /** Versi Graph ter-pin (dari @sahabat-kreator/config). */
  graphApiVersion: string;
}

export function createMetaRoutes(
  bundle: AuthBundle | null,
  publisher: RealtimePublisher | null,
  opts: MetaModuleOptions,
) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/meta/webhook", (c) => {
    if (!opts.verifyToken) {
      return apiError(
        c,
        503,
        "META_NOT_CONFIGURED",
        "Meta webhook verify token is not configured",
      );
    }
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && token === opts.verifyToken && challenge) {
      return c.text(challenge, 200);
    }
    return apiError(c, 403, "FORBIDDEN", "Webhook verification failed");
  });

  app.post("/meta/webhook", async (c) => {
    if (!bundle) {
      return apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    }
    if (!opts.appSecret) {
      return apiError(
        c,
        503,
        "META_NOT_CONFIGURED",
        "Meta app secret is not configured",
      );
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    if (!verifyMetaWebhookSignature(rawBody, signature, opts.appSecret)) {
      return apiError(
        c,
        401,
        "META_SIGNATURE_INVALID",
        "Invalid webhook signature",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Body rusak dari pengirim yang lolos tanda tangan: jawab 200 agar
      // Meta tidak me-retry selamanya; tidak ada yang disimpan.
      return c.json({ ok: true });
    }

    const events = parseMetaWebhookEvents(payload);
    // Resolusi akun per (provider, entry.id) di-cache dalam request ini:
    // satu payload bisa memuat banyak pesan untuk Page/IG yang sama.
    const accountCache = new Map<string, MetaAccountRef | null>();
    const resolveAccount = async (
      provider: MetaProvider,
      externalId: string,
    ): Promise<MetaAccountRef | null> => {
      const key = `${provider}:${externalId}`;
      const cached = accountCache.get(key);
      if (cached !== undefined) return cached;
      const account = await resolveMetaAccountByExternalId(
        bundle.db,
        provider,
        externalId,
      );
      accountCache.set(key, account);
      return account;
    };

    for (const event of events) {
      // Echo = pantulan pesan yang kita kirim sendiri (sudah tercatat
      // sebagai outbound saat dikirim poller) — jangan jadi pesan masuk.
      if (event.isEcho) continue;
      // v1 hanya pesan teks (lampiran/stiker/like belum dicatat).
      if (!event.text || !event.text.trim()) continue;
      const provider: MetaProvider =
        event.objectKind === "page" ? "messenger" : "instagram";
      const account = await resolveAccount(provider, event.entryExternalId);
      if (!account || account.status !== "connected") continue;

      const recorded = await recordMetaInboundMessage(bundle.db, account, {
        senderExternalId: event.senderExternalId,
        providerMessageId: event.providerMessageId,
        text: event.text,
      });
      if (!recorded) continue;

      if (recorded.identityCreated) {
        triggerContactProfile(bundle, opts, account, recorded.contactId, event.senderExternalId);
      }
      if (publisher) {
        await publisher.publishNudge({
          kind: "message.received",
          tenantId: account.tenantId,
          conversationId: recorded.message.conversationId,
        });
      }
    }
    return c.json({ ok: true });
  });

  return app;
}

/**
 * Fase 7A (pola 6D): identitas Meta yang BARU pertama kali terlihat
 * memicu pengambilan profil Graph pengirimnya — nama asli (webhook Meta
 * tidak menyertakan nama) + foto profil. Best-effort & fire-and-forget:
 * webhook tetap menjawab seketika dan helper core tidak pernah melempar.
 */
function triggerContactProfile(
  bundle: AuthBundle,
  opts: MetaModuleOptions,
  account: MetaAccountRef,
  contactId: string,
  senderExternalId: string,
): void {
  if (!account.accessTokenEncrypted || !opts.channelTokenSecret) return;
  const accessToken = decryptChannelSecret(
    opts.channelTokenSecret,
    account.accessTokenEncrypted,
  );
  if (!accessToken) return;
  void fetchAndStoreMetaContactProfile(bundle.db, {
    tenantId: account.tenantId,
    accessToken,
    metaApiBase: opts.metaApiBase,
    graphApiVersion: opts.graphApiVersion,
    provider: account.provider as MetaProvider,
    senderExternalId,
    contactId,
  });
}
