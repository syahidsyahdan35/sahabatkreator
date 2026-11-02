import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelAdapter,
  SendMessageInput,
  SendMessageResult,
  StandardEvent,
  VerifyWebhookInput,
} from "@sahabat-kreator/channel-core";

/**
 * @sahabat-kreator/channel-messenger — adapter Meta (Fase 7A).
 *
 * Paket ini memiliki KLIEN Graph API bersama untuk KEDUA channel Meta
 * kita (Messenger & Instagram): Instagram Messaging lewat Facebook Login
 * berjalan di atas Page yang sama dan Send API yang sama (endpoint
 * `/{account-id}/messages`), jadi satu klien tipis melayani keduanya —
 * perbedaan provider hanya di segmen id akun & objek webhook. Logika DB
 * (kontak/percakapan/pesan/outbox) hidup di @sahabat-kreator/core
 * (`meta.ts`), meniru pembagian kerja Telegram.
 *
 * Versi Graph API TER-PIN v26.0 (RANCANGAN §12.1) — tidak ada panggilan
 * unversioned: versi selalu segmen path pertama sesudah base URL. Nilai
 * pin sumber kebenarannya di @sahabat-kreator/config
 * (`META_GRAPH_API_VERSION`); konstanta di sini adalah default klien dan
 * lapisan API meneruskan nilai config secara eksplisit.
 *
 * KEAMANAN: Page Access Token adalah kredensial penuh. Ia dikirim
 * sebagai header `Authorization: Bearer` — TIDAK PERNAH sebagai query
 * `access_token=` — agar tidak bocor ke log proxy/CDN; pesan error di
 * paket ini juga tidak memuat URL/headers, hanya status HTTP + kode &
 * pesan resmi Graph (yang tidak memuat token).
 */

export const DEFAULT_META_API_BASE = "https://graph.facebook.com";
export const DEFAULT_META_GRAPH_API_VERSION = "v26.0";

/** Error Graph API yang AMAN dicatat: status HTTP + kode Graph resmi. */
export class MetaGraphError extends Error {
  readonly status: number;
  /** Kode error numerik Graph (mis. 190 token tidak valid, 551 jendela pesan); null bila tak ada. */
  readonly graphCode: number | null;
  readonly description: string;

