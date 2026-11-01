import type { TranslationKey } from "@sahabat-kreator/i18n";
import { ApiClientError } from "./client";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

/**
 * Petakan error API → teks i18n (RANCANGAN §11.1: API membawa kode, UI yang
 * menerjemahkan). Mencakup kode kontrak kita dan kode mentah Better Auth
 * (endpoint /api/auth/* tidak memakai format kontrak).
 */
export function translateApiError(t: Translate, err: unknown): string {
  if (!(err instanceof ApiClientError)) return t("errors.generic");

  switch (err.code) {
    // Better Auth (sign-in / sign-up)
    case "INVALID_EMAIL_OR_PASSWORD":
      return t("errors.invalidCredentials");
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
    case "USER_ALREADY_EXISTS":
      return t("errors.userAlreadyExists");
    case "PASSWORD_TOO_SHORT":
      return t("errors.passwordTooShort");
    case "INVALID_EMAIL":
      return t("auth.emailInvalid");
    case "NETWORK_ERROR":
      return t("errors.network");
    // Kode kontrak yang punya terjemahan langsung di resource `errors.*`
    case "UNAUTHORIZED":
      return t("errors.UNAUTHORIZED");
    case "VALIDATION_ERROR":
      return t("errors.VALIDATION_ERROR");
    case "INTERNAL_ERROR":
      return t("errors.INTERNAL_ERROR");
    case "TENANT_NOT_FOUND":
      return t("errors.TENANT_NOT_FOUND");
    case "NOT_FOUND":
      return t("errors.NOT_FOUND");
    case "RATE_LIMITED":
      return t("errors.RATE_LIMITED");
    default:
      break;
  }

  if (err.status === 401) return t("errors.invalidCredentials");
  if (err.status === 400 || err.status === 422)
    return t("errors.VALIDATION_ERROR");
  return t("errors.generic");
}
