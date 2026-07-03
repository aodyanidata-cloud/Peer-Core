import { createHash } from 'node:crypto';
import type {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  InferenceProvider,
} from './types';

export interface CompleteOptions {
  /** Exact-match response cache (prompt caching). Default true. */
  cache?: boolean;
}

/**
 * InferenceGateway — the single seam for all model calls (B5).
 *
 * Everything that needs the model calls the gateway; the gateway calls the
 * configured provider. This keeps the model behind one contract (swap providers
 * by config, never touching call sites) and gives one place for cross-cutting
 * concerns: an exact-match prompt cache today, usage/cost accounting and semantic
 * caching later.
 */
export class InferenceGateway {
  private readonly cache = new Map<string, CompletionResponse>();
  private completionCalls = 0;

  constructor(private readonly provider: InferenceProvider) {}

  async complete(
    req: CompletionRequest,
    opts: CompleteOptions = {},
  ): Promise<CompletionResponse> {
    const useCache = opts.cache ?? true;
    const key = createHash('sha256').update(JSON.stringify(req)).digest('hex');
    if (useCache) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }
    this.completionCalls += 1;
    const res = await this.provider.complete(req);
    if (useCache) this.cache.set(key, res);
    return res;
  }

  embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.provider.embed(req);
  }

  /** Number of times the underlying provider's complete() was actually invoked. */
  get providerCompletionCalls(): number {
    return this.completionCalls;
  }
}
