import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import {
  MessageListResponseSchema,
  WebchatSendMessageRequestSchema,
  WebchatSessionRequestSchema,
  WebchatSessionResponseSchema,
} from "@sahabat-kreator/contracts";
import {
  flushQueuedWebchatMessages,
  listMessages,
  openWebchatSession,
  recordWebchatInboundMessage,
  resolveWebchatAccountBySiteKey,
} from "@sahabat-kreator/core";
import {
  createWebchatVisitorToken,
  verifyWebchatVisitorToken,
  type WebchatVisitorTokenPayload,
} from "@sahabat-kreator/channel-webchat";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";
import { serializeMessage } from "../messages-serialize";
import type { WebchatHub } from "./hub";

/**
 * Modul webchat publik (Fase 1F) — API widget untuk PENGUNJUNG situs tenant.
 * TANPA sesi dashboard. Autentikasi dua lapis:
 * - siteKey publik (`wc_...` di URL sesi) mengidentifikasi channel/tenant;
 * - token pengunjung HMAC (Bearer) mengidentifikasi kontak + percakapan.
 *
 * Route (di-mount di root DAN di bawah /api seperti modul lain):
 *   POST /webchat/:siteKey/session   buka/temukan sesi → {token, ...pesan}
 *   GET  /webchat/messages           pesan percakapan (Bearer; sinkronisasi)
 *   POST /webchat/messages           kirim pesan inbound (Bearer)
 *   GET  /webchat/ws?token=...       WebSocket realtime (upgrade handler
 *                                    terpisah — lihat createWebchatUpgradeHandler)
 */

export interface WebchatModuleOptions {
  /** Secret HMAC token pengunjung (env WEBCHAT_SECRET). */
  secret: string | undefined;
  hub: WebchatHub;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function createWebchatRoutes(
  bundle: AuthBundle | null,
  opts: WebchatModuleOptions,
) {
  const app = new Hono<{ Variables: AppVariables }>();

  const notConfigured = (c: Parameters<typeof apiError>[0]) =>
    apiError(c, 503, "INTERNAL_ERROR", "Webchat is not configured");
  const configured = Boolean(bundle && opts.secret);

  function visitorPayload(c: {
    req: { header: (name: string) => string | undefined };
  }): WebchatVisitorTokenPayload | null {
    const token = bearerToken(c.req.header("authorization"));
    if (!token || !opts.secret) return null;
    return verifyWebchatVisitorToken(opts.secret, token);
  }

  app.post("/webchat/:siteKey/session", async (c) => {
    if (!configured || !bundle || !opts.secret) return notConfigured(c);
    const siteKey = c.req.param("siteKey");
    const account = await resolveWebchatAccountBySiteKey(bundle.db, siteKey);
    if (!account || account.status !== "connected") {
      return apiError(c, 404, "NOT_FOUND", "Webchat site not found");
    }
    let json: unknown = {};
    const raw = await c.req.text();
    if (raw.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
      }
    }
    const parsed = WebchatSessionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid session payload");
    }
    const session = await openWebchatSession(bundle.db, account, parsed.data);
    const token = createWebchatVisitorToken(opts.secret, {
      tid: account.tenantId,
      acc: account.id,
      con: session.contactId,
      cv: session.conversationId,
    });
    const body = WebchatSessionResponseSchema.parse({
      token,
      contactId: session.contactId,
      conversationId: session.conversationId,
      messages: session.messages.map(serializeMessage),
    });
    return c.json(body);
  });

  app.get("/webchat/messages", async (c) => {
    if (!configured || !bundle) return notConfigured(c);
    const payload = visitorPayload(c);
    if (!payload) return apiError(c, 401, "UNAUTHORIZED", "Invalid visitor token");
    const rows = await listMessages(
      bundle.db,
      { tenantId: payload.tid },
      payload.cv,
      { limit: 100 },
    );
    if (!rows) return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    const body = MessageListResponseSchema.parse({
      messages: rows.map(serializeMessage),
    });
    return c.json(body);
  });

  app.post("/webchat/messages", async (c) => {
    if (!configured || !bundle) return notConfigured(c);
    const payload = visitorPayload(c);
    if (!payload) return apiError(c, 401, "UNAUTHORIZED", "Invalid visitor token");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = WebchatSendMessageRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid message payload");
    }
    const message = await recordWebchatInboundMessage(
      bundle.db,
      { tenantId: payload.tid, conversationId: payload.cv },
      parsed.data,
    );
    if (!message) return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    return c.json(serializeMessage(message), 201);
  });

  return app;
}

/**
 * Membuat handler `upgrade` HTTP untuk WS webchat. Mengembalikan true bila
 * path adalah endpoint WS webchat (ditangani — termasuk bila ditolak),
 * false bila bukan urusannya (pemanggil boleh menghancurkan socket).
 *
 * Saat connect: koneksi didaftarkan ke hub, lalu pesan outbound yang masih
 * `queued` untuk percakapan ini ditandai `sent` dan didorong (jalur
 * offline→online: balasan dashboard yang menunggu akhirnya terkirim).
 */
export function createWebchatUpgradeHandler(
  bundle: AuthBundle | null,
  opts: WebchatModuleOptions,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const wss = new WebSocketServer({ noServer: true });

  return (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      return false;
    }
    if (url.pathname !== "/webchat/ws" && url.pathname !== "/api/webchat/ws") {
      return false;
    }
    const reject = (statusLine: string) => {
      socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return true;
    };
    if (!bundle || !opts.secret) return reject("503 Service Unavailable");
    const token = url.searchParams.get("token");
    const payload = token
      ? verifyWebchatVisitorToken(opts.secret, token)
      : null;
    if (!payload) return reject("401 Unauthorized");

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      opts.hub.register(payload.cv, ws);
      ws.send(JSON.stringify({ type: "ready", conversationId: payload.cv }));
      void (async () => {
        try {
          const flushed = await flushQueuedWebchatMessages(bundle.db, {
            tenantId: payload.tid,
            conversationId: payload.cv,
          });
          for (const message of flushed) {
            opts.hub.deliverMessage(payload.cv, serializeMessage(message));
          }
        } catch (err) {
          console.error("[webchat] flush queued messages failed", err);
        }
      })();
    });
    return true;
  };
}
