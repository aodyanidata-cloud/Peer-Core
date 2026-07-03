import {
  Controller,
  Get,
  Post,
  Param,
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

/**
 * StaffController — the merchant/staff console API (auth-guarded). The tenant is
 * derived from the authenticated user's DB membership (owner|staff), never from
 * the client, closing the auth → tenant loop over HTTP. The console HTML shell
 * itself is public; every action it calls goes through the guard.
 */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly orders: OrderService,
    private readonly auth: AuthService,
  ) {}

  private tenantOf(req: AuthedRequest): string {
    const ctx = req.authCtx!;
    const membership = ctx.memberships[0];
    if (!membership) throw new ForbiddenException('no tenant membership');
    return this.auth.authorizeTenant(ctx, membership.tenantId, ['owner', 'staff']);
  }

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
