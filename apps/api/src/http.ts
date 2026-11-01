import type { Context } from "hono";
import { ApiErrorSchema, type ErrorCode } from "@sahabat-kreator/contracts";
import type { User } from "@sahabat-kreator/db";

/** Variabel konteks Hono untuk request terautentikasi. */
export interface AppVariables {
  /** Baris `users` kita (bukan auth_user Better Auth) untuk sesi aktif. */
  appUser: User;
  /** Id Better Auth (auth_user.id) dari sesi aktif. */
  authUserId: string;
}

export type AppContext = Context<{ Variables: AppVariables }>;

/** Balasan error sesuai kontrak: { error: { code, message } } (RANCANGAN §11.1). */
export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
  code: ErrorCode,
  message: string,
) {
  const body = ApiErrorSchema.parse({ error: { code, message } });
  return c.json(body, status);
}
