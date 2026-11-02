import type {
  ChannelAdapter,
  SendMessageInput,
  SendMessageResult,
  StandardEvent,
  VerifyWebhookInput,
} from "@sahabat-kreator/channel-core";

/**
 * @sahabat-kreator/channel-telegram — adapter Telegram Bot API (Fase 6A).
 *
 * Telegram bukan Meta: tidak ada jendela pesan, tidak ada template, dan
 * autentikasi webhook BUKAN signature atas body melainkan header secret
 * token (`X-Telegram-Bot-Api-Secret-Token`) yang kita tentukan sendiri
 * saat setWebhook. Pembagian kerja (meniru pola webchat):
 *
 * - Paket ini memiliki KLIEN Bot API tipis (getMe / setWebhook /
 *   getWebhookInfo / deleteWebhook / sendMessage) + normalisasi update
 *   → StandardEvent (fungsi murni).
 * - Logika DB (kontak/percakapan/pesan/outbox) hidup di
 *   @sahabat-kreator/core (`telegram.ts`).
 * - Verifikasi secret webhook dilakukan route API terhadap hash yang
 *   tersimpan di baris akun (core `verifyChannelWebhookSecret`) — karena
 *   itu `verifyWebhookSignature` adapter SELALU false: jangan pernah ada
 *   jalur yang menganggap payload Telegram tepercaya hanya dari adapter.
 *
 * KEAMANAN: token bot adalah kredensial penuh dan tertanam di URL Bot
 * API (`/bot<token>/...`). URL itu TIDAK PERNAH masuk pesan error/log di
 * paket ini — `TelegramApiError` hanya membawa status HTTP + deskripsi
 * resmi Telegram (yang tidak memuat token).
 */

export const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

// ---------------------------------------------------------------------------
// Tipe subset Bot API yang dipakai (bukan skema lengkap Telegram)
// ---------------------------------------------------------------------------

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type?: string;
  /** Judul grup/supergrup (chat privat tidak punya title). */
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** Anggota chat dalam update `my_chat_member` (status bot di chat itu). */
export interface TelegramChatMember {
  user?: TelegramUser;
  status?: string;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from?: TelegramUser;
  new_chat_member?: TelegramChatMember;
  old_chat_member?: TelegramChatMember;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  /** Bot dimasukkan/dikeluarkan dari grup — BUKAN pesan; ditangani route. */
  my_chat_member?: TelegramChatMemberUpdated;
  [key: string]: unknown;
}

export interface TelegramBotIdentity {
  /** Id numerik bot (menjadi external_id akun channel). */
  id: string;
  username: string | null;
  firstName: string | null;
}

/** Subset `getWebhookInfo` yang dipakai (URL webhook aktif bot ini). */
export interface TelegramWebhookInfo {
  /** URL webhook yang sedang aktif di Telegram; string kosong = tidak ada. */
  url: string;
}

/** Error Bot API yang AMAN dicatat: tanpa token, tanpa URL. */
export class TelegramApiError extends Error {
  readonly status: number;
  readonly description: string;

  constructor(status: number, description: string) {
    super(`Telegram Bot API error (HTTP ${status}): ${description}`);
    this.name = "TelegramApiError";
    this.status = status;
    this.description = description;
  }
}

type FetchLike = typeof fetch;

export interface TelegramBotApiClientOptions {
  /** Base URL Bot API — default https://api.telegram.org (override untuk mock uji). */
  baseUrl?: string;
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Klien Bot API tipis di atas fetch. Satu instance per token bot. */
export class TelegramBotApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: TelegramBotApiClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_TELEGRAM_API_BASE).replace(
      /\/+$/,
      "",
    );
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/bot${this.token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      // Error jaringan/timeout: JANGAN teruskan error asli — pesan fetch
      // bisa memuat URL bertoken. Lempar error aman generik.
      throw new TelegramApiError(0, "network_error");
    }
    let body: { ok?: boolean; result?: T; description?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new TelegramApiError(response.status, "invalid_response");
    }
    if (!response.ok || body.ok !== true) {
      throw new TelegramApiError(
        response.status,
        typeof body.description === "string"
          ? body.description.slice(0, 200)
          : "telegram_error",
      );
    }
    return body.result as T;
  }

  /** Identitas bot pemilik token — dipakai memvalidasi token saat connect. */
  async getMe(): Promise<TelegramBotIdentity> {
    const me = await this.call<TelegramUser>("getMe", {});
    return {
      id: String(me.id),
      username: me.username ?? null,
      firstName: me.first_name ?? null,
    };
  }

  /** Daftarkan URL webhook + secret token untuk akun bot ini. */
  async setWebhook(input: {
    url: string;
    secretToken: string;
  }): Promise<void> {
    await this.call<boolean>("setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      // `my_chat_member` agar bot tahu saat dimasukkan/dikeluarkan grup
      // (Fase 6A.1) — update itu bukan pesan dan hanya dicatat audit.
      allowed_updates: ["message", "my_chat_member"],
    });
  }

  /**
   * Webhook yang SEDANG aktif untuk bot ini menurut Telegram. Dipakai
   * saat disconnect: webhook hanya boleh dicabut bila URL-nya menunjuk
   * ke akun channel yang sedang diputuskan (satu bot = satu webhook;
   * akun duplikat yang bukan pemilik tidak boleh mencabut webhook
   * pemilik sah).
   */
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    const info = await this.call<{ url?: string }>("getWebhookInfo", {});
    return { url: typeof info.url === "string" ? info.url : "" };
  }

  /** Cabut webhook bot ini di Telegram (pesan berhenti masuk). */
  async deleteWebhook(): Promise<void> {
    await this.call<boolean>("deleteWebhook", {});
  }

  /**
   * Kirim pesan teks ke chat. `chat_id` adalah alamat chat tujuan:
   * id user pada chat privat, id grup (negatif) pada grup — pemanggil
   * mengambilnya dari `conversations.provider_chat_id`, BUKAN dari
   * identitas pengirim pesan terakhir (Fase 6A.1).
   */
  async sendMessage(input: {
    chatId: string;
    text: string;
  }): Promise<{ providerMessageId: string }> {
    const result = await this.call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
    });
    return { providerMessageId: String(result.message_id) };
  }
}

