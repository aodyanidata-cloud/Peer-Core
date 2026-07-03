import { Injectable } from '@nestjs/common';
import { InferenceGateway } from '../inference-gateway/inference-gateway.service';
import { KbService } from './kb.service';
import type { Message } from '../inference-gateway/types';

export interface AgentReply {
  text: string;
  sources: string[]; // ids of the KB documents used as context
}

/**
 * ConversationService — RAG orchestration (B6). Retrieves the tenant's own
 * relevant knowledge, builds a lean context (only the retrieved snippets), and
 * asks the model via the gateway. It never lets the model act — actions go
 * through the tool dispatcher (B4).
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly kb: KbService,
    private readonly inference: InferenceGateway,
  ) {}

  async reply(tenantId: string, message: string, k = 3): Promise<AgentReply> {
    const hits = await this.kb.search(tenantId, message, k);
    const context = hits.map((h) => `- ${h.title}: ${h.content}`).join('\n');

    const messages: Message[] = [
      {
        role: 'system',
        content:
          'Answer only from the provided knowledge. If it is not there, say you do not know. ' +
          'Never invent facts, prices, or availability.\n\nKnowledge:\n' +
          (context || '(none)'),
      },
      { role: 'user', content: message },
    ];

    const res = await this.inference.complete({ messages });
    return { text: res.text, sources: hits.map((h) => h.id) };
  }
}
