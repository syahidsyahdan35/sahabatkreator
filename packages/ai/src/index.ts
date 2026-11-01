/**
 * @sahabat-kreator/ai — runtime LLM Sahabat Kreator (Fase 3A).
 *
 * Isi: kontrak provider (`types.ts`), definisi tool agent (`tools.ts`),
 * MockProvider deterministik (default dev/test/staging), dan
 * OpenRouterProvider untuk model sungguhan. Loop agent-nya sendiri
 * (konteks, retrieval, eksekusi tool, metering) hidup di
 * @sahabat-kreator/core (`agent-runtime.ts`) agar transport-agnostic —
 * paket ini murni soal "bicara ke model".
 */
export {
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResult,
  type LlmProvider,
  type LlmToolCall,
  type LlmToolDefinition,
  type LlmToolParameterProperty,
  type LlmUsage,
} from "./types";
export {
  AGENT_TOOLS,
  PIPELINE_STAGES,
  isPipelineStage,
  type PipelineStage,
} from "./tools";
export { MockProvider } from "./mock";
export { OpenRouterProvider, type OpenRouterProviderOptions } from "./openrouter";

import { MockProvider } from "./mock";
import { OpenRouterProvider } from "./openrouter";
import type { LlmProvider } from "./types";

export interface CreateLlmProviderOptions {
  /** Nilai env LLM_PROVIDER: 'mock' (default) | 'openrouter'. */
  provider?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
}

/**
 * Memilih provider dari konfigurasi env. 'openrouter' tanpa API key adalah
 * kesalahan konfigurasi yang disengaja dibuat GAGAL CEPAT (fail-fast di
 * proses worker) — diam-diam jatuh ke mock akan menyembunyikan fakta bahwa
 * staging tidak memakai model sungguhan.
 */
export function createLlmProvider(options: CreateLlmProviderOptions): LlmProvider {
  if (options.provider === "openrouter") {
    if (!options.openrouterApiKey) {
      throw new Error(
        "LLM_PROVIDER=openrouter tetapi OPENROUTER_API_KEY tidak tersedia di env",
      );
    }
    return new OpenRouterProvider({
      apiKey: options.openrouterApiKey,
      defaultModel: options.openrouterModel,
    });
  }
  return new MockProvider();
}
