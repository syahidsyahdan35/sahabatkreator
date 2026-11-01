import type {
  LlmChatRequest,
  LlmChatResult,
  LlmProvider,
  LlmToolCall,
} from "./types";

/**
 * MockProvider — provider LLM deterministik untuk dev/test/staging tanpa
 * kunci API (default Fase 3A; aktif bila LLM_PROVIDER=mock).
 *
 * Perilaku yang DISENGAJA & terdokumentasi (bukan meniru model sungguhan):
 * 1. Bila konteks KB (`kbChunks`) tidak kosong, balasan MENGUTIP kalimat
 *    pertama chunk teratas: "Berdasarkan informasi yang kami punya: …".
 *    Ini membuat bekerjanya retrieval bisa dibuktikan end-to-end — balasan
 *    memuat frasa khas dari dokumen (mis. harga "Rp349 ribu").
 * 2. Bila KB kosong, balasan adalah sapaan generik yang tetap sopan.
 * 3. SELALU menyertakan satu tool call `tag_contact {tag:'ai-lead'}` agar
 *    jalur eksekusi tool runtime terbukti hidup di semua lingkungan.
 *    Mock TIDAK pernah memanggil handoff/stage — kedua tool itu dibuktikan
 *    lewat uji integrasi executor tool di core (lihat
 *    apps/worker/scripts/verify-agent-tools.ts).
 * 4. Usage token adalah estimasi deterministik (panjang karakter / 4),
 *    BUKAN angka dari provider — dicatat apa adanya sebagai provider
 *    'mock' dengan biaya model 0.
 *
 * Deterministik murni: input yang sama → output yang sama, tanpa jam/RNG.
 */

const MOCK_MODEL = "mock-1";

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  const sentence = (match ? match[0] : trimmed).trim();
  return sentence.endsWith(".") || sentence.endsWith("!") || sentence.endsWith("?")
    ? sentence
    : `${sentence}.`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const chunks = (request.kbChunks ?? []).filter((c) => c.trim().length > 0);
    const text =
      chunks.length > 0
        ? `Halo! Berdasarkan informasi yang kami punya: ${firstSentence(chunks[0])}`
        : "Halo! Terima kasih sudah menghubungi kami. Silakan tanya apa saja seputar produk kami — saya bantu jawab.";

    const toolCalls: LlmToolCall[] = [
      {
        id: "mock-call-1",
        name: "tag_contact",
        arguments: { tag: "ai-lead" },
      },
    ];

    const inputText =
      request.system +
      request.messages.map((m) => m.content).join("\n") +
      chunks.join("\n");
    return {
      text,
      toolCalls,
      usage: {
        tokensIn: estimateTokens(inputText),
        tokensOut: estimateTokens(text),
      },
      model: MOCK_MODEL,
      provider: this.name,
    };
  }
}
