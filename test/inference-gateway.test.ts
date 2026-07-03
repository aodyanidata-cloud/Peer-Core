import { describe, it, expect } from 'vitest';
import { InferenceGateway } from '../src/modules/inference-gateway/inference-gateway.service';
import { EchoProvider } from '../src/modules/inference-gateway/echo-provider';
import type {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  InferenceProvider,
} from '../src/modules/inference-gateway/types';

/** A provider that counts how many times it is actually called. */
class CountingProvider implements InferenceProvider {
  calls = 0;
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.calls += 1;
    return { text: 'x', model: req.model ?? 'count' };
  }
  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return { vectors: req.input.map(() => [0]), model: 'count' };
  }
}

const req: CompletionRequest = {
  messages: [{ role: 'user', content: 'hello' }],
};

describe('inference gateway (B5)', () => {
  it('routes completions through the configured provider', async () => {
    const gw = new InferenceGateway(new EchoProvider());
    const res = await gw.complete(req);
    expect(res.text).toBe('echo: hello');
  });

  it('caches identical requests: the provider is called once', async () => {
    const provider = new CountingProvider();
    const gw = new InferenceGateway(provider);
    await gw.complete(req);
    await gw.complete(req);
    expect(provider.calls).toBe(1);
    expect(gw.providerCompletionCalls).toBe(1);
  });

  it('cache can be bypassed per request', async () => {
    const provider = new CountingProvider();
    const gw = new InferenceGateway(provider);
    await gw.complete(req, { cache: false });
    await gw.complete(req, { cache: false });
    expect(provider.calls).toBe(2);
  });

  it('swapping the provider swaps behaviour with no call-site change', async () => {
    const echo = new InferenceGateway(new EchoProvider());
    const counting = new InferenceGateway(new CountingProvider());
    expect((await echo.complete(req)).text).toBe('echo: hello');
    expect((await counting.complete(req)).text).toBe('x');
  });

  it('produces deterministic embeddings of a fixed dimension', async () => {
    const gw = new InferenceGateway(new EchoProvider());
    const a = await gw.embed({ input: ['menu', 'hours'] });
    const b = await gw.embed({ input: ['menu', 'hours'] });
    expect(a.vectors).toHaveLength(2);
    expect(a.vectors[0]).toHaveLength(8);
    expect(a).toEqual(b);
  });
});
