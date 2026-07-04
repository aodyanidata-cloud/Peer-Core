import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  Header,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../../modules/identity/auth.guard';
import { AuthService } from '../../modules/identity/auth.service';
import { OrderService } from './order.service';
import type { OrderStatus } from './order-state';
import { RestaurantService, type BranchPatch } from './restaurant.service';
import { MenuService, type NewMenuItem } from './menu.service';
import { MenuSyncService } from './menu-sync.service';
import { PromotionService } from './promotion.service';
import { LoyaltyService } from './loyalty.service';
import { ReviewService } from './review.service';
import { ComplaintService, type ComplaintStatus } from './complaint.service';
import { DeliveryService, type DeliveryStatus } from './delivery.service';
import { DriverDirectoryService } from './driver-directory.service';

/**
 * StaffController — the merchant/staff console API (auth-guarded). The tenant is
 * derived from the authenticated user's DB membership (owner|staff), never from
 * the client, closing the auth → tenant loop over HTTP. Every management action
 * a merchant performs — menu, branches, promotions, loyalty, reviews, complaints,
 * delivery, drivers — is reachable here behind the same guard. The console HTML
 * shell itself is public; every action it calls goes through the guard.
 */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly orders: OrderService,
    private readonly auth: AuthService,
    private readonly restaurants: RestaurantService,
    private readonly menu: MenuService,
    private readonly menuSync: MenuSyncService,
    private readonly promotions: PromotionService,
    private readonly loyalty: LoyaltyService,
    private readonly reviews: ReviewService,
    private readonly complaints: ComplaintService,
    private readonly deliveries: DeliveryService,
    private readonly drivers: DriverDirectoryService,
  ) {}

  private tenantOf(req: AuthedRequest): string {
    const ctx = req.authCtx!;
    const membership = ctx.memberships[0];
    if (!membership) throw new ForbiddenException('no tenant membership');
    return this.auth.authorizeTenant(ctx, membership.tenantId, ['owner', 'staff']);
  }

  // ── Order queue ──────────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('orders')
  queue(@Req() req: AuthedRequest) {
    return this.orders.queue(this.tenantOf(req));
  }

  @UseGuards(AuthGuard)
  @Post('orders/:id/accept')
  accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.accept(this.tenantOf(req), id);
  }

  @UseGuards(AuthGuard)
  @Post('orders/:id/reject')
  reject(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.reject(this.tenantOf(req), id);
  }

  @UseGuards(AuthGuard)
  @Post('orders/:id/advance')
  advance(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { to: OrderStatus },
  ) {
    return this.orders.advance(this.tenantOf(req), id, body.to);
  }

  // ── Branches ─────────────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('branches')
  listBranches(@Req() req: AuthedRequest) {
    return this.restaurants.listBranches(this.tenantOf(req));
  }

  @UseGuards(AuthGuard)
  @Post('branches')
  createBranch(
    @Req() req: AuthedRequest,
    @Body() body: { name: string; address?: string; phone?: string; minOrderMinor?: number; hours?: Record<string, [string, string][]> },
  ) {
    return this.restaurants.createBranch(this.tenantOf(req), body);
  }

  @UseGuards(AuthGuard)
  @Patch('branches/:id')
  updateBranch(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: BranchPatch,
  ) {
    return this.restaurants.updateBranch(this.tenantOf(req), id, body);
  }

  // ── Menu management ──────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Post('menu/items')
  createItem(@Req() req: AuthedRequest, @Body() body: NewMenuItem) {
    return this.menu.createItem(this.tenantOf(req), body);
  }

  @UseGuards(AuthGuard)
  @Post('menu/items/:id/sold-out')
  setSoldOut(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { soldOut: boolean },
  ) {
    return this.menu.setSoldOut(this.tenantOf(req), id, body.soldOut);
  }

  @UseGuards(AuthGuard)
  @Post('menu/sync')
  async syncMenu(@Req() req: AuthedRequest) {
    const indexed = await this.menuSync.syncAll(this.tenantOf(req));
    return { indexed };
  }

  // ── Promotions ───────────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('promotions')
  listPromotions(@Req() req: AuthedRequest) {
    return this.promotions.list(this.tenantOf(req));
  }

  @UseGuards(AuthGuard)
  @Post('promotions')
  createPromotion(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      code: string;
      kind: 'percent' | 'amount';
      value: number;
      minOrderMinor?: number;
      maxRedemptions?: number;
    },
  ) {
    return this.promotions.create(this.tenantOf(req), body);
  }

  @UseGuards(AuthGuard)
  @Post('promotions/:id/deactivate')
  deactivatePromotion(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.promotions.deactivate(this.tenantOf(req), id);
  }

  // ── Loyalty (read side) ──────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('loyalty/:phone')
  async loyaltyOf(@Req() req: AuthedRequest, @Param('phone') phone: string) {
    const tenantId = this.tenantOf(req);
    const [balance, history] = await Promise.all([
      this.loyalty.balance(tenantId, phone),
      this.loyalty.history(tenantId, phone),
    ]);
    return { phone, balance, history };
  }

  // ── Reviews ──────────────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('reviews/summary')
  reviewSummary(@Req() req: AuthedRequest) {
    return this.reviews.summary(this.tenantOf(req));
  }

  // ── Complaints ───────────────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('complaints')
  listComplaints(@Req() req: AuthedRequest) {
    return this.complaints.listOpen(this.tenantOf(req));
  }

  @UseGuards(AuthGuard)
  @Post('complaints/:id/status')
  setComplaintStatus(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { status: ComplaintStatus },
  ) {
    return this.complaints.setStatus(this.tenantOf(req), id, body.status);
  }

  // ── Delivery + driver ledger ─────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Post('orders/:id/delivery')
  assignDelivery(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { driverName: string; driverPhone: string; earningMinor: number },
  ) {
    return this.deliveries.assign(
      this.tenantOf(req),
      id,
      { name: body.driverName, phone: body.driverPhone },
      body.earningMinor,
    );
  }

  @UseGuards(AuthGuard)
  @Post('deliveries/:id/status')
  setDeliveryStatus(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { status: DeliveryStatus },
  ) {
    return this.deliveries.setStatus(this.tenantOf(req), id, body.status);
  }

  @UseGuards(AuthGuard)
  @Get('drivers/:phone/owed')
  async driverOwed(@Req() req: AuthedRequest, @Param('phone') phone: string) {
    const owedMinor = await this.deliveries.owed(this.tenantOf(req), phone);
    return { driverPhone: phone, owedMinor };
  }

  @UseGuards(AuthGuard)
  @Post('drivers/:phone/settle')
  async settleDriver(@Req() req: AuthedRequest, @Param('phone') phone: string) {
    await this.deliveries.settle(this.tenantOf(req), phone, new Date());
    return { driverPhone: phone, settled: true };
  }

  // ── Driver directory (off-platform discovery) ────────────────────────────
  @UseGuards(AuthGuard)
  @Get('driver-directory')
  listDriverDirectory(@Req() req: AuthedRequest, @Query('area') area?: string) {
    return this.drivers.list(this.tenantOf(req), area);
  }

  @UseGuards(AuthGuard)
  @Post('driver-directory')
  addDriverListing(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name: string;
      phone: string;
      areas?: string;
      vehicleType?: string;
      rateNote?: string;
    },
  ) {
    return this.drivers.add(this.tenantOf(req), body);
  }

  @Get('console')
  @Header('Content-Type', 'text/html; charset=utf-8')
  console(): string {
    return CONSOLE_HTML;
  }
}

