import type { Context } from "hono";
import {
  ApiErrorSchema,
  type ApiKeyScope,
  type ErrorCode,
} from "@sahabat-kreator/contracts";
import type { ApiKey, User } from "@sahabat-kreator/db";

/** Konteks autentikasi API publik /v1 (Fase 5A): tenant diturunkan dari API key. */
export interface ApiKeyAuthContext {
  apiKey: ApiKey;
  tenantId: string;
  scopes: ApiKeyScope[];
}

/** Variabel konteks Hono untuk request terautentikasi. */
export interface AppVariables {
  /** Baris `users` kita (bukan auth_user Better Auth) untuk sesi aktif. */
  appUser: User;
  /** Id Better Auth (auth_user.id) dari sesi aktif. */
  authUserId: string;
  /** Terisi hanya pada route API publik /v1 sesudah middleware API key lolos. */
  apiKeyAuth: ApiKeyAuthContext;
}

export type AppContext = Context<{ Variables: AppVariables }>;

/** Balasan error sesuai kontrak: { error: { code, message } } (RANCANGAN §11.1). */
export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  const body = ApiErrorSchema.parse({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  });
  return c.json(body, status);
}
