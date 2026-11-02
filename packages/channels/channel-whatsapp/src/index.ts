import type {
  ChannelAdapter,
  SendMessageInput,
  SendMessageResult,
  StandardEvent,
  VerifyWebhookInput,
} from "@sahabat-kreator/channel-core";

/**
 * @sahabat-kreator/channel-whatsapp — adapter WhatsApp Cloud API
 * (Fase 7B), menumpang rel Meta Fase 7A: Graph API v26.0 ter-pin,
 * webhook TUNGGAL platform yang sama (`whatsapp_business_account`
 * adalah objek ketiga di endpoint itu), tanda tangan app secret yang
 * sama (diverifikasi di route, bukan di sini). Logika DB (kontak/
 * percakapan/pesan/status) hidup di @sahabat-kreator/core
 * (`whatsapp.ts`), meniru pembagian kerja Messenger/Telegram.
 *
 * Perbedaan bentuk WhatsApp dari Send API Messenger/IG:
 * - Kirim: `POST /{phone_number_id}/messages` dengan
 *   `messaging_product: "whatsapp"`; id pesan hasil = `messages[0].id`
 *   (wamid) — wamid inilah yang dicocokkan webhook `statuses`.
 * - Webhook masuk membawa nama profil pengirim; status pengiriman
 *   (sent/delivered/read/failed) tiba sebagai event terpisah.
 * - Jendela layanan 24 jam: teks bebas hanya sah <24 jam sejak pesan
 *   terakhir pengguna; di luar itu Graph menolak (mis. kode 131047)
 *   dan pemanggil menandai pesan failed — template message adalah
 *   fase broadcast, BUKAN di sini.
 * - Routing kategori template (RANCANGAN §12.6) belum berlaku: v1
 *   hanya teks layanan (service conversation) lewat Cloud API.
 *
 * KEAMANAN: Access Token (System User) dikirim sebagai header
 * `Authorization: Bearer` — tidak pernah sebagai query `access_token=`
 * — dan pesan error hanya memuat status HTTP + kode/pesan resmi Graph.
 */

export const DEFAULT_META_API_BASE = "https://graph.facebook.com";
export const DEFAULT_META_GRAPH_API_VERSION = "v26.0";

/** Error Graph API yang AMAN dicatat: status HTTP + kode Graph resmi. */
export class WhatsAppGraphError extends Error {
  readonly status: number;
  /** Kode error numerik Graph (mis. 190 token tidak valid, 131047 di luar jendela 24 jam); null bila tak ada. */
  readonly graphCode: number | null;
  readonly description: string;

  constructor(status: number, graphCode: number | null, description: string) {
    super(
      `WhatsApp Graph API error (HTTP ${status}${graphCode !== null ? `, code ${graphCode}` : ""}): ${description}`,
    );
    this.name = "WhatsAppGraphError";
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

export interface WhatsAppCloudClientOptions {
  /** Base URL Graph API — default https://graph.facebook.com (override mock via env META_API_BASE). */
  baseUrl?: string;
  /** Versi Graph ter-pin — default v26.0; lapisan API meneruskan nilai config. */
  apiVersion?: string;
  /** Access Token WhatsApp (System User permanen / token sementara). */
  accessToken?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Profil nomor WhatsApp dari Graph — hasil validasi saat connect. */
export interface WhatsAppPhoneNumberProfile {
  id: string;
  /** Nama bisnis terverifikasi (verified_name). */
  verifiedName: string | null;
  /** Nomor tampil terformat (display_phone_number, mis. "+62 812-3456-7890"). */
  displayPhoneNumber: string | null;
}

/** Klien WhatsApp Cloud API tipis di atas fetch. Satu instance per token. */
export class WhatsAppCloudClient {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly accessToken: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WhatsAppCloudClientOptions = {}) {
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

  private async parseError(response: Response): Promise<WhatsAppGraphError> {
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
        : "whatsapp_graph_error";
    return new WhatsAppGraphError(response.status, graphCode, description);
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
      throw new WhatsAppGraphError(0, null, "network_error");
    }
    if (!response.ok) throw await this.parseError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new WhatsAppGraphError(response.status, null, "invalid_response");
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
      throw new WhatsAppGraphError(0, null, "network_error");
    }
    if (!response.ok) throw await this.parseError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new WhatsAppGraphError(response.status, null, "invalid_response");
    }
  }

  /**
   * Profil nomor (`GET /{phone_number_id}?fields=verified_name,display_phone_number`)
   * — memvalidasi token + mengambil nama bisnis & nomor tampil saat
   * connect. Token/nomor yang ditolak Graph melempar WhatsAppGraphError.
   */
  async getPhoneNumberProfile(
    phoneNumberId: string,
  ): Promise<WhatsAppPhoneNumberProfile> {
    const body = await this.getJson<{
      id?: string;
      verified_name?: string;
      display_phone_number?: string;
    }>(
      `${encodeURIComponent(phoneNumberId)}?fields=verified_name,display_phone_number`,
    );
    return {
      id: typeof body.id === "string" ? body.id : phoneNumberId,
      verifiedName:
        typeof body.verified_name === "string" ? body.verified_name : null,
      displayPhoneNumber:
        typeof body.display_phone_number === "string"
          ? body.display_phone_number
          : null,
    };
  }

