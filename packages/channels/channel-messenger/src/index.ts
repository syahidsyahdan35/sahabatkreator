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

  /**
   * Kirim pesan teks (Send API): `POST /{accountId}/messages` dengan
   * messaging_type RESPONSE — balasan di dalam jendela 24 jam sejak
   * pesan terakhir pengguna (kebijakan Meta; di luar jendela Graph
   * menolak dan pemanggil menandai pesan failed dengan kode Graph,
   * TANPA retry tanpa henti). `accountId` = Page ID (messenger) atau
   * ID akun IG (instagram) — endpoint yang sama, token Page yang sama.
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
          sentAt: e.timestamp
            ? new Date(e.timestamp).toISOString()
            : new Date().toISOString(),
        },
        raw: payload,
        receivedAt: new Date().toISOString(),
      }));
  }
}
