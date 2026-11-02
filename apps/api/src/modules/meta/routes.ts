import { Hono } from "hono";
import {
  applyWhatsAppMessageStatus,
  decryptChannelSecret,
  fetchAndStoreMetaContactProfile,
  getProviderSecret,
  recordMetaInboundMessage,
  recordWhatsAppInboundMessage,
  resolveMetaAccountByExternalId,
  resolveWhatsAppAccountByPhoneNumberId,
  type MetaAccountRef,
  type MetaProvider,
  type PlatformSettingsOptions,
  type WhatsAppAccountRef,
} from "@sahabat-kreator/core";
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookSignature,
} from "@sahabat-kreator/channel-messenger";
import {
  isWhatsAppWebhookPayload,
  parseWhatsAppWebhookEvents,
} from "@sahabat-kreator/channel-whatsapp";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";

/**
 * Modul meta publik (Fase 7A; WhatsApp Fase 7B) — webhook TUNGGAL Meta
 * untuk Messenger + Instagram + WhatsApp. TANPA sesi dashboard.
 *
 *   GET  /meta/webhook   handshake verifikasi (hub.mode/hub.verify_token/
 *                        hub.challenge dari dashboard Meta App)
 *   POST /meta/webhook   event messaging bertanda tangan
 *
 * Kepercayaan berlapis (berbeda dari Telegram yang per-akun):
 * 1. Handshake: `hub.verify_token` harus sama persis dengan env
 *    `META_WEBHOOK_VERIFY_TOKEN` (nilai yang KITA tentukan dan ditempel
 *    pemilik platform ke Meta App). Selain itu 403.
 * 2. Event: header `X-Hub-Signature-256` = HMAC-SHA256(raw body, App
 *    Secret Meta). Secret diselesaikan panel → env (Fase 7A.1, resolver
 *    Panel Admin 6C: panel menang, env `META_APP_SECRET` fallback, cache
 *    ±60 dtk — perubahan panel berlaku TANPA restart). App secret belum
 *    diset di mana pun → 503 META_NOT_CONFIGURED (fail-closed: tanpa
 *    secret, tidak ada payload yang bisa dipercaya); tanda tangan salah
 *    → 401 META_SIGNATURE_INVALID.
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
  /**
   * Opsi resolver Panel Admin (Fase 7A.1): bila ada, App Secret untuk
   * verifikasi tanda tangan diselesaikan per request lewat core
   * `getProviderSecret(db, "meta_app_secret", platform)` — panel → env
   * `META_APP_SECRET` → null, cache ±60 dtk per proses.
   */
  platform?: PlatformSettingsOptions;
  /**
   * Secret statis (env META_APP_SECRET) — hanya dipakai bila `platform`
   * tidak diberikan (pemanggil langsung/uji lama).
   */
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
    // Secret efektif per request (Fase 7A.1): resolver panel → env dengan
    // cache ±60 dtk — nilai panel terbaru dipakai tanpa restart; set/clear
    // dari Panel Admin di proses ini membuang cache-nya seketika.
    const appSecret = opts.platform
      ? await getProviderSecret(bundle.db, "meta_app_secret", opts.platform)
      : opts.appSecret;
    if (!appSecret) {
      return apiError(
        c,
        503,
        "META_NOT_CONFIGURED",
        "Meta app secret is not configured",
      );
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
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

    // Objek ketiga (Fase 7B): WhatsApp Business Account — bentuk
    // payload-nya berbeda total dari messaging Page/IG, jadi jalurnya
    // terpisah penuh di bawah (parser + core whatsapp.ts).
    if (isWhatsAppWebhookPayload(payload)) {
      await handleWhatsAppWebhook(bundle, publisher, payload);
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
 * Jalur WhatsApp (Fase 7B) pada webhook yang sama: payload
 * `whatsapp_business_account` sudah lolos verifikasi tanda tangan yang
 * sama di pemanggil. Resolusi akun dari `metadata.phone_number_id`
 * (BUKAN entry.id = WABA — satu WABA menaungi banyak nomor/tenant).
 * Akun tak dikenal / tidak 'connected' → event diabaikan (tetap 200).
 *
 * - Pesan masuk: teks dicatat apa adanya; non-teks dicatat dengan
 *   tipenya (caption sebagai isi) — media tidak diunduh di v1. Nama
 *   kontak datang dari payload (contacts[].profile.name).
 * - Statuses: diterapkan ke pesan keluar kita lewat core (hanya maju;
 *   failed terminal berkode) + nudge realtime bila benar-benar berubah
 *   (failed → message.failed; delivered/read → conversation.updated
 *   agar label status di utas inbox menyegar).
 */
async function handleWhatsAppWebhook(
  bundle: AuthBundle,
  publisher: RealtimePublisher | null,
  payload: unknown,
): Promise<void> {
  const parsed = parseWhatsAppWebhookEvents(payload);
  if (parsed.messages.length === 0 && parsed.statuses.length === 0) return;

  const accountCache = new Map<string, WhatsAppAccountRef | null>();
  const resolveAccount = async (
    phoneNumberId: string,
  ): Promise<WhatsAppAccountRef | null> => {
    const cached = accountCache.get(phoneNumberId);
    if (cached !== undefined) return cached;
    const account = await resolveWhatsAppAccountByPhoneNumberId(
      bundle.db,
      phoneNumberId,
    );
    accountCache.set(phoneNumberId, account);
    return account;
  };

  for (const message of parsed.messages) {
    // Pesan teks tanpa isi adalah anomali payload — lewati seperti
    // jalur Meta; non-teks tetap dicatat bertipe (linimasa jujur).
    if (message.type === "text" && (!message.text || !message.text.trim())) {
      continue;
    }
    const account = await resolveAccount(message.phoneNumberId);
    if (!account || account.status !== "connected") continue;
    const recorded = await recordWhatsAppInboundMessage(bundle.db, account, {
      senderWaId: message.senderWaId,
      contactName: message.contactName,
      providerMessageId: message.providerMessageId,
      type: message.type,
      text: message.text,
    });
    if (!recorded) continue;
    if (publisher) {
      await publisher.publishNudge({
        kind: "message.received",
        tenantId: account.tenantId,
        conversationId: recorded.message.conversationId,
      });
    }
  }

  for (const status of parsed.statuses) {
    const account = await resolveAccount(status.phoneNumberId);
    if (!account || account.status !== "connected") continue;
    const applied = await applyWhatsAppMessageStatus(bundle.db, account, {
      providerMessageId: status.providerMessageId,
      status: status.status,
      graphErrorCode: status.errorCode,
    });
    if (!applied?.applied || !publisher) continue;
    await publisher.publishNudge({
      kind: applied.status === "failed" ? "message.failed" : "conversation.updated",
      tenantId: account.tenantId,
      conversationId: applied.conversationId,
    });
  }
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
