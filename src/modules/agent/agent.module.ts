import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InferenceGatewayModule } from '../inference-gateway/inference-gateway.module';
import { KbService } from './kb.service';
import { ConversationService } from './conversation.service';

/**
 * AgentModule
 * Conversation orchestration + RAG over a tenant knowledge base (B6). The model
 * proposes; it never authorizes actions (those go through the tool dispatcher).
 */
@Module({
  imports: [TenancyModule, InferenceGatewayModule],
  providers: [KbService, ConversationService],
  exports: [KbService, ConversationService],
})
export class AgentModule {}
