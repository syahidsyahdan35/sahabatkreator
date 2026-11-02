/**
 * Kontrak provider LLM untuk agent runtime (Fase 3A, RANCANGAN §5.1).
 *
 * Protokol tool lintas provider:
 * - Agent mendefinisikan tool SEKALI sebagai skema internal
 *   (`LlmToolDefinition`, lihat tools.ts). Setiap provider menerjemahkan
 *   ke format aslinya (OpenRouter/OpenAI: function calling).
 * - Balasan teks dan tool call adalah dua kanal terpisah: teks pada
 *   `LlmChatResult.text` adalah balasan yang (dalam mode auto) dikirim ke
 *   lawan bicara; tool pada `toolCalls` dieksekusi runtime sebagai AKSI
 *   (tag/stage/handoff). Tidak ada tool `send_message` — teks hasil chat
 *   ITU sendiri pesannya (agent harus hemat pesan, RANCANGAN §5.1 langkah 8).
 * - Fallback wajib: bila provider/model tidak menghasilkan tool call yang
 *   valid, hasilnya diperlakukan sebagai teks biasa — runtime TIDAK crash.
 * - `kbChunks` adalah potongan basis pengetahuan hasil retrieval (core).
 *   Setiap provider bertanggung jawab memasukkannya ke konteks model:
 *   mock mengutipnya secara deterministik; OpenRouter menyisipkannya
 *   sebagai blok konteks di pesan sistem.
 */

export interface LlmToolParameterProperty {
  type: "string";
  description?: string;
  enum?: string[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, LlmToolParameterProperty>;
    required?: string[];
  };
}

export interface LlmToolCall {
  /** Id panggilan dari provider (mock: id sintetis deterministik). */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmChatRequest {
  /** Prompt sistem agent (persona + instruksi), TANPA konteks KB. */
  system: string;
  /** Riwayat percakapan (kronologis); pesan terakhir adalah pemicu. */
  messages: LlmChatMessage[];
  tools: LlmToolDefinition[];
  /** Chunk KB hasil retrieval untuk pertanyaan terakhir (boleh kosong). */
  kbChunks?: string[];
  /** Override model dari konfigurasi agent; kosong = default provider. */
  model?: string;
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  /**
   * Biaya aktual dalam USD — HANYA diisi bila provider benar-benar
   * melaporkannya pada respons yang sama (OpenRouter dengan
   * `usage: { include: true }`). Tidak pernah diestimasi/dikarang di
   * lapisan mana pun: provider yang tidak melaporkan biaya (mock)
   * membiarkan field ini undefined, dan dasbor pemakaian menampilkannya
   * sebagai "tidak dilaporkan", bukan nol karangan.
   */
  costUsd?: number;
}

export interface LlmChatResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  /** Nama model yang benar-benar dipakai (untuk usage_ledger & audit). */
  model: string;
  /** 'mock' | 'openrouter' — dicatat apa adanya di ledger/audit. */
  provider: string;
}

export interface LlmProvider {
  readonly name: string;
  chat(request: LlmChatRequest): Promise<LlmChatResult>;
}
