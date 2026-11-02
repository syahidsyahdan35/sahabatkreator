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
  /** Subkode error Graph (mis. 36003 untuk kegagalan exchange OAuth); null bila tak ada. */
  readonly graphSubcode: number | null;
  readonly description: string;

  constructor(
    status: number,
    graphCode: number | null,
    description: string,
    graphSubcode: number | null = null,
  ) {
    super(
      `Meta Graph API error (HTTP ${status}${graphCode !== null ? `, code ${graphCode}` : ""}): ${description}`,
    );
    this.name = "MetaGraphError";
    this.status = status;
    this.graphCode = graphCode;
    this.graphSubcode = graphSubcode;
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

/**
 * Satu baris jejak penemuan aset (Fase 7D.3): tiap edge Graph yang
 * dicoba rantai penemuan meninggalkan label + jumlah hasil mentahnya,
 * atau kelas error AMAN bila edge gagal (`graph_<kode>` /
 * `http_<status>` / `network` / `unknown` — pesan resmi Graph dan
 * token tidak pernah masuk jejak). Lapisan route menulis seluruh jejak
 * sebagai satu baris log `[meta-oauth] discovery ...` agar kegagalan
 * penemuan live terdiagnosis per edge dari log saja.
 */
export interface MetaDiscoveryTraceEntry {
  label: string;
  count: number;
  error: string | null;
}

/** Kelas error aman untuk jejak penemuan (lihat MetaDiscoveryTraceEntry). */
function discoveryErrorClass(err: unknown): string {
  if (err instanceof MetaGraphError) {
    if (err.status === 0) return "network";
    return err.graphCode !== null ? `graph_${err.graphCode}` : `http_${err.status}`;
  }
  return "unknown";
}

/**
 * Kandidat akun IG hasil rantai penemuan (Fase 7D.3). Kandidat yang
 * ditemukan LEWAT sebuah Page (tepi accounts/per-Page) membawa Page
 * Access Token Page itu — saat complete, token itulah yang disimpan
 * (semantik yang sama seperti connect manual IG via Page 7A); kandidat
 * dari tepi lain memakai token alur (SUAT Unified Login).
 */
export interface MetaInstagramCandidate {
  id: string;
  username: string | null;
  pageAccessToken: string | null;
}

/** Kandidat Page dari rantai daftar Page (token bisa belum terisi). */
export interface MetaPageCandidate {
  id: string;
  name: string | null;
  username: string | null;
  accessToken: string | null;
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
    const graphSubcode =
      typeof body.error?.error_subcode === "number"
        ? body.error.error_subcode
        : null;
    const description =
      typeof body.error?.message === "string"
        ? body.error.message.slice(0, 200)
        : "meta_graph_error";
    return new MetaGraphError(
      response.status,
      graphCode,
      description,
      graphSubcode,
    );
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
   * Profil ringkas akun IG (`GET /{ig-id}?fields=id,username`) — bentuk
   * validasi connect manual Instagram varian System User Token (Fase
   * 7D.3): SUAT memvalidasi akun IG-nya langsung, tanpa perantara Page,
   * jadi field yang diminta persis id + username (username menjadi
   * handle publik akun). Token yang ditolak Graph melempar
   * MetaGraphError seperti getObjectProfile.
   */
  async getInstagramAccountProfile(
    id: string,
  ): Promise<{ id: string; username: string | null }> {
    const body = await this.getJson<{
      id?: string;
      username?: string;
    }>(`${encodeURIComponent(id)}?fields=id,username`);
    return {
      id: typeof body.id === "string" ? body.id : id,
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
  //   exchange DENGAN redirect_uri yang identik dengan dialog (Hotfix
  //   7D.2 — asumsi awal "tanpa redirect_uri" gugur oleh bukti live:
  //   Graph menolak code dengan error 100 bila redirect_uri absen)
  //   menghasilkan Business Integration System User Access Token (SUAT);
  //   aset dari RANTAI penemuan multi-tepi (Fase 7D.3:
  //   discoverInstagramAccounts — assigned + IG-di-Page + IG-portofolio
  //   + per-Page; konteks portfolio dari probe /me?fields=
  //   client_business_id). Satu tepi saja terbukti tidak cukup: dialog
  //   tampaknya menyerahkan Page sebagai aset dan IG menumpang padanya,
  //   dan akun aset portofolio tanpa Page hanya terlihat dari tepi
  //   businesses.
  // - WhatsApp Embedded Signup (advanced implementation): exchange yang
  //   sama menghasilkan token bisnis; WABA ter-assign ditemukan dari
  //   token, nomor-nomornya dari tepi phone_numbers WABA.
  // client_secret memang parameter query pada endpoint oauth/access_token
  // (pola resmi Meta); ia tidak pernah masuk log/error paket ini.
  // -------------------------------------------------------------------------

  /**
   * Tukar authorization `code` → access token:
   * `GET /oauth/access_token?client_id&client_secret&code[&redirect_uri]`.
   * `redirectUri` WAJIB disertakan bila dialog yang menerbitkan code
   * dibangun dengan `redirect_uri` — dan dialog ketiga provider kita
   * memang dibangun begitu (Hotfix 7D.2: asumsi awal bahwa alur
   * berbasis konfigurasi menukarnya TANPA redirect_uri GUGUR oleh bukti
   * live — Graph menolak dengan error 100 "Error validating
   * verification code"). Ketiga cabang routes OAuth kini selalu
   * meneruskan redirectUri callback yang identik.
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
   * Probe profil token (`GET /me?fields=id,client_business_id`) —
   * Fase 7D.3: `client_business_id` yang terisi menandai token System
   * User (Business Integration System User dari Unified Login / SUAT
   * eksplisit); token user klasik tidak memilikinya. Lapisan route
   * memakainya untuk pesan kegagalan penemuan yang spesifik. Melempar
   * MetaGraphError pada penolakan Graph — pemanggil memperlakukannya
   * best-effort.
   */
  async getTokenProfile(): Promise<{
    id: string | null;
    clientBusinessId: string | null;
  }> {
    const body = await this.getJsonParams<{
      id?: string;
      client_business_id?: string;
    }>("me", { fields: "id,client_business_id" });
    return {
      id: typeof body.id === "string" ? body.id : null,
      clientBusinessId:
        typeof body.client_business_id === "string"
          ? body.client_business_id
          : null,
    };
  }

  /**
   * ID portfolio bisnis klien pemilik token (`GET
   * /me?fields=client_business_id`) — disimpan sebagai konteks induk
   * akun IG (parent_external_id) untuk manajemen token kelak.
   */
  async getClientBusinessId(): Promise<string | null> {
    return (await this.getTokenProfile()).clientBusinessId;
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
   * Rantai daftar Page terkelola (Fase 7D.3) — dipakai penemuan
   * Messenger DAN tepi per-Page penemuan Instagram:
   *   1. `GET /me/accounts?fields=id,name,username,access_token,
   *      instagram_business_account{id,username}` (Page + tokennya)
   *   2. `GET /me/assigned_pages?fields=id,name` (Page ter-assign yang
   *      tidak muncul di /me/accounts untuk token bisnis)
   *   3. `GET /me/businesses?fields=id,name,owned_pages{id,name},
   *      client_pages{id,name}` (Page milik/terhubung portofolio)
   * Dedupe by Page ID — kemunculan pertama menang, jadi hasil
   * /me/accounts untuk token user klasik TIDAK berubah (rantai hanya
   * MENAMBAH Page yang belum terlihat). Page tanpa token diisi
   * best-effort lewat `GET /{page-id}?fields=...,access_token,...`
   * (respons yang sama sekaligus mengisi username & akun IG tertaut).
   * Setiap tepi dicatat ke `trace` bila diberikan; kegagalan satu tepi
   * tidak menggagalkan tepi lain. Mengembalikan SEMUA kandidat
   * (termasuk yang tokennya tetap kosong — pemanggil memutuskan).
   */
  async listPageCandidates(
    trace?: MetaDiscoveryTraceEntry[],
  ): Promise<MetaPageCandidate[]> {
    const byId = new Map<string, MetaPageCandidate>();
    const addPage = (page: MetaPageCandidate) => {
      const existing = byId.get(page.id);
      if (!existing) {
        byId.set(page.id, page);
        return;
      }
      // Kemunculan pertama menang untuk identitas; field yang masih
      // kosong boleh diisi kemunculan berikutnya.
      if (!existing.accessToken && page.accessToken) {
        existing.accessToken = page.accessToken;
      }
      if (!existing.username && page.username) existing.username = page.username;
      if (!existing.name && page.name) existing.name = page.name;
      if (!existing.linkedIg && page.linkedIg) existing.linkedIg = page.linkedIg;
    };
    const note = (
      label: string,
      count: number,
      error: string | null,
    ): void => {
      trace?.push({ label, count, error });
    };

    // Tepi 1 — /me/accounts (Page yang dikelola langsung + tokennya).
    try {
      const body = await this.getJsonParams<{
        data?: Array<{
          id?: string;
          name?: string;
          username?: string;
          access_token?: string;
          instagram_business_account?: { id?: string; username?: string };
        }>;
      }>("me/accounts", {
        fields:
          "id,name,username,access_token,instagram_business_account{id,username}",
        limit: "100",
      });
      let count = 0;
      for (const row of body.data ?? []) {
        if (typeof row.id !== "string" || !row.id) continue;
        count += 1;
        addPage({
          id: row.id,
          name: typeof row.name === "string" ? row.name : null,
          username: typeof row.username === "string" ? row.username : null,
          accessToken:
            typeof row.access_token === "string" && row.access_token
              ? row.access_token
              : null,
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
      note("pages_accounts", count, null);
    } catch (err) {
      note("pages_accounts", 0, discoveryErrorClass(err));
    }

    // Tepi 2 — /me/assigned_pages (tanpa token; diisi di langkah isi).
    try {
      const body = await this.getJsonParams<{
        data?: Array<{ id?: string; name?: string }>;
      }>("me/assigned_pages", { fields: "id,name", limit: "100" });
      let count = 0;
      for (const row of body.data ?? []) {
        if (typeof row.id !== "string" || !row.id) continue;
        count += 1;
        addPage({
          id: row.id,
          name: typeof row.name === "string" ? row.name : null,
          username: null,
          accessToken: null,
          linkedIg: null,
        });
      }
      note("pages_assigned_pages", count, null);
    } catch (err) {
      note("pages_assigned_pages", 0, discoveryErrorClass(err));
    }

    // Tepi 3 — Page dari portofolio bisnis yang terlihat token.
    try {
      const body = await this.getJsonParams<{
        data?: Array<{
          owned_pages?: { data?: Array<{ id?: string; name?: string }> };
          client_pages?: { data?: Array<{ id?: string; name?: string }> };
        }>;
      }>("me/businesses", {
        fields: "id,name,owned_pages{id,name},client_pages{id,name}",
        limit: "100",
      });
      let count = 0;
      for (const business of body.data ?? []) {
        for (const group of [business.owned_pages, business.client_pages]) {
          for (const row of group?.data ?? []) {
            if (typeof row.id !== "string" || !row.id) continue;
            count += 1;
            addPage({
              id: row.id,
              name: typeof row.name === "string" ? row.name : null,
              username: null,
              accessToken: null,
              linkedIg: null,
            });
          }
        }
      }
      note("pages_businesses", count, null);
    } catch (err) {
      note("pages_businesses", 0, discoveryErrorClass(err));
    }

    // Isi token Page yang masih kosong (best-effort per Page) — respons
    // tepi objek Page sekaligus membawa username + akun IG tertaut.
    let filled = 0;
    for (const page of byId.values()) {
      if (page.accessToken) continue;
      if (filled >= 25) break;
      try {
        const body = await this.getJson<{
          name?: string;
          username?: string;
          access_token?: string;
          instagram_business_account?: { id?: string; username?: string };
        }>(
          `${encodeURIComponent(page.id)}?fields=id,name,username,access_token,instagram_business_account{id,username}`,
        );
        if (typeof body.access_token === "string" && body.access_token) {
          page.accessToken = body.access_token;
          filled += 1;
        }
        if (!page.name && typeof body.name === "string") page.name = body.name;
        if (!page.username && typeof body.username === "string") {
          page.username = body.username;
        }
        if (
          !page.linkedIg &&
          typeof body.instagram_business_account?.id === "string"
        ) {
          page.linkedIg = {
            id: body.instagram_business_account.id,
            username:
              typeof body.instagram_business_account.username === "string"
                ? body.instagram_business_account.username
                : null,
          };
        }
      } catch {
        /* best-effort — Page ini tetap kandidat tanpa token */
      }
    }
    note("pages_backfill", filled, null);

    return [...byId.values()];
  }

  /**
   * Page yang dikelola pemilik token BESERTA Page Access Token-nya —
   * bentuk yang dipakai penemuan Messenger: hasil `listPageCandidates`
   * disaring ke Page bertoken. Untuk token user klasik (alur terbukti
   * live 7D) himpunannya sama seperti /me/accounts lama: Page-Page itu
   * muncul pertama di rantai dan tokennya langsung terisi; rantai hanya
   * menambah Page ter-assign/portofolio yang tokennya berhasil diisi.
   */
  async getManagedPages(
    trace?: MetaDiscoveryTraceEntry[],
  ): Promise<MetaManagedPage[]> {
    const candidates = await this.listPageCandidates(trace);
    const pages: MetaManagedPage[] = [];
    for (const page of candidates) {
      if (!page.accessToken) continue;
      pages.push({
        id: page.id,
        name: page.name,
        username: page.username,
        accessToken: page.accessToken,
        linkedIg: page.linkedIg,
      });
    }
    return pages;
  }

  /**
   * Akun IG tertaut ke SATU Page (`GET
   * /{page-id}?fields=instagram_business_account{id,username}`) —
   * dipanggil dengan token alur; null bila Page tak punya IG tertaut.
   * Melempar MetaGraphError pada penolakan Graph (pemanggil rantai
   * memperlakukannya best-effort per Page).
   */
  async getPageInstagramBusinessAccount(
    pageId: string,
  ): Promise<{ id: string; username: string | null } | null> {
    const body = await this.getJson<{
      instagram_business_account?: { id?: string; username?: string };
    }>(
      `${encodeURIComponent(pageId)}?fields=instagram_business_account{id,username}`,
    );
    const ig = body.instagram_business_account;
    if (typeof ig?.id !== "string" || !ig.id) return null;
    return {
      id: ig.id,
      username: typeof ig.username === "string" ? ig.username : null,
    };
  }

  /**
   * RANTAI PENEMUAN akun IG untuk callback OAuth (Fase 7D.3) — adopsi
   * pendekatan kode referensi yang terbukti menghubungkan IG pemilik:
   * dialog Unified Login pada praktiknya menyerahkan aset lewat
   * BEBERAPA tepi sekaligus, jadi satu tepi saja (pola 7D:
   * /me/assigned_instagram_accounts) tidak cukup. Tepi dicoba
   * berurutan, kandidat digabung & di-dedupe by ID akun IG:
   *   a. `assigned_instagram_accounts` — /me/assigned_instagram_accounts
   *      (jalur SUAT murni).
   *   b. `accounts_instagram_business_account` — /me/accounts dengan
   *      instagram_business_account: IG yang menempel pada Page;
   *      kandidat membawa Page token Page itu. (Dialog Unified
   *      tampaknya menyerahkan PAGE sebagai aset dan IG menumpang
   *      padanya — inilah tepi yang menemukan akun pada kode referensi.)
   *   c. `businesses_instagram_accounts` — /me/businesses dengan
   *      instagram_accounts: IG MILIK portofolio yang terlihat token.
   *      Tepi kritis untuk akun IG yang merupakan aset portofolio dan
   *      TIDAK tertaut ke Page mana pun; tepi ini bisa menolak dengan
   *      error izin (mis. graph_200) bila konfigurasi Login untuk
   *      Bisnis tidak memuat business_management — jejaknya sengaja
   *      terbaca jelas agar lapisan route bisa menyebutkannya di
   *      petunjuk picker.
   *   d. `page_instagram_business_account` — per-Page lewat rantai
   *      daftar Page (`listPageCandidates`, dibatasi 10 Page): IG
   *      tertaut tiap Page; kandidat membawa token Page itu bila ada.
   * Dedupe: kandidat yang sama dari banyak tepi menjadi satu; username
   * terisi dari tepi mana pun yang memilikinya; Page token dari tepi
   * mana pun MENANG atas kandidat tanpa token (kredensial Page adalah
   * semantik connect IG yang sudah terbukti). Kegagalan satu tepi
   * dicatat di `trace` dan TIDAK menggagalkan tepi berikutnya.
   */
  async discoverInstagramAccounts(
    trace: MetaDiscoveryTraceEntry[],
  ): Promise<MetaInstagramCandidate[]> {
    const byId = new Map<string, MetaInstagramCandidate>();
    const addCandidate = (
      id: string,
      username: string | null,
      pageAccessToken: string | null,
    ): void => {
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { id, username, pageAccessToken });
        return;
      }
      if (!existing.username && username) existing.username = username;
      if (!existing.pageAccessToken && pageAccessToken) {
        existing.pageAccessToken = pageAccessToken;
      }
    };

    // Tepi (a) — assigned_instagram_accounts (jalur SUAT).
    try {
      const accounts = await this.getAssignedInstagramAccounts();
      for (const account of accounts) {
        addCandidate(account.id, account.username, null);
      }
      trace.push({
        label: "assigned_instagram_accounts",
        count: accounts.length,
        error: null,
      });
    } catch (err) {
      trace.push({
        label: "assigned_instagram_accounts",
        count: 0,
        error: discoveryErrorClass(err),
      });
    }

    // Tepi (b) — IG yang menempel pada Page dari /me/accounts.
    try {
      const body = await this.getJsonParams<{
        data?: Array<{
          id?: string;
          access_token?: string;
          instagram_business_account?: { id?: string; username?: string };
        }>;
      }>("me/accounts", {
        fields: "id,access_token,instagram_business_account{id,username}",
        limit: "100",
      });
      let found = 0;
      for (const row of body.data ?? []) {
        const ig = row.instagram_business_account;
        if (typeof ig?.id !== "string" || !ig.id) continue;
        found += 1;
        addCandidate(
          ig.id,
          typeof ig.username === "string" ? ig.username : null,
          typeof row.access_token === "string" && row.access_token
            ? row.access_token
            : null,
        );
      }
      trace.push({
        label: "accounts_instagram_business_account",
        count: found,
        error: null,
      });
    } catch (err) {
      trace.push({
        label: "accounts_instagram_business_account",
        count: 0,
        error: discoveryErrorClass(err),
      });
    }

    // Tepi (c) — IG milik portofolio dari /me/businesses.
    try {
      const body = await this.getJsonParams<{
        data?: Array<{
          instagram_accounts?: {
            data?: Array<{ id?: string; username?: string }>;
          };
        }>;
      }>("me/businesses", {
        fields: "id,instagram_accounts{id,username}",
        limit: "100",
      });
      let found = 0;
      for (const business of body.data ?? []) {
        for (const row of business.instagram_accounts?.data ?? []) {
          if (typeof row.id !== "string" || !row.id) continue;
          found += 1;
          addCandidate(
            row.id,
            typeof row.username === "string" ? row.username : null,
            null,
          );
        }
      }
      trace.push({
        label: "businesses_instagram_accounts",
        count: found,
        error: null,
      });
    } catch (err) {
      trace.push({
        label: "businesses_instagram_accounts",
        count: 0,
        error: discoveryErrorClass(err),
      });
    }

    // Tepi (d) — per-Page lewat rantai daftar Page (jejak rantainya
    // sendiri ikut tercatat lebih dulu di trace yang sama).
    try {
      const pages = await this.listPageCandidates(trace);
      let found = 0;
      for (const page of pages.slice(0, 10)) {
        let ig = page.linkedIg;
        if (!ig) {
          ig = await this.getPageInstagramBusinessAccount(page.id).catch(
            () => null,
          );
        }
        if (!ig) continue;
        found += 1;
        addCandidate(ig.id, ig.username, page.accessToken);
      }
      trace.push({
        label: "page_instagram_business_account",
        count: found,
        error: null,
      });
    } catch (err) {
      trace.push({
        label: "page_instagram_business_account",
        count: 0,
        error: discoveryErrorClass(err),
      });
    }

    return [...byId.values()];
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
   * Langganan webhook untuk akun Messenger/Instagram termasuk field
   * KOMENTAR (Fase 10B): messenger meminta `messages,feed` (komentar
   * Page tiba sebagai perubahan feed item comment), instagram meminta
   * `messages,comments`. BEST-EFFORT BERLAPIS: bila permintaan lebar
   * ditolak Graph (mis. izin/langganan field belum tersedia), mundur
   * ke `messages` saja agar koneksi tidak pernah gagal hanya karena
   * field komentar — akun lama yang sudah terhubung mendapat field
   * komentar saat RECONNECT (langganan ulang), bukan otomatis.
   * Melempar hanya bila langganan dasar `messages` pun gagal.
   */
  async subscribeAppToObjectWithComments(
    objectId: string,
    provider: "messenger" | "instagram",
  ): Promise<void> {
    const wide =
      provider === "messenger"
        ? ["messages", "feed"]
        : ["messages", "comments"];
    try {
      await this.subscribeAppToObject(objectId, wide);
    } catch {
      await this.subscribeAppToObject(objectId, ["messages"]);
    }
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
    /**
     * Fase 10B — private reply: bila terisi, pesan dikirim ke PENULIS
     * komentar ini lewat `recipient: { comment_id }` (satu-satunya cara
     * Send API membuka DM ke orang yang belum pernah mengirim pesan;
     * sesudah ia membalas, percakapan berlanjut sebagai DM biasa).
     * `recipientExternalId` diabaikan dalam mode ini. Private reply
     * TIDAK memakai messaging_type (bentuk terdokumentasi Meta untuk
     * balasan privat atas komentar).
     */
    recipientCommentId?: string | null;
  }): Promise<{ providerMessageId: string }> {
    const body = await this.postJson<{ message_id?: string }>(
      `${encodeURIComponent(input.accountExternalId)}/messages`,
      input.recipientCommentId
        ? {
            recipient: { comment_id: input.recipientCommentId },
            message: { text: input.text },
          }
        : {
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

  /**
   * Balasan PUBLIK pada sebuah komentar (Fase 10B):
   * - Instagram: `POST /{comment-id}/replies` body { message }.
   * - Messenger/Page: `POST /{comment-id}/comments` body { message }.
   * Mengembalikan id balasan bila Meta menyertakannya.
   */
  async replyToComment(input: {
    provider: "instagram" | "messenger";
    commentId: string;
    text: string;
  }): Promise<{ replyId: string | null }> {
    const edge = input.provider === "instagram" ? "replies" : "comments";
    const body = await this.postJson<{ id?: string }>(
      `${encodeURIComponent(input.commentId)}/${edge}`,
      { message: input.text },
    );
    return { replyId: typeof body.id === "string" && body.id ? body.id : null };
  }

  /**
   * Sembunyikan / tampilkan komentar (moderasi, Fase 10B):
   * - Instagram: `POST /{comment-id}?hidden=true|false`.
   * - Messenger/Page: `POST /{comment-id}?is_hidden=true|false`.
   * Parameter lewat query string (preseden subscribed_apps di kelas
   * ini); body kosong. Kegagalan Graph melempar MetaGraphError seperti
   * metode lain — pemanggil yang mencatat status lokal.
   */
  async setCommentHidden(input: {
    provider: "instagram" | "messenger";
    commentId: string;
    hidden: boolean;
  }): Promise<void> {
    const param =
      input.provider === "instagram"
        ? `hidden=${input.hidden ? "true" : "false"}`
        : `is_hidden=${input.hidden ? "true" : "false"}`;
    await this.postJson(
      `${encodeURIComponent(input.commentId)}?${param}`,
      {},
    );
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

/**
 * Satu event REFERRAL yang dinormalisasi dari payload webhook Meta
 * (Fase 13B): kedatangan pengguna lewat tautan m.me / ig.me yang
 * membawa parameter ref — di sini ref = slug growth link.
 *
 * Bentuk terdokumentasi Meta (objek 'page' & 'instagram' simetris):
 * - entry.messaging[].referral = { ref, source, type } — referral
 *   berdiri sendiri saat percakapan DIBUKA dari tautan ref;
 * - entry.messaging[].postback.referral = { ref, source, type } —
 *   referral yang menempel pada ketukan tombol Get Started.
 * Keduanya dinormalkan ke bentuk yang sama; ref kosong dilewati.
 */
export interface MetaReferralEvent {
  /** Objek webhook: 'page' → messenger, 'instagram' → instagram. */
  objectKind: "page" | "instagram";
  /** entry.id: Page ID (page) / ID akun IG (instagram) — penerima. */
  entryExternalId: string;
  /** PSID/IGSID pengguna yang datang lewat tautan ref. */
  senderExternalId: string;
  /** Parameter ref pada tautan (di sini: slug growth link). */
  ref: string;
  /** Sumber Meta: 'SHORTLINK' | 'ADS' | 'CUSTOMER_CHAT_PLUGIN' | ... */
  source: string | null;
  timestamp: number | null;
}

interface MetaReferralPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      referral?: { ref?: string; source?: string };
      postback?: { referral?: { ref?: string; source?: string } };
      timestamp?: number;
    }>;
  }>;
}

/**
 * Menormalkan event referral (`messaging_referrals`) dari payload
 * webhook Meta. Parser messaging utama sengaja tidak diubah —
 * referral tidak membawa `message`, jadi tidak pernah lolos parser
 * pesan; jalur ini terpisah agar pemanggil bisa mengatribusikan
 * kontak tanpa membuat pesan masuk.
 */
export function parseMetaReferralEvents(payload: unknown): MetaReferralEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const body = payload as MetaReferralPayload;
  if (body.object !== "page" && body.object !== "instagram") return [];
  const objectKind = body.object;
  const events: MetaReferralEvent[] = [];
  for (const entry of body.entry ?? []) {
    if (typeof entry?.id !== "string" || !entry.id) continue;
    for (const item of entry.messaging ?? []) {
      const senderId = item?.sender?.id;
      if (typeof senderId !== "string" || !senderId) continue;
      const referral = item?.referral ?? item?.postback?.referral;
      if (!referral || typeof referral.ref !== "string" || !referral.ref) {
        continue;
      }
      events.push({
        objectKind,
        entryExternalId: entry.id,
        senderExternalId: senderId,
        ref: referral.ref,
        source: typeof referral.source === "string" ? referral.source : null,
        timestamp: typeof item.timestamp === "number" ? item.timestamp : null,
      });
    }
  }
  return events;
}

/** Satu event komentar yang dinormalisasi dari payload webhook Meta (Fase 10B). */
export interface MetaCommentEvent {
  /** Objek webhook: 'page' → messenger, 'instagram' → instagram. */
  objectKind: "page" | "instagram";
  /** entry.id: ID akun IG / Page ID pemilik komentar. */
  entryExternalId: string;
  /** Id komentar di Meta — kunci dedup bersama akun. */
  providerCommentId: string;
  /** Id media IG (instagram saja); null selain itu. */
  mediaId: string | null;
  /** Id postingan Page (messenger saja); null selain itu. */
  postId: string | null;
  /** Id komentar induk bila komentar ini balasan atas komentar lain. */
  parentId: string | null;
  /** IGSID / PSID penulis komentar. */
  authorExternalId: string;
  /** Username IG / nama penulis Page, bila payload membawanya. */
  authorUsername: string | null;
  /** Isi komentar. */
  text: string;
  /** Waktu komentar menurut provider (created_time, detik epoch); null bila absen. */
  providerCreatedAt: Date | null;
}

interface MetaCommentChangesPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        // Instagram (field 'comments')
        id?: string;
        text?: string;
        from?: { id?: string; username?: string; name?: string };
        media?: { id?: string };
        parent_id?: string;
        // Page feed (field 'feed', item 'comment')
        item?: string;
        verb?: string;
        comment_id?: string;
        post_id?: string;
        message?: string;
        created_time?: number;
      };
    }>;
  }>;
}

/**
 * Menormalkan event KOMENTAR dari payload webhook Meta (Fase 10B).
 * Parser messaging (`parseMetaWebhookEvents`) sengaja TIDAK diubah —
 * komentar hidup di `entry.changes`, bukan `entry.messaging`:
 * - Instagram: objek 'instagram', changes field 'comments',
 *   value { id, text, from { id, username }, media { id }, parent_id? }.
 * - Messenger/Page: objek 'page', changes field 'feed' dengan
 *   value.item='comment' & verb='add', value { comment_id, post_id,
 *   message, from { id, name }, created_time, parent_id? }.
 * Bentuk field 'comments' ala IG pada objek page juga ditoleransi
 * (beberapa konfigurasi langganan mengirimkannya). Perubahan feed
 * selain penambahan komentar (post, like, verb edit/remove) dilewati:
 * v1 hanya mencatat komentar baru; penghapusan komentar di sisi Meta
 * tidak diselaraskan (status lokal tetap yang terakhir diketahui).
 */
export function parseMetaCommentEvents(
  payload: unknown,
): MetaCommentEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const body = payload as MetaCommentChangesPayload;
  if (body.object !== "page" && body.object !== "instagram") return [];
  const objectKind = body.object;
  const events: MetaCommentEvent[] = [];
  for (const entry of body.entry ?? []) {
    if (typeof entry?.id !== "string" || !entry.id) continue;
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      if (objectKind === "instagram" || change.field === "comments") {
        // Bentuk IG: field 'comments'.
        if (change.field !== "comments") continue;
        const commentId = value.id;
        const authorId = value.from?.id;
        if (typeof commentId !== "string" || !commentId) continue;
        if (typeof authorId !== "string" || !authorId) continue;
        events.push({
          objectKind,
          entryExternalId: entry.id,
          providerCommentId: commentId,
          mediaId:
            typeof value.media?.id === "string" && value.media.id
              ? value.media.id
              : null,
          postId: null,
          parentId:
            typeof value.parent_id === "string" && value.parent_id
              ? value.parent_id
              : null,
          authorExternalId: authorId,
          authorUsername:
            (typeof value.from?.username === "string" &&
            value.from.username
              ? value.from.username
              : null) ??
            (typeof value.from?.name === "string" && value.from.name
              ? value.from.name
              : null),
          text: typeof value.text === "string" ? value.text : "",
          providerCreatedAt: null,
        });
        continue;
      }
      // Bentuk Page feed: hanya komentar baru.
      if (change.field !== "feed") continue;
      if (value.item !== "comment" || value.verb !== "add") continue;
      const commentId = value.comment_id;
      const authorId = value.from?.id;
      if (typeof commentId !== "string" || !commentId) continue;
      if (typeof authorId !== "string" || !authorId) continue;
      events.push({
        objectKind,
        entryExternalId: entry.id,
        providerCommentId: commentId,
        mediaId: null,
        postId:
          typeof value.post_id === "string" && value.post_id
            ? value.post_id
            : null,
        parentId:
          typeof value.parent_id === "string" && value.parent_id
            ? value.parent_id
            : null,
        authorExternalId: authorId,
        authorUsername:
          typeof value.from?.name === "string" && value.from.name
            ? value.from.name
            : null,
        text: typeof value.message === "string" ? value.message : "",
        providerCreatedAt:
          typeof value.created_time === "number" && value.created_time > 0
            ? new Date(value.created_time * 1000)
            : null,
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
