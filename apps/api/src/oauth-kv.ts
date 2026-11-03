import { createEphemeralRedisConnection } from "@sahabat-kreator/queue";

/**
 * Penyimpanan nonce + sesi alur OAuth (dipakai Meta OAuth 7D dan
 * koneksi Google Calendar 13G).
 *
 * Latar belakang: state OAuth harus **sekali pakai** dan **lintas
 * replika**. Dua modul ini semula punya salinan sendiri; modul Meta
 * memakai Redis dengan fallback Map, modul janji temu memakai Map proses
 * saja. Konsekuensi versi Map-saja: bila API berjalan lebih dari satu
 * replika (atau proses restart di antara "connect" dan "callback"),
 * callback ditolak `GOOGLE_STATE_INVALID` walau penggunanya tidak salah
 * apa pun — bug yang hanya muncul di produksi.
 *
 * Karena itu satu implementasi dipakai bersama:
 * - `claimNonce` = `SET key 1 EX ttl NX` (atomik; false bila sudah ada).
 * - `consumeNonce` = `GETDEL` (atomik; true hanya untuk pemakaian
 *   pertama) — mencegah replay state yang sudah terpakai.
 * - sesi OAuth disimpan sebagai blob terenkripsi pemanggil (store ini
 *   tidak pernah membaca isinya).
 *
 * FAIL-SOFT (bukan fail-open): bila Redis gagal/timeout, operasi
 * dialihkan ke Map proses untuk panggilan itu. Nonce yang diklaim di
 * Redis lalu dikonsumsi saat Redis mati akan DITOLAK (callback gagal
 * dengan state invalid, pengguna mengulang "connect") — arah kegagalan
 * yang aman. Kegagalan pertama dicatat ke stderr sekali saja.
 *
 * Catatan: `createEphemeralRedisConnection` dipakai karena ini jalur
 * request — perintah tidak boleh menggantung menunggu Redis yang mati.
 */

/** Kontrak penyimpanan nonce + sesi OAuth. */
export interface OAuthKvStore {
  /** Klaim nonce baru; false bila nonce sudah pernah diklaim. */
  claimNonce(nonce: string): Promise<boolean>;
  /** Konsumsi nonce secara atomik; true hanya untuk pemakaian pertama. */
  consumeNonce(nonce: string): Promise<boolean>;
  putSession(id: string, encryptedPayload: string): Promise<void>;
  getSession(id: string): Promise<string | null>;
  deleteSession(id: string): Promise<void>;
}

/** Bentuk struktural minimum klien ioredis yang dipakai store ini. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  getdel(key: string): Promise<string | null>;
}

export interface OAuthKvStoreOptions {
  /** Prefiks key Redis, mis. `meta-oauth` → `meta-oauth:nonce:<n>`. */
  namespace: string;
  /** Umur nonce & sesi (detik). */
  ttlSeconds: number;
}

/** Batas tunggu satu perintah Redis pada jalur request. */
const STORE_TIMEOUT_MS = 3_000;

async function withStoreTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("oauth_store_timeout")),
        STORE_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Fallback tanpa Redis: Map proses dengan kedaluwarsa malas. Cukup untuk
 * API satu proses; lihat catatan FAIL-SOFT di atas untuk perilakunya
 * saat Redis yang seharusnya dipakai ternyata mati.
 */
function createMemoryStore(options: OAuthKvStoreOptions): OAuthKvStore {
  const nonces = new Map<string, number>();
  const sessions = new Map<string, { value: string; expiresAt: number }>();
  const alive = (expiresAt: number) => expiresAt > Date.now();
  const ttlMs = options.ttlSeconds * 1000;
  return {
    async claimNonce(nonce) {
      const existing = nonces.get(nonce);
      if (existing !== undefined && alive(existing)) return false;
      nonces.set(nonce, Date.now() + ttlMs);
      return true;
    },
    async consumeNonce(nonce) {
      const existing = nonces.get(nonce);
      if (existing === undefined) return false;
      nonces.delete(nonce);
      return alive(existing);
    },
    async putSession(id, encryptedPayload) {
      sessions.set(id, {
        value: encryptedPayload,
        expiresAt: Date.now() + ttlMs,
      });
    },
    async getSession(id) {
      const entry = sessions.get(id);
      if (!entry) return null;
      if (!alive(entry.expiresAt)) {
        sessions.delete(id);
        return null;
      }
      return entry.value;
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
  };
}

/**
 * Membuat store OAuth. Tanpa `redisUrl` (pengembangan lokal tanpa Redis)
 * langsung memakai Map proses; dengan `redisUrl` memakai Redis dan
 * turun ke Map proses hanya saat Redis gagal.
 */
export function createOAuthKvStore(
  redisUrl: string | undefined,
  options: OAuthKvStoreOptions,
): OAuthKvStore {
  const memory = createMemoryStore(options);
  if (!redisUrl) return memory;

  let client: RedisLike | null = null;
  let warned = false;

  const redis = (): RedisLike => {
    if (!client) {
      client = createEphemeralRedisConnection(redisUrl) as unknown as RedisLike;
    }
    return client;
  };

  const warnOnce = (err: unknown): void => {
    if (warned) return;
    warned = true;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[${options.namespace}] Redis tidak tersedia — nonce/sesi OAuth dialihkan ke memori proses sementara: ${message}`,
    );
  };

  const nonceKey = (nonce: string) => `${options.namespace}:nonce:${nonce}`;
  const sessionKey = (id: string) => `${options.namespace}:session:${id}`;

  /** Jalankan operasi Redis; saat gagal catat sekali lalu pakai Map. */
  const attempt = async <T>(
    op: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await withStoreTimeout(op());
    } catch (err) {
      warnOnce(err);
      return fallback();
    }
  };

  return {
    claimNonce(nonce) {
      return attempt(
        async () =>
          (await redis().set(
            nonceKey(nonce),
            "1",
            "EX",
            options.ttlSeconds,
            "NX",
          )) === "OK",
        () => memory.claimNonce(nonce),
      );
    },
    consumeNonce(nonce) {
      return attempt(
        async () => (await redis().getdel(nonceKey(nonce))) !== null,
        () => memory.consumeNonce(nonce),
      );
    },
    putSession(id, encryptedPayload) {
      return attempt(
        async () => {
          await redis().set(
            sessionKey(id),
            encryptedPayload,
            "EX",
            options.ttlSeconds,
          );
        },
        () => memory.putSession(id, encryptedPayload),
      );
    },
    getSession(id) {
      return attempt(
        () => redis().get(sessionKey(id)),
        () => memory.getSession(id),
      );
    },
    deleteSession(id) {
      return attempt(
        async () => {
          await redis().del(sessionKey(id));
        },
        () => memory.deleteSession(id),
      );
    },
  };
}