const CONSOLE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Peers — Staff Console</title>
<style>
  :root{--bg:#0f1720;--card:#182430;--ink:#eef3f8;--muted:#93a4b5;--brand:#1db584;--warn:#e0b341;--line:#243444}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:760px;margin:0 auto;padding:20px}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
  h1{font-size:20px;margin:0}
  .badge{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
  .tokrow{display:flex;gap:8px;margin-bottom:18px}
  input{flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
  button{border:0;border-radius:10px;padding:9px 14px;font-weight:600;cursor:pointer;background:var(--brand);color:#062017}
  button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  .order{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .status{font-size:12px;font-weight:700;padding:5px 9px;border-radius:8px;background:rgba(224,179,65,.16);color:var(--warn)}
  .total{color:var(--brand);font-weight:700}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .muted{color:var(--muted);font-size:13px;margin-top:4px}
  .empty{color:var(--muted);text-align:center;padding:40px}
</style>
<body><div class="wrap">
  <header><h1>Staff Console</h1><span class="badge">Peers · Order queue</span></header>
  <div class="tokrow">
    <input id="tok" placeholder="Paste staff session token…" autocomplete="off">
    <button onclick="load()">Load queue</button>
  </div>
  <div id="out"><div class="empty">Enter a session token and load the queue.</div></div>
</div>
<script>
const NEXT = { NEW:['accept','reject'], ACCEPTED:['PREPARING'], PREPARING:['READY'], READY:['OUT_FOR_DELIVERY','PICKED_UP'], OUT_FOR_DELIVERY:['DELIVERED'], DELIVERED:['COMPLETE'], PICKED_UP:['COMPLETE'] };
function hdr(){ return { 'Authorization':'Bearer '+document.getElementById('tok').value.trim(), 'Content-Type':'application/json' }; }
function money(m,c){ return (m/100).toFixed(2)+' '+c; }
async function act(id, verb){
  const url = verb==='accept'||verb==='reject' ? '/api/v1/staff/orders/'+id+'/'+verb : '/api/v1/staff/orders/'+id+'/advance';
  await fetch(url, { method:'POST', headers:hdr(), body: verb==='accept'||verb==='reject' ? undefined : JSON.stringify({to:verb}) });
  load();
}
async function load(){
  const r = await fetch('/api/v1/staff/orders', { headers: hdr() });
  const out = document.getElementById('out');
  if(!r.ok){ out.innerHTML='<div class="empty">Not authorized — check the token.</div>'; return; }
  const orders = await r.json();
  if(!orders.length){ out.innerHTML='<div class="empty">No open orders.</div>'; return; }
  out.innerHTML = orders.map(o=>{
    const acts = (NEXT[o.status]||[]).map(v=>{
      const label = v==='accept'?'Accept':v==='reject'?'Reject':v.replace(/_/g,' ');
      const cls = v==='reject'?'ghost':'';
      return '<button class="'+cls+'" onclick="act(\\''+o.id+'\\',\\''+v+'\\')">'+label+'</button>';
    }).join('');
    return '<div class="order"><div class="row"><div><strong>#'+o.id.slice(0,8)+'</strong>'
      +'<div class="muted">'+o.orderType+' · payment '+o.paymentStatus+'</div></div>'
      +'<div style="text-align:right"><div class="status">'+o.status+'</div>'
      +'<div class="total">'+money(o.totalMinor,o.currency)+'</div></div></div>'
      +'<div class="actions">'+(acts||'<span class="muted">—</span>')+'</div></div>';
  }).join('');
}
</script></body></html>`;