// ---------------------------------------------------------------------------
// Normalisasi update → StandardEvent (fungsi murni, bisa dites)
// ---------------------------------------------------------------------------

/**
 * Menormalkan satu update Telegram menjadi StandardEvent. Hanya pesan
 * teks (`message.text`) yang menjadi `message.received`; update lain
 * (edited, channel post, my_chat_member, callback, non-teks)
 * menghasilkan array kosong agar pemanggil menjawab 200 dan
 * mengabaikannya dengan aman.
 *
 * Grup (Fase 6A.1): `chat.type` group/supergroup → conversationKind
 * "group" + conversationTitle dari `chat.title`. Perhatikan pemisahan
 * yang menjadi inti dukungan grup: `conversationExternalId` = id CHAT
 * (grup: negatif, alamat balasan), `senderExternalId` = id ANGGOTA yang
 * menulis — keduanya hanya sama pada chat privat.
 */
export function parseTelegramUpdate(payload: unknown): StandardEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const update = payload as TelegramUpdate;
  const message = update.message;
  if (!message || typeof message.text !== "string" || !message.text.trim()) {
    return [];
  }
  if (!message.from || typeof message.from.id !== "number") return [];
  if (!message.chat || typeof message.chat.id !== "number") return [];
  const sentAt =
    typeof message.date === "number"
      ? new Date(message.date * 1000).toISOString()
      : new Date().toISOString();
  const isGroup =
    message.chat.type === "group" || message.chat.type === "supergroup";
  return [
    {
      type: "message.received",
      provider: "telegram",
      providerEventId: String(update.update_id),
      message: {
        providerMessageId: String(message.message_id),
        conversationExternalId: String(message.chat.id),
        conversationKind: isGroup ? "group" : "private",
        conversationTitle: isGroup
          ? (message.chat.title ?? undefined)
          : undefined,
        senderExternalId: String(message.from.id),
        direction: "inbound",
        type: "text",
        text: message.text,
        sentAt,
      },
      raw: payload,
      receivedAt: new Date().toISOString(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Adapter channel-core
// ---------------------------------------------------------------------------

/**
 * Adapter Telegram untuk satu akun bot (satu klien = satu token).
 * `sendMessage` meneruskan ke Bot API; pengiriman produksi kita tetap
 * lewat antrean pesan `queued` + poller API (yang memakai klien yang
 * sama), adapter ini adalah pintu standar bagi pemanggil berbasis
 * channel-core.
 */
export class TelegramChannelAdapter implements ChannelAdapter {
  readonly provider = "telegram" as const;
  private readonly client: TelegramBotApiClient;

  constructor(client: TelegramBotApiClient) {
    this.client = client;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const result = await this.client.sendMessage({
      chatId: input.toExternalId,
      text: input.text,
    });
    return { providerMessageId: result.providerMessageId };
  }

  /**
   * Telegram tidak menandatangani body webhook; keaslian dibuktikan
   * header secret token terhadap hash tersimpan (route + core). Selalu
   * false agar tidak ada jalur yang melewatkan verifikasi itu.
   */
  verifyWebhookSignature(_input: VerifyWebhookInput): boolean {
    return false;
  }

  parseWebhookEvents(payload: unknown): StandardEvent[] {
    return parseTelegramUpdate(payload);
  }
}