  constructor(status: number, graphCode: number | null, description: string) {
    super(
      `Meta Graph API error (HTTP ${status}${graphCode !== null ? `, code ${graphCode}` : ""}): ${description}`,
    );
    this.name = "MetaGraphError";
    this.status = status;
    this.graphCode = graphCode;
    this.description = description;
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

type FetchLike = typeof fetch;

export interface MetaGraphClientOptions {
  /** Base URL Graph API — default https://graph.facebook.com (override untuk mock uji via env META_API_BASE). */
  baseUrl?: string;
  /** Versi Graph ter-pin — default v26.0; lapisan API meneruskan nilai config. */
  apiVersion?: string;
  /** Page Access Token. */
  accessToken?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Profil objek Graph yang dipakai connect (Page / akun IG). */
export interface MetaObjectProfile {
  id: string;
  name: string | null;
  username: string | null;
}

/** Hasil exchange OAuth (Fase 7D): token + sisa umur bila Graph melaporkannya. */
export interface MetaOAuthTokenResult {
  accessToken: string;
  expiresInSeconds: number | null;
}

/** Satu Page dari /me/accounts beserta Page Access Token turunannya (Fase 7D). */
export interface MetaManagedPage {
  id: string;
  name: string | null;
  username: string | null;
  accessToken: string;
  /** Akun IG Professional terhubung ke Page ini — info pemilih saja. */
  linkedIg: { id: string; username: string | null } | null;
}

/** Satu nomor telepon di bawah WABA (Fase 7D, penemuan Embedded Signup). */
export interface MetaWabaPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

/** Klien Graph API tipis di atas fetch. Satu instance per token. */
export class MetaGraphClient {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly accessToken: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: MetaGraphClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_META_API_BASE).replace(/\/+$/, "");
    this.apiVersion = options.apiVersion ?? DEFAULT_META_GRAPH_API_VERSION;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private headers(): Record<string, string> {
    return this.accessToken
      ? { authorization: `Bearer ${this.accessToken}` }
      : {};
  }

  private async parseError(response: Response): Promise<MetaGraphError> {
    let body: GraphErrorBody = {};
    try {
      body = (await response.json()) as GraphErrorBody;
    } catch {
      /* body bukan JSON — error generik di bawah */
    }
    const graphCode =
      typeof body.error?.code === "number" ? body.error.code : null;
    const description =
      typeof body.error?.message === "string"
        ? body.error.message.slice(0, 200)
        : "meta_graph_error";
    return new MetaGraphError(response.status, graphCode, description);
  }

  private async getJson<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${this.apiVersion}/${path}`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Error jaringan/timeout: jangan teruskan objek asli.
      throw new MetaGraphError(0, null, "network_error");
    }
    if (!response.ok) throw await this.parseError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new MetaGraphError(response.status, null, "invalid_response");
    }
  }

  /** GET dengan parameter query ter-encode (untuk endpoint OAuth & penemuan aset Fase 7D). */
  private async getJsonParams<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    return this.getJson<T>(query ? `${path}?${query}` : path);
  }

  private async postJson<T>(path: string, payload: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${this.apiVersion}/${path}`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new MetaGraphError(0, null, "network_error");
    }
    if (!response.ok) throw await this.parseError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new MetaGraphError(response.status, null, "invalid_response");
    }
  }

  /**
   * Profil sebuah objek Graph (`GET /{id}?fields=name,username`) —
   * memvalidasi token + mengambil nama/handle publik saat connect.
   * Token yang ditolak Graph (HTTP 4xx berkode) melempar MetaGraphError.
   */
  async getObjectProfile(id: string): Promise<MetaObjectProfile> {
    const body = await this.getJson<{
      id?: string;
      name?: string;
      username?: string;
    }>(`${encodeURIComponent(id)}?fields=name,username`);
    return {
      id: typeof body.id === "string" ? body.id : id,
      name: typeof body.name === "string" ? body.name : null,
      username: typeof body.username === "string" ? body.username : null,
    };
  }

  /**
   * Foto profil Page/akun IG (`GET /{id}/picture?type=large`): Graph
   * menjawab redirect ke CDN atau langsung byte gambar. Mengembalikan
   * byte + content-type, atau null bila tidak ada gambar (404). Catatan
   * jujur: untuk Page yang belum memasang foto, Graph bisa mengembalikan
   * gambar siluet bawaan Meta — dari sisi API itu tak terbedakan dari
   * foto asli.
   */
  async getAccountPicture(
    id: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/${this.apiVersion}/${encodeURIComponent(id)}/picture?type=large`,
        {
          method: "GET",
          headers: this.headers(),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new MetaGraphError(0, null, "network_error");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw await this.parseError(response);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0) return null;
    return {
      data,
      contentType:
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        "image/jpeg",
    };
  }

  // -------------------------------------------------------------------------
  // OAuth & penemuan aset (Fase 7D) — "Lanjutkan dengan Facebook".
  // Bentuk panggilan mengikuti dokumentasi resmi Meta yang terverifikasi:
  // - "Manually Build a Login Flow" + "Get Long-Lived Tokens" (Messenger):
  //   code → user token → fb_exchange_token → long-lived → /me/accounts.
  // - Instagram API with Unified Login (get-started + authentication):
  //   exchange TANPA redirect_uri (persis contoh dokumennya) menghasilkan
  //   Business Integration System User Access Token (SUAT); aset dari
  //   /me/assigned_instagram_accounts; konteks portfolio dari
  //   /me?fields=client_business_id.
  // - WhatsApp Embedded Signup (advanced implementation): exchange yang
  //   sama menghasilkan token bisnis; WABA ter-assign ditemukan dari
  //   token, nomor-nomornya dari tepi phone_numbers WABA.
  // client_secret memang parameter query pada endpoint oauth/access_token
  // (pola resmi Meta); ia tidak pernah masuk log/error paket ini.
  // -------------------------------------------------------------------------

  /**
   * Tukar authorization `code` → access token:
   * `GET /oauth/access_token?client_id&client_secret&code[&redirect_uri]`.
   * `redirectUri` hanya untuk alur klasik (Messenger); alur berbasis
   * konfigurasi (Unified Login IG & Embedded Signup WA) menukarnya TANPA
   * redirect_uri, persis contoh dokumentasi Unified Login.
   */
  async exchangeOAuthCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri?: string;
  }): Promise<MetaOAuthTokenResult> {
    const params: Record<string, string> = {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
    };
    if (input.redirectUri) params.redirect_uri = input.redirectUri;
    const body = await this.getJsonParams<{
      access_token?: string;
      expires_in?: number;
    }>("oauth/access_token", params);
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new MetaGraphError(200, null, "missing_access_token");
    }
    return {
      accessToken: body.access_token,
      expiresInSeconds:
        typeof body.expires_in === "number" ? body.expires_in : null,
    };
  }

  /**
   * Tukar user token berumur pendek → long-lived (±60 hari):
   * `GET /oauth/access_token?grant_type=fb_exchange_token&...`.
   * Page Access Token yang diturunkan dari token long-lived ini ikut
   * berumur panjang — dasar connect Messenger Fase 7D.
   */
  async exchangeLongLivedToken(input: {
    clientId: string;
    clientSecret: string;
    shortLivedToken: string;
  }): Promise<MetaOAuthTokenResult> {
    const body = await this.getJsonParams<{
      access_token?: string;
      expires_in?: number;
    }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      fb_exchange_token: input.shortLivedToken,
    });
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new MetaGraphError(200, null, "missing_access_token");
    }
    return {
      accessToken: body.access_token,
      expiresInSeconds:
        typeof body.expires_in === "number" ? body.expires_in : null,
    };
  }

  /**
   * Page yang dikelola pemilik token user (`GET /me/accounts`) — setiap
   * entri membawa Page Access Token turunannya sendiri + akun IG
   * Professional yang terhubung (info pemilih saja). Klien ini harus
   * dibangun dengan user token (long-lived) sebagai accessToken.
   */
  async getManagedPages(): Promise<MetaManagedPage[]> {
    const body = await this.getJsonParams<{
      data?: Array<{
        id?: string;
        name?: string;
        username?: string;
        access_token?: string;
        instagram_business_account?: { id?: string; username?: string };
      }>;
    }>("me/accounts", {
      fields: "id,name,username,access_token,instagram_business_account{id,username}",
      limit: "100",
    });
    const pages: MetaManagedPage[] = [];
    for (const row of body.data ?? []) {
      if (typeof row.id !== "string" || !row.id) continue;
      if (typeof row.access_token !== "string" || !row.access_token) continue;
      pages.push({
        id: row.id,
        name: typeof row.name === "string" ? row.name : null,
        username: typeof row.username === "string" ? row.username : null,
        accessToken: row.access_token,
        linkedIg:
          typeof row.instagram_business_account?.id === "string"
            ? {
                id: row.instagram_business_account.id,
                username:
                  typeof row.instagram_business_account.username === "string"
                    ? row.instagram_business_account.username
                    : null,
              }
            : null,
      });
    }
    return pages;
  }

  /**
   * Akun IG yang dibagikan klien ke aplikasi (`GET
   * /me/assigned_instagram_accounts?fields=id,username`) — klien dibangun
   * dengan SUAT Unified Login. Satu SUAT bisa mencakup banyak akun.
   */
  async getAssignedInstagramAccounts(): Promise<
    Array<{ id: string; username: string | null }>
  > {
    const body = await this.getJsonParams<{
      data?: Array<{ id?: string; username?: string }>;
    }>("me/assigned_instagram_accounts", { fields: "id,username", limit: "100" });
    const accounts: Array<{ id: string; username: string | null }> = [];
    for (const row of body.data ?? []) {
      if (typeof row.id !== "string" || !row.id) continue;
      accounts.push({
        id: row.id,
        username: typeof row.username === "string" ? row.username : null,
      });
    }
    return accounts;
  }

  /**
   * ID portfolio bisnis klien pemilik token BISU (`GET
   * /me?fields=client_business_id`) — disimpan sebagai konteks induk
   * akun IG (parent_external_id) untuk manajemen token kelak.
   */
  async getClientBusinessId(): Promise<string | null> {
    const body = await this.getJsonParams<{ client_business_id?: string }>(
      "me",
      { fields: "client_business_id" },
    );
    return typeof body.client_business_id === "string"
      ? body.client_business_id
      : null;
  }

  /**
   * WABA yang ter-assign ke pemilik token bisnis Embedded Signup
   * (`GET /me/assigned_whatsapp_business_accounts?fields=id,name`) —
   * pola tepi `assigned_*` yang sama seperti assigned_instagram_accounts
   * pada Unified Login (dokumen advanced implementation "Get WABA IDs
   * and Phone Numbers").
   */
  async getAssignedWhatsAppBusinessAccounts(): Promise<
    Array<{ id: string; name: string | null }>
  > {
    const body = await this.getJsonParams<{
      data?: Array<{ id?: string; name?: string }>;
    }>("me/assigned_whatsapp_business_accounts", {
      fields: "id,name",
      limit: "100",
    });
    const wabas: Array<{ id: string; name: string | null }> = [];
    for (const row of body.data ?? []) {
      if (typeof row.id !== "string" || !row.id) continue;
      wabas.push({
        id: row.id,
        name: typeof row.name === "string" ? row.name : null,
      });
    }
    return wabas;
  }

  /**
   * Nomor telepon di bawah satu WABA (`GET /{waba-id}/phone_numbers`)
   * — field yang sama seperti profil nomor pada connect manual 7B.
   */
  async getWabaPhoneNumbers(
    wabaId: string,
  ): Promise<MetaWabaPhoneNumber[]> {
    const body = await this.getJsonParams<{
      data?: Array<{
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
      }>;
    }>(`${encodeURIComponent(wabaId)}/phone_numbers`, {
      fields: "id,display_phone_number,verified_name",
      limit: "100",
    });
    const numbers: MetaWabaPhoneNumber[] = [];
    for (const row of body.data ?? []) {
      if (typeof row.id !== "string" || !row.id) continue;
      numbers.push({
        id: row.id,
        displayPhoneNumber:
          typeof row.display_phone_number === "string"
            ? row.display_phone_number
            : null,
        verifiedName:
          typeof row.verified_name === "string" ? row.verified_name : null,
      });
    }
    return numbers;
  }

  /**
   * Subscribe aplikasi ke webhook sebuah objek (`POST
   * /{object-id}/subscribed_apps`) — dipakai Page (Messenger), akun IG
   * (Unified Login: "subscribe each of their Instagram accounts"), dan
   * WABA (Embedded Signup webhook-subscription). Kegagalan melempar
   * MetaGraphError; pemanggil (complete OAuth) mengubahnya menjadi
   * peringatan, bukan menggagalkan koneksi.
   */
  async subscribeAppToObject(
    objectId: string,
    subscribedFields?: string[],
  ): Promise<void> {
    const path = subscribedFields?.length
      ? `${encodeURIComponent(objectId)}/subscribed_apps?subscribed_fields=${encodeURIComponent(subscribedFields.join(","))}`
      : `${encodeURIComponent(objectId)}/subscribed_apps`;
    await this.postJson(path, {});
  }

  /**
   * Kirim pesan teks (Send API): `POST /{accountId}/messages` dengan
   * messaging_type RESPONSE — balasan di dalam jendela 24 jam sejak
   * pesan terakhir pengguna (kebijakan Meta; di luar jendela Graph
   * menolak dan pemanggil menandai pesan failed dengan kode Graph,
   * TANPA retry tanpa henti). `accountId` = Page ID (messenger) atau
   * ID akun IG (instagram) — endpoint yang sama, token Page yang sama.
   *
   * KUTIPAN KELUAR (Fase 7B.5) — KETERBATASAN TERDOKUMENTASI: referensi
   * resmi Send API untuk objek `message` hanya mendokumentasikan
   * `text`, `attachment`, `quick_replies`, dan `metadata` — TIDAK ada
   * parameter balasan-terkutip untuk pengiriman Page/IG; `reply_to`
   * hanya ada di payload WEBHOOK (arah masuk, diparse di bawah).
   * Karena itu metode ini SENGAJA tidak menerima parameter kutipan:
   * tautan kutipan tetap tersimpan di baris pesan kita dan tampil
   * sebagai blok kutipan di inbox, tetapi balasan terkirim ke pengguna
   * Messenger/IG sebagai pesan biasa tanpa kutipan native. Jangan
   * menambahkan field tak terdokumentasi ke body ini — risikonya
   * penolakan Graph pada pesan yang seharusnya terkirim polos.
   */
  async sendMessage(input: {
    accountExternalId: string;
    recipientExternalId: string;
    text: string;
  }): Promise<{ providerMessageId: string }> {
    const body = await this.postJson<{ message_id?: string }>(
      `${encodeURIComponent(input.accountExternalId)}/messages`,
      {
        recipient: { id: input.recipientExternalId },
        messaging_type: "RESPONSE",
        message: { text: input.text },
      },
    );
    if (typeof body.message_id !== "string" || !body.message_id) {
      throw new MetaGraphError(200, null, "missing_message_id");
    }
    return { providerMessageId: body.message_id };
  }
}

// ---------------------------------------------------------------------------
// Webhook: verifikasi tanda tangan + normalisasi payload (fungsi murni)
// ---------------------------------------------------------------------------

/**
 * Verifikasi `X-Hub-Signature-256`: HMAC-SHA256 atas RAW BODY dengan app
 * secret, format header `sha256=<hex>`. Perbandingan aman-timing.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const presented = Buffer.from(signatureHeader, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (presented.length !== wanted.length) return false;
  return timingSafeEqual(presented, wanted);
}

/** Satu event messaging yang dinormalisasi dari payload webhook Meta. */
export interface MetaMessagingEvent {
  /** Objek webhook: 'page' → messenger, 'instagram' → instagram. */
  objectKind: "page" | "instagram";
  /** entry.id: Page ID (page) / ID akun IG (instagram) — penerima pesan. */
  entryExternalId: string;
  /** PSID/IGSID pengirim. */
  senderExternalId: string;
  /** message.mid — id dedup provider. */
  providerMessageId: string;
  /**
   * Mid pesan yang dikutip pesan ini (`message.reply_to.mid`, Fase
   * 7B.5); null bila pesan bukan balasan terkutip. Webhook Meta memang
   * menyertakan field ini saat pengguna membalas pesan tertentu —
   * arah MASUK didukung penuh, berbeda dari arah keluar (lihat catatan
   * keterbatasan pada MetaGraphClient.sendMessage).
   */
  replyToProviderMessageId: string | null;
  /** Teks pesan; null untuk event non-teks (lampiran/stiker/like). */
  text: string | null;
  /** Pantulan pesan yang KITA kirim (message.is_echo) — pemanggil melewatinya. */
  isEcho: boolean;
  timestamp: number | null;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        reply_to?: { mid?: string };
      };
      timestamp?: number;
    }>;
  }>;
}

/**
 * Menormalkan payload webhook Meta menjadi daftar event messaging.
 * Hanya entri `messaging` berisi `message` yang diambil (delivery/read
 * receipts & postback dilewati — v1 tidak memakainya). Event non-teks
 * tetap dikembalikan dengan text null agar pemanggil bisa memutuskan;
 * echo ditandai apa adanya (pemanggil melewatinya agar pantulan kiriman
 * sendiri tidak menjadi pesan masuk ganda).
 */
export function parseMetaWebhookEvents(payload: unknown): MetaMessagingEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const body = payload as MetaWebhookPayload;
  if (body.object !== "page" && body.object !== "instagram") return [];
  const objectKind = body.object;
  const events: MetaMessagingEvent[] = [];
  for (const entry of body.entry ?? []) {
    if (typeof entry?.id !== "string" || !entry.id) continue;
    for (const item of entry.messaging ?? []) {
      const senderId = item?.sender?.id;
      const message = item?.message;
      if (typeof senderId !== "string" || !senderId || !message) continue;
      if (typeof message.mid !== "string" || !message.mid) continue;
      events.push({
        objectKind,
        entryExternalId: entry.id,
        senderExternalId: senderId,
        providerMessageId: message.mid,
        replyToProviderMessageId:
          typeof message.reply_to?.mid === "string" && message.reply_to.mid
            ? message.reply_to.mid
            : null,
        text: typeof message.text === "string" ? message.text : null,
        isEcho: message.is_echo === true,
        timestamp:
          typeof item.timestamp === "number" ? item.timestamp : null,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Adapter channel-core
// ---------------------------------------------------------------------------

/**
 * Adapter Meta untuk satu akun (satu klien = satu token Page). Dipakai
 * provider 'messenger'; untuk 'instagram' lapisan API memakai klien
 * yang sama dengan accountExternalId akun IG (lihat core/meta.ts).
 * Pengiriman produksi kita tetap lewat antrean `queued` + poller API.
 */
export class MessengerChannelAdapter implements ChannelAdapter {
  readonly provider = "messenger" as const;
  private readonly client: MetaGraphClient;

  constructor(client: MetaGraphClient) {
    this.client = client;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const result = await this.client.sendMessage({
      accountExternalId: input.account.externalId,
      recipientExternalId: input.toExternalId,
      text: input.text,
    });
    return { providerMessageId: result.providerMessageId };
  }

  /**
   * Verifikasi adapter memerlukan app secret platform (bukan milik
   * instance akun) — jalur produksi memverifikasi di route webhook
   * terhadap env platform. Selalu false di sini agar tidak ada jalur
   * yang menganggap payload tepercaya tanpa secret itu (pola Telegram).
   */
  verifyWebhookSignature(_input: VerifyWebhookInput): boolean {
    return false;
  }

  parseWebhookEvents(payload: unknown): StandardEvent[] {
    return parseMetaWebhookEvents(payload)
      .filter((e) => e.objectKind === "page" && !e.isEcho && e.text)
      .map((e) => ({
        type: "message.received" as const,
        provider: "messenger" as const,
        providerEventId: e.providerMessageId,
        message: {
          providerMessageId: e.providerMessageId,
          conversationExternalId: e.senderExternalId,
          conversationKind: "private" as const,
          senderExternalId: e.senderExternalId,
          direction: "inbound" as const,
          type: "text" as const,
          text: e.text as string,
          replyToProviderMessageId: e.replyToProviderMessageId ?? undefined,
          sentAt: e.timestamp
            ? new Date(e.timestamp).toISOString()
            : new Date().toISOString(),
        },
        raw: payload,
        receivedAt: new Date().toISOString(),
      }));
  }
}
