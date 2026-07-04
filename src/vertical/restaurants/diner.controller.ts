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
  BadRequestException,
} from '@nestjs/common';
import { TenantResolver } from './tenant-resolver';
import { DinerAgentService } from './diner-agent.service';
import { FaqService } from './faq.service';
import { ReservationService } from './reservation.service';
import { OrderService, type CheckoutLine } from './order.service';
import { ComplaintService } from './complaint.service';
import { ReviewService } from './review.service';
import { CartService } from './cart.service';

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
    private readonly orders: OrderService,
    private readonly complaints: ComplaintService,
    private readonly reviews: ReviewService,
    private readonly carts: CartService,
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

  @Post('orders')
  async placeOrder(
    @Param('slug') slug: string,
    @Body()
    body: {
      branchId: string;
      orderType?: 'delivery' | 'pickup' | 'dinein';
      lines: CheckoutLine[];
      dinerPhone?: string;
      idempotencyKey?: string;
    },
  ) {
    if (!body.idempotencyKey) {
      throw new BadRequestException('idempotencyKey is required');
    }
    const tenantId = await this.resolve(slug);
    return this.orders.checkout(tenantId, {
      branchId: body.branchId,
      orderType: body.orderType ?? 'pickup',
      lines: body.lines,
      idempotencyKey: body.idempotencyKey,
      ...(body.dinerPhone !== undefined ? { dinerPhone: body.dinerPhone } : {}),
    });
  }

  @Get('orders/:orderId')
  async trackOrder(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
  ) {
    const tracking = await this.orders.getOrder(await this.resolve(slug), orderId);
    if (!tracking) throw new NotFoundException('unknown order');
    return tracking;
  }

  @Post('complaints')
  async submitComplaint(
    @Param('slug') slug: string,
    @Body()
    body: { subject: string; body: string; branchId?: string; dinerPhone?: string },
  ) {
    if (!body.subject || !body.body) {
      throw new BadRequestException('subject and body are required');
    }
    const tenantId = await this.resolve(slug);
    return this.complaints.capture(tenantId, {
      subject: body.subject,
      body: body.body,
      ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
      ...(body.dinerPhone !== undefined ? { dinerPhone: body.dinerPhone } : {}),
    });
  }

  @Post('reviews')
  async submitReview(
    @Param('slug') slug: string,
    @Body() body: { orderId: string; rating: number; comment?: string },
  ) {
    if (!body.orderId) throw new BadRequestException('orderId is required');
    const tenantId = await this.resolve(slug);
    return this.reviews.submit(tenantId, {
      orderId: body.orderId,
      rating: body.rating,
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
  }

  // ── Persistent cart (server-side quote is authoritative) ───────────────────
  @Post('carts')
  async createCart(
    @Param('slug') slug: string,
    @Body() body: { branchId: string },
  ) {
    if (!body.branchId) throw new BadRequestException('branchId is required');
    return this.carts.createCart(await this.resolve(slug), body.branchId);
  }

  @Post('carts/:cartId/items')
  async addToCart(
    @Param('slug') slug: string,
    @Param('cartId') cartId: string,
    @Body() body: CheckoutLine,
  ) {
    return this.carts.addItem(await this.resolve(slug), cartId, body);
  }

  @Get('carts/:cartId/quote')
  async cartQuote(
    @Param('slug') slug: string,
    @Param('cartId') cartId: string,
    @Query('deliveryFeeMinor') deliveryFeeMinor = '0',
  ) {
    return this.carts.quote(
      await this.resolve(slug),
      cartId,
      Number(deliveryFeeMinor) || 0,
    );
  }

  @Post('carts/:cartId/checkout')
  async checkoutCart(
    @Param('slug') slug: string,
    @Param('cartId') cartId: string,
    @Body()
    body: {
      branchId: string;
      orderType?: 'delivery' | 'pickup' | 'dinein';
      dinerPhone?: string;
      idempotencyKey?: string;
      deliveryFeeMinor?: number;
    },
  ) {
    if (!body.idempotencyKey) {
      throw new BadRequestException('idempotencyKey is required');
    }
    return this.carts.checkout(await this.resolve(slug), cartId, {
      branchId: body.branchId,
      orderType: body.orderType ?? 'pickup',
      idempotencyKey: body.idempotencyKey,
      ...(body.dinerPhone !== undefined ? { dinerPhone: body.dinerPhone } : {}),
      ...(body.deliveryFeeMinor !== undefined
        ? { deliveryFeeMinor: body.deliveryFeeMinor }
        : {}),
    });
  }

  @Get('widget')
  @Header('Content-Type', 'text/html; charset=utf-8')
  widget(@Param('slug') slug: string): string {
    // Self-contained visual-first diner widget: fetches this tenant's menu from
    // the API above. No external assets (CSP-safe, works offline of any CDN).
    return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Menu</title>
<style>
  :root{--bg:#0f1720;--card:#182430;--ink:#eef3f8;--muted:#93a4b5;--brand:#1db584;--line:#243444}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
  header{padding:28px 20px 18px;background:linear-gradient(135deg,#123a30,#0f1720)}
  .brandrow{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--brand)}
  h1{margin:6px 0 2px;font-size:26px}
  .sub{color:var(--muted);font-size:14px}
  .search{padding:14px 20px;position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line)}
  .search input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:15px}
  .search input::placeholder{color:var(--muted)}
  ul{list-style:none;margin:0;padding:12px 16px 24px;display:flex;flex-direction:column;gap:10px;flex:1}
  li{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .name{font-weight:600;font-size:15px}
  .price{background:rgba(29,181,132,.14);color:var(--brand);font-weight:700;font-size:14px;padding:6px 10px;border-radius:10px;white-space:nowrap}
  .empty{color:var(--muted);text-align:center;padding:30px}
  footer{padding:14px 20px 22px;color:var(--muted);font-size:12px;text-align:center;border-top:1px solid var(--line)}
</style>
<body><div class="wrap">
  <header>
    <div class="brandrow"><span class="dot"></span><span>Order &amp; reserve</span></div>
    <h1 id="title">Restaurant</h1>
    <div class="sub">Browse the menu, ask the agent, or book a table.</div>
  </header>
  <div class="search"><input id="q" placeholder="Search the menu…" autocomplete="off"></div>
  <ul id="out"></ul>
  <footer>Powered by <strong>Peers</strong></footer>
</div>
<script>
const slug=${JSON.stringify(slug)};
document.getElementById('title').textContent =
  slug.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
function money(m,c){return (m/100).toLocaleString(undefined,{minimumFractionDigits:2})+' '+c}
async function load(q){
  const r=await fetch('/api/v1/r/'+encodeURIComponent(slug)+'/menu?q='+encodeURIComponent(q||''));
  const items=await r.json();
  document.getElementById('out').innerHTML = items.length
    ? items.map(i=>'<li><span class="name">'+i.name+'</span><span class="price">'+money(i.priceMinor,i.currency)+'</span></li>').join('')
    : '<div class="empty">No items match that search.</div>';
}
document.getElementById('q').addEventListener('input',e=>load(e.target.value));
load('');
</script></body></html>`;
  }
}
