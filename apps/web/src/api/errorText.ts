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
    case "FORBIDDEN":
      return t("errors.FORBIDDEN");
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
    case "CHANNEL_NOT_AVAILABLE_YET":
      return t("errors.CHANNEL_NOT_AVAILABLE_YET");
    case "CHANNEL_NOT_CONNECTED":
      return t("errors.CHANNEL_NOT_CONNECTED");
    case "TELEGRAM_TOKEN_INVALID":
      return t("errors.TELEGRAM_TOKEN_INVALID");
    case "TELEGRAM_BOT_ALREADY_CONNECTED":
      return t("errors.TELEGRAM_BOT_ALREADY_CONNECTED");
    case "META_TOKEN_INVALID":
      return t("errors.META_TOKEN_INVALID");
    case "META_ACCOUNT_ALREADY_CONNECTED":
      return t("errors.META_ACCOUNT_ALREADY_CONNECTED");
    case "META_OAUTH_NOT_CONFIGURED":
      return t("errors.META_OAUTH_NOT_CONFIGURED");
    case "META_OAUTH_STATE_INVALID":
      return t("errors.META_OAUTH_STATE_INVALID");
    case "META_OAUTH_SESSION_NOT_FOUND":
      return t("errors.META_OAUTH_SESSION_NOT_FOUND");
    case "META_OAUTH_ASSET_NOT_FOUND":
      return t("errors.META_OAUTH_ASSET_NOT_FOUND");
    case "META_OAUTH_EXCHANGE_FAILED":
      return t("errors.META_OAUTH_EXCHANGE_FAILED");
    case "META_OAUTH_CANCELLED":
      return t("errors.META_OAUTH_CANCELLED");
    case "CHANNEL_DELETE_CONFIRMATION_MISMATCH":
      return t("errors.CHANNEL_DELETE_CONFIRMATION_MISMATCH");
    case "CHANNEL_ALREADY_TRASHED":
      return t("errors.CHANNEL_ALREADY_TRASHED");
    case "CHANNEL_NOT_TRASHED":
      return t("errors.CHANNEL_NOT_TRASHED");
    case "PRODUCT_HAS_LINKS":
      return t("errors.PRODUCT_HAS_LINKS");
    case "CHANNEL_DISCONNECTED":
      return t("errors.CHANNEL_DISCONNECTED");
    case "LOG_REPLAY_NOT_ALLOWED":
      return t("errors.LOG_REPLAY_NOT_ALLOWED");
    case "LOG_PAYLOAD_TRUNCATED":
      return t("errors.LOG_PAYLOAD_TRUNCATED");
    case "MESSAGE_NOT_FAILED":
      return t("errors.MESSAGE_NOT_FAILED");
    case "MESSAGE_RETRY_UNSUPPORTED":
      return t("errors.MESSAGE_RETRY_UNSUPPORTED");
    default:
      break;
  }

  if (err.status === 401) return t("errors.invalidCredentials");
  if (err.status === 400 || err.status === 422)
    return t("errors.VALIDATION_ERROR");
  return t("errors.generic");
}
