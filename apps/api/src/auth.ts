import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
  createDb,
  users,
  type Database,
  type User,
} from "@sahabat-kreator/db";

/**
 * Integrasi Better Auth (Fase 1B) — email + password, sesi cookie httpOnly.
 *
 * Pemisahan tanggung jawab (keputusan desain Fase 1B):
 * - Better Auth memiliki tabelnya sendiri (`auth_user`, `auth_session`,
 *   `auth_account`, `auth_verification`) dan mengurus hashing password,
 *   token sesi, dan cookie.
 * - Sumber kebenaran workspace tetap tabel Fase 1A (`users`, `tenants`,
 *   `tenant_members`). Baris `users` kita dihubungkan ke `auth_user`
 *   lewat kolom `users.auth_user_id` dan dibuat otomatis saat sign-up
 *   (database hook di bawah) atau disinkronkan malas (lazy) pada request
 *   terautentikasi pertama — lihat `syncAppUser`.
 * - Plugin organization Better Auth SENGAJA tidak dipakai; keanggotaan
 *   tenant dikelola core kita + RLS.
 */

export interface AuthBundle {
  auth: ReturnType<typeof createAuthInstance>;
  db: Database;
}

function createAuthInstance(db: Database, opts: { secret: string; baseURL: string }) {
  return betterAuth({
    appName: "Sahabat Kreator",
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
    }),
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await syncAppUser(db, {
              authUserId: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
      },
    },
  });
}

/**
 * Membuat/menyinkronkan baris `users` kita untuk satu pengguna Better Auth.
 * Upsert berbasis email (unik): bila email sudah ada (mis. hasil seed),
 * kolom auth_user_id-nya yang diisi.
 */
export async function syncAppUser(
  db: Database,
  input: { authUserId: string; email: string; name?: string | null },
): Promise<User> {
  await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name ?? null,
      authUserId: input.authUserId,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { authUserId: input.authUserId, updatedAt: new Date() },
    });
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.authUserId, input.authUserId))
    .limit(1);
  if (!row) {
    throw new Error(`syncAppUser: users untuk auth ${input.authUserId} tidak ditemukan`);
  }
  return row;
}

/** Membuat bundle auth hanya bila env DB + secret tersedia (mode Fase 0 tanpa DB tetap bisa /health). */
export function createAuthBundle(opts: {
  databaseUrl: string;
  secret: string;
  baseURL: string;
}): AuthBundle {
  const { db } = createDb(opts.databaseUrl);
  return { auth: createAuthInstance(db, opts), db };
}
