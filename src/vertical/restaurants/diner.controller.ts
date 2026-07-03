import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Header,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { TenantResolver } from './tenant-resolver';
import { DinerAgentService } from './diner-agent.service';
import { FaqService } from './faq.service';
import { ReservationService } from './reservation.service';

interface BookBody {
  branchId: string;
  partySize: number;
  startsAt: string; // ISO
  durationMin?: number;
  dinerName?: string;
  dinerPhone?: string;
}

/**
 * DinerController — the diner-facing web widget surface (R1.12). Public storefront:
 * the tenant is resolved from the merchant slug in the URL (server-side lookup),
 * never from a client-supplied tenant id. Read-only browsing + reservation booking
 * (no payment — this is R1).
 */
@Controller('r/:slug')
export class DinerController {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly agent: DinerAgentService,
    private readonly faq: FaqService,
    private readonly reservations: ReservationService,
  ) {}

  private async resolve(slug: string): Promise<string> {
    const id = await this.resolver.bySlug(slug);
    if (!id) throw new NotFoundException('unknown restaurant');
    return id;
  }

  @Get('menu')
  async menu(@Param('slug') slug: string, @Query('q') q = '') {
    return this.agent.searchMenu(await this.resolve(slug), q);
  }

  @Get('items/:itemId')
  async item(@Param('slug') slug: string, @Param('itemId') itemId: string) {
    const facts = await this.agent.itemFacts(await this.resolve(slug), itemId);
    if (!facts) throw new NotFoundException('unknown item');
    return facts;
  }

  @Get('branches/:branchId/info')
  async branchInfo(
    @Param('slug') slug: string,
    @Param('branchId') branchId: string,
  ) {
    const info = await this.faq.branchInfo(await this.resolve(slug), branchId);
    if (!info) throw new NotFoundException('unknown branch');
    return info;
  }

  @Post('reservations')
  async book(@Param('slug') slug: string, @Body() body: BookBody) {
    const tenantId = await this.resolve(slug);
    const startsAt = new Date(body.startsAt);
    const durationMin = body.durationMin ?? 90;
    const table = await this.reservations.findAvailableTable(
      tenantId,
      body.branchId,
      body.partySize,
      startsAt,
      durationMin,
    );
    if (!table) {
      throw new ConflictException('no table available for that time');
    }
    return this.reservations.book(tenantId, {
      branchId: body.branchId,
      tableId: table.id,
      partySize: body.partySize,
      startsAt,
      durationMin,
      ...(body.dinerName !== undefined ? { dinerName: body.dinerName } : {}),
      ...(body.dinerPhone !== undefined ? { dinerPhone: body.dinerPhone } : {}),
    });
  }

  @Get('widget')
  @Header('Content-Type', 'text/html; charset=utf-8')
  widget(@Param('slug') slug: string): string {
    // Minimal self-contained widget: fetches this tenant's menu from the API above.
    return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Menu</title>
<body style="font-family:system-ui;max-width:640px;margin:2rem auto;padding:0 1rem">
<h1>Menu</h1>
<input id="q" placeholder="Search the menu…" style="width:100%;padding:.6rem;font-size:1rem">
<ul id="out"></ul>
<script>
const slug=${JSON.stringify(slug)};
async function load(q){
  const r=await fetch('/api/v1/r/'+encodeURIComponent(slug)+'/menu?q='+encodeURIComponent(q||''));
  const items=await r.json();
  document.getElementById('out').innerHTML =
    items.map(i=>'<li>'+i.name+' — '+(i.priceMinor/100).toFixed(2)+' '+i.currency+'</li>').join('')
    || '<li>No items found.</li>';
}
document.getElementById('q').addEventListener('input',e=>load(e.target.value));
load('');
</script></body></html>`;
  }
}