  /**
   * Foto profil bisnis (best-effort): `GET /{phone_number_id}/whatsapp_business_profile?fields=profile_picture_url`
   * lalu unduh byte dari URL CDN-nya. Mengembalikan null pada SEMUA
   * kegagalan (profil kosong, field tak tersedia, unduhan gagal) —
   * foto TIDAK PERNAH menjadi penghalang connect; kartu Channels jatuh
   * ke inisial. Berbeda dari kontak: foto profil KONTAK WhatsApp memang
   * tidak disediakan API sama sekali (privasi), jadi tidak ada jalur
   * pengambilan foto kontak di paket ini.
   */
  async getBusinessProfilePicture(
    phoneNumberId: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const body = await this.getJson<{ profile_picture_url?: string }>(
        `${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile?fields=profile_picture_url`,
      );
      const url =
        typeof body.profile_picture_url === "string"
          ? body.profile_picture_url
          : null;
      if (!url) return null;
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0) return null;
      return {
        data,
        contentType:
          response.headers.get("content-type")?.split(";")[0]?.trim() ||
          "image/jpeg",
      };
    } catch {
      return null;
    }
  }

  /**
   * Kirim pesan teks (Cloud API): `POST /{phone_number_id}/messages`.
   * Mengembalikan wamid (`messages[0].id`) — id yang nantinya
   * dicocokkan webhook statuses untuk delivered/read/failed.
   */
  async sendTextMessage(input: {
    phoneNumberId: string;
    to: string;
    text: string;
  }): Promise<{ providerMessageId: string }> {
    const body = await this.postJson<{
      messages?: Array<{ id?: string }>;
    }>(`${encodeURIComponent(input.phoneNumberId)}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.text },
    });
    const wamid = body.messages?.[0]?.id;
    if (typeof wamid !== "string" || !wamid) {
      throw new WhatsAppGraphError(200, null, "missing_message_id");
    }
    return { providerMessageId: wamid };
  }
}

// ---------------------------------------------------------------------------
// Webhook: normalisasi payload whatsapp_business_account (fungsi murni)
// ---------------------------------------------------------------------------

/** Tipe pesan masuk ternormalisasi — sejajar enum `message_type` DB kita. */
export type WhatsAppInboundType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "other";

const WHATSAPP_TYPE_MAP: Record<string, WhatsAppInboundType> = {
  text: "text",
  image: "image",
  audio: "audio",
  video: "video",
  document: "document",
  sticker: "sticker",
};

/** Satu pesan masuk WhatsApp yang dinormalisasi. */
export interface WhatsAppInboundMessageEvent {
  /** entry.id — WABA ID induk (konteks; BUKAN kunci resolusi akun). */
  wabaId: string;
  /** value.metadata.phone_number_id — kunci resolusi akun. */
  phoneNumberId: string;
  /** wa_id pengirim. */
  senderWaId: string;
  /** Nama profil pengirim dari value.contacts[]; null bila tak disertakan. */
  contactName: string | null;
  /** wamid pesan masuk — id dedup provider. */
  providerMessageId: string;
  type: WhatsAppInboundType;
  /** Teks pesan; untuk media = caption bila ada, selain itu null. */
  text: string | null;
  timestamp: number | null;
}

/** Satu status pengiriman pesan KELUAR kita dari value.statuses[]. */
export interface WhatsAppStatusEvent {
  wabaId: string;
  phoneNumberId: string;
  /** wamid pesan keluar kita yang statusnya berubah. */
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  /** Kode error numerik Graph dari errors[0].code (status failed); null selain itu. */
  errorCode: number | null;
  timestamp: number | null;
}

export interface WhatsAppWebhookEvents {
  messages: WhatsAppInboundMessageEvent[];
  statuses: WhatsAppStatusEvent[];
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
          video?: { caption?: string };
          document?: { caption?: string; filename?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          errors?: Array<{ code?: number; title?: string }>;
        }>;
      };
    }>;
  }>;
}

/** true bila payload adalah objek webhook WhatsApp Business Account. */
export function isWhatsAppWebhookPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: unknown }).object === "whatsapp_business_account"
  );
}

/**
 * Menormalkan payload webhook WhatsApp menjadi event pesan masuk +
 * event status. Hanya `changes[].field === "messages"` yang dibaca.
 * Pesan non-teks TETAP dikembalikan dengan tipenya (caption sebagai
 * teks bila ada) — keputusan pencatatan ada di core; status yang tidak
 * dikenal dilewati. Nama kontak dicocokkan dari `value.contacts[]`
 * berdasarkan wa_id.
 */
export function parseWhatsAppWebhookEvents(
  payload: unknown,
): WhatsAppWebhookEvents {
  const result: WhatsAppWebhookEvents = { messages: [], statuses: [] };
  if (!isWhatsAppWebhookPayload(payload)) return result;
  const body = payload as WhatsAppWebhookPayload;
  for (const entry of body.entry ?? []) {
    const wabaId = typeof entry?.id === "string" ? entry.id : "";
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (typeof phoneNumberId !== "string" || !phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (
          typeof contact?.wa_id === "string" &&
          typeof contact?.profile?.name === "string" &&
          contact.profile.name.trim()
        ) {
          names.set(contact.wa_id, contact.profile.name.trim());
        }
      }

      for (const message of value.messages ?? []) {
        const from = message?.from;
        const wamid = message?.id;
        if (typeof from !== "string" || !from) continue;
        if (typeof wamid !== "string" || !wamid) continue;
        const rawType = typeof message.type === "string" ? message.type : "";
        const type = WHATSAPP_TYPE_MAP[rawType] ?? "other";
        const text =
          type === "text"
            ? typeof message.text?.body === "string"
              ? message.text.body
              : null
            : (typeof message.image?.caption === "string" &&
                message.image.caption) ||
              (typeof message.video?.caption === "string" &&
                message.video.caption) ||
              (typeof message.document?.caption === "string" &&
                message.document.caption) ||
              null;
        result.messages.push({
          wabaId,
          phoneNumberId,
          senderWaId: from,
          contactName: names.get(from) ?? null,
          providerMessageId: wamid,
          type,
          text,
          timestamp:
            typeof message.timestamp === "string"
              ? Number(message.timestamp) || null
              : null,
        });
      }

      for (const status of value.statuses ?? []) {
        const wamid = status?.id;
        const state = status?.status;
        if (typeof wamid !== "string" || !wamid) continue;
        if (
          state !== "sent" &&
          state !== "delivered" &&
          state !== "read" &&
          state !== "failed"
        ) {
          continue;
        }
        const firstError = status.errors?.[0];
        result.statuses.push({
          wabaId,
          phoneNumberId,
          providerMessageId: wamid,
          status: state,
          errorCode:
            state === "failed" && typeof firstError?.code === "number"
              ? firstError.code
              : null,
          timestamp:
            typeof status.timestamp === "string"
              ? Number(status.timestamp) || null
              : null,
        });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Adapter channel-core
// ---------------------------------------------------------------------------

/**
 * Adapter WhatsApp untuk satu akun (satu klien = satu token). account
 * pada SendMessageInput menunjuk akun channel; externalId-nya adalah
 * phone_number_id. Pengiriman produksi kita tetap lewat antrean
 * `queued` + poller API (keluarga poller Meta).
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly provider = "whatsapp" as const;
  private readonly client: WhatsAppCloudClient;

  constructor(client: WhatsAppCloudClient) {
    this.client = client;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const result = await this.client.sendTextMessage({
      phoneNumberId: input.account.externalId,
      to: input.toExternalId,
      text: input.text,
    });
    return { providerMessageId: result.providerMessageId };
  }

  /**
   * Verifikasi webhook WhatsApp memerlukan app secret PLATFORM (bukan
   * milik instance akun) — jalur produksi memverifikasi di route
   * webhook terhadap resolver panel→env (Fase 7A.1). Selalu false di
   * sini agar tidak ada jalur yang menganggap payload tepercaya tanpa
   * secret itu (pola Messenger).
   */
  verifyWebhookSignature(_input: VerifyWebhookInput): boolean {
    return false;
  }

  parseWebhookEvents(payload: unknown): StandardEvent[] {
    const parsed = parseWhatsAppWebhookEvents(payload);
    const events: StandardEvent[] = parsed.messages.map((m) => ({
      type: "message.received" as const,
      provider: "whatsapp" as const,
      providerEventId: m.providerMessageId,
      message: {
        providerMessageId: m.providerMessageId,
        conversationExternalId: m.senderWaId,
        conversationKind: "private" as const,
        senderExternalId: m.senderWaId,
        direction: "inbound" as const,
        // StandardMessageType channel-core tidak punya 'sticker'/'other'
        // — keduanya jatuh ke 'unknown' di permukaan adapter ini (core
        // DB tetap mencatat tipe persisnya lewat parser webhook).
        type:
          m.type === "text" ||
          m.type === "image" ||
          m.type === "audio" ||
          m.type === "video" ||
          m.type === "document"
            ? m.type
            : ("unknown" as const),
        text: m.text ?? undefined,
        sentAt: m.timestamp
          ? new Date(m.timestamp * 1000).toISOString()
          : new Date().toISOString(),
      },
      raw: payload,
      receivedAt: new Date().toISOString(),
    }));
    for (const s of parsed.statuses) {
      events.push({
        type: "message.status" as const,
        provider: "whatsapp" as const,
        providerEventId: s.providerMessageId,
        raw: payload,
        receivedAt: new Date().toISOString(),
      });
    }
    return events;
  }
}
