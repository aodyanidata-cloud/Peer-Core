import { Injectable } from '@nestjs/common';
import * as schema from '../../db/schema';
import { TenancyService } from '../tenancy/tenancy.service';
import { InferenceGateway } from '../inference-gateway/inference-gateway.service';

export interface Retrieved {
  id: string;
  title: string;
  content: string;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * KbService — tenant knowledge base for RAG (B6). Indexing and retrieval both run
 * inside the tenant RLS context, so an agent only ever sees ITS tenant's
 * knowledge. Embeddings come from the inference gateway (never a direct SDK call).
 */
@Injectable()
export class KbService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly inference: InferenceGateway,
  ) {}

  async addDocument(
    tenantId: string,
    doc: { title: string; content: string; source?: string },
  ) {
    const { vectors } = await this.inference.embed({ input: [doc.content] });
    return this.tenancy.runAs(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.kbDocuments)
        .values({
          tenantId,
          title: doc.title,
          content: doc.content,
          source: doc.source ?? 'manual',
          embedding: vectors[0],
        })
        .returning({ id: schema.kbDocuments.id });
      return row;
    });
  }

  /** Top-k most similar documents for `query`, scoped to `tenantId` by RLS. */
  async search(tenantId: string, query: string, k = 3): Promise<Retrieved[]> {
    const { vectors } = await this.inference.embed({ input: [query] });
    const q = vectors[0];
    const docs = await this.tenancy.runAs(tenantId, (tx) =>
      tx.select().from(schema.kbDocuments),
    );
    return docs
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        score: cosine(q, doc.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
