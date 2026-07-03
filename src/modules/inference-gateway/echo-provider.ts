import { createHash } from 'node:crypto';
import type {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  InferenceProvider,
} from './types';

const EMBED_DIM = 8;

/**
 * EchoProvider — a deterministic, offline stand-in provider. It lets the whole
 * agent/RAG stack run and be tested without a live model. A real provider (vLLM
 * serving Jais/Qwen, or a hosted per-token API) is registered by config in a
 * later task; nothing else changes because everything goes through the gateway.
 */
export class EchoProvider implements InferenceProvider {
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const text = `echo: ${lastUser?.content ?? ''}`;
    return {
      text,
      model: req.model ?? 'echo',
      usage: {
        inputTokens: req.messages.reduce((n, m) => n + m.content.length, 0),
        outputTokens: text.length,
      },
    };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const vectors = req.input.map((s) => {
      const h = createHash('sha256').update(s).digest();
      return Array.from({ length: EMBED_DIM }, (_, i) => h[i] / 255);
    });
    return { vectors, model: req.model ?? 'echo-embed' };
  }
}
