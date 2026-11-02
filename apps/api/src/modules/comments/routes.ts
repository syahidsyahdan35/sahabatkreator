import { Hono } from "hono";
import { z } from "zod";
import {
  CommentListResponseSchema,
  CommentResponseSchema,
  type CommentResponse,
} from "@sahabat-kreator/contracts";
import {
  decryptChannelSecret,
  getChannelAccount,
  getComment,
  listComments,
  setCommentModerationStatus,
  type CommentListItem,
} from "@sahabat-kreator/core";
import { META_GRAPH_API_VERSION } from "@sahabat-kreator/config";
import {
  MetaGraphClient,
  MetaGraphError,
} from "@sahabat-kreator/channel-messenger";
import type { AuthBundle } from "../../auth";
import { apiError, type AppContext, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

export interface CommentsModuleOptions {
  channelTokenSecret?: string;
  metaApiBase?: string;
}

function serializeComment(row: CommentListItem): CommentResponse {
  return CommentResponseSchema.parse({
    id: row.id,
    channelAccountId: row.channelAccountId,
    channelDisplayName: row.channelDisplayName ?? row.channelExternalId,
    provider: row.provider,
    providerCommentId: row.providerCommentId,
    mediaId: row.mediaId,
    postId: row.postId,
    parentId: row.parentId,
    authorExternalId: row.authorExternalId,
    authorUsername: row.authorUsername,
    text: row.text,
    providerCreatedAt: row.providerCreatedAt
      ? row.providerCreatedAt.toISOString()
      : null,
    moderationStatus: row.moderationStatus,
    contactId: row.contactId,
    conversationId: row.conversationId,
    matchedAutomationId: row.matchedAutomationId,
    actions: row.actions ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Modul comments (Fase 10B) — komentar publik Instagram/Messenger yang
 * tercatat dari webhook Meta:
 *   GET  /tenants/:tenantId/comments?channelAccountId=&automationId=&limit=
 *        daftar terbaru (semua member workspace) + jejak aksi aturan.
 *   POST /tenants/:tenantId/comments/:id/hide   sembunyikan di Meta
 *   POST /tenants/:tenantId/comments/:id/unhide tampilkan lagi di Meta
 * Moderasi manual memanggil Graph DULU dengan token akun pemilik
 * komentar; status lokal hanya berubah bila Graph menerima — kegagalan
 * Graph menjawab 422 META_COMMENT_ACTION_FAILED dan status lokal tetap.
 * Wajib sesi + membership workspace (non-member → 404 TENANT_NOT_FOUND).
 */
export function createCommentsRoutes(
  bundle: AuthBundle | null,
  opts: CommentsModuleOptions = {},
) {
  const app = new Hono<{ Variables: AppVariables }>();
  const base = "/tenants/:tenantId/comments";

  if (!bundle) {
    const unavailable = (c: AppContext) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    app.get(base, unavailable);
    app.post(`${base}/:id/hide`, unavailable);
    app.post(`${base}/:id/unhide`, unavailable);
    return app;
  }

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  const resolveTenant = async (c: AppContext) =>
    resolveTenantForUser(
      bundle,
      c.req.param("tenantId") ?? "",
      c.get("appUser").id,
    );

  app.get(base, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant)
      return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const channelAccountId = c.req.query("channelAccountId");
    const automationId = c.req.query("automationId");
    const limitRaw = Number(c.req.query("limit") ?? "");
    const rows = await listComments(bundle.db, { tenantId: tenant.id }, {
      ...(channelAccountId &&
      z.string().uuid().safeParse(channelAccountId).success
        ? { channelAccountId }
        : {}),
      ...(automationId && z.string().uuid().safeParse(automationId).success
        ? { automationId }
        : {}),
      ...(Number.isFinite(limitRaw) && limitRaw > 0
        ? { limit: Math.floor(limitRaw) }
        : {}),
    });
    return c.json(
      CommentListResponseSchema.parse({
        comments: rows.map(serializeComment),
      }),
    );
  });

  const moderate = (hidden: boolean) => async (c: AppContext) => {
    const tenant = await resolveTenant(c);
    if (!tenant)
      return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Comment not found");
    }
    const comment = await getComment(
      bundle.db,
      { tenantId: tenant.id },
      id,
    );
    if (!comment) return apiError(c, 404, "NOT_FOUND", "Comment not found");
    if (
      comment.provider !== "instagram" &&
      comment.provider !== "messenger"
    ) {
      return apiError(
        c,
        422,
        "META_COMMENT_ACTION_FAILED",
        "Comment moderation is only available for Meta comments",
      );
    }
    const account = await getChannelAccount(
      bundle.db,
      { tenantId: tenant.id },
      comment.channelAccountId,
    );
    if (!account?.accessTokenEncrypted) {
      return apiError(
        c,
        422,
        "META_COMMENT_ACTION_FAILED",
        "Channel account token is unavailable",
      );
    }
    let token: string | null = null;
    if (opts.channelTokenSecret) {
      token = decryptChannelSecret(
        opts.channelTokenSecret,
        account.accessTokenEncrypted,
      );
    }
    if (!token) {
      return apiError(
        c,
        422,
        "META_COMMENT_ACTION_FAILED",
        "Channel account token could not be decrypted",
      );
    }
    const client = new MetaGraphClient({
      baseUrl: opts.metaApiBase,
      apiVersion: META_GRAPH_API_VERSION,
      accessToken: token,
    });
    try {
      await client.setCommentHidden({
        provider: comment.provider,
        commentId: comment.providerCommentId,
        hidden,
      });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        console.error(
          `[comments] moderasi manual ${comment.id} gagal: graph ${err.graphCode ?? "?"} ${err.description}`,
        );
      }
      return apiError(
        c,
        422,
        "META_COMMENT_ACTION_FAILED",
        "Meta rejected the moderation request",
      );
    }
    const user = c.get("appUser");
    const updated = await setCommentModerationStatus(
      bundle.db,
      { tenantId: tenant.id, userId: user.id },
      { commentId: comment.id, hidden },
    );
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Comment not found");
    const rows = await listComments(
      bundle.db,
      { tenantId: tenant.id },
      { channelAccountId: updated.channelAccountId, limit: 200 },
    );
    const item = rows.find((r) => r.id === updated.id);
    return c.json(
      serializeComment(
        item ?? {
          ...updated,
          channelDisplayName: account.displayName,
          channelExternalId: account.externalId,
        },
      ),
    );
  };

  app.post(`${base}/:id/hide`, moderate(true));
  app.post(`${base}/:id/unhide`, moderate(false));

  return app;
}
