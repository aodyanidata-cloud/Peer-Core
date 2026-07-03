export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResponse {
  text: string;
  model: string;
  usage?: Usage;
}

export interface EmbeddingRequest {
  input: string[];
  model?: string;
}

export interface EmbeddingResponse {
  vectors: number[][];
  model: string;
}

/**
 * InferenceProvider — the contract every model backend implements (vLLM/Jais,
 * a hosted per-token API, etc.). The gateway is the ONLY caller; nothing else in
 * the codebase imports a model SDK (enforced by scripts/fitness/gateway-check.sh).
 */
export interface InferenceProvider {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export const INFERENCE_PROVIDER = Symbol('INFERENCE_PROVIDER');
