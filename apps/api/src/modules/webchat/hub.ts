import type { WebSocket } from "ws";
import type { MessageResponse } from "@sahabat-kreator/contracts";

/**
 * Hub WebSocket webchat (Fase 1F): memegang koneksi pengunjung yang sedang
 * terbuka, terindeks per conversationId. In-memory & satu proses API —
 * cukup untuk staging fase ini; bila API di-scale horizontal nanti, hub
 * dipindah ke pub/sub Redis tanpa mengubah kontrak modul lain.
 *
 * Yang memakai hub:
 * - Handler upgrade WS (index.ts): mendaftarkan koneksi saat pengunjung
 *   connect, dan mengirim pesan `queued` yang menunggu (flush).
 * - Route balasan inbox: mendorong balasan dashboard secara realtime.
 */
export class WebchatHub {
  private readonly byConversation = new Map<string, Set<WebSocket>>();

  register(conversationId: string, socket: WebSocket): void {
    let set = this.byConversation.get(conversationId);
    if (!set) {
      set = new Set();
      this.byConversation.set(conversationId, set);
    }
    set.add(socket);
    const cleanup = () => this.unregister(conversationId, socket);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
  }

  unregister(conversationId: string, socket: WebSocket): void {
    const set = this.byConversation.get(conversationId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byConversation.delete(conversationId);
  }

  /** Jumlah koneksi hidup yang menerima pesan ini (0 = pengunjung offline). */
  deliverMessage(conversationId: string, message: MessageResponse): number {
    const set = this.byConversation.get(conversationId);
    if (!set || set.size === 0) return 0;
    const payload = JSON.stringify({ type: "message", message });
    let delivered = 0;
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
        delivered += 1;
      }
    }
    return delivered;
  }

  connectionCount(conversationId: string): number {
    return this.byConversation.get(conversationId)?.size ?? 0;
  }
}
