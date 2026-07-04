import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { AdminGuard } from '../../modules/identity/admin.guard';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { OnboardingService } from './onboarding.service';

/**
 * AdminController — the platform super-admin portal (guarded by AdminGuard: a
 * valid session AND platform_admins membership). Oversees every restaurant,
 * the active payment provider, and the verticals. Tenant rows are admin-plane
 * (no RLS), so they are read/written directly here. Creating a restaurant is
 * done through the same OnboardingService the rest of the app uses.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly onboarding: OnboardingService) {}

  @UseGuards(AdminGuard)
  @Get('overview')
  async overview() {
    const db = getDb();
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
    return {
      verticals: [{ key: 'restaurants', label: 'Restaurants', status: 'live' }],
      paymentProvider: process.env.MOYASAR_SECRET_KEY ? 'moyasar' : 'fake',
      paymentConfigured: Boolean(process.env.MOYASAR_SECRET_KEY),
      tenantCount: tenants.length,
    };
  }

  @UseGuards(AdminGuard)
  @Get('tenants')
  listTenants() {
    return getDb()
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        name: schema.tenants.name,
        status: schema.tenants.status,
        createdAt: schema.tenants.createdAt,
      })
      .from(schema.tenants)
      .orderBy(desc(schema.tenants.createdAt));
  }

  @UseGuards(AdminGuard)
  @Post('tenants')
  async createTenant(
    @Body()
    body: { name?: string; slug?: string; ownerPhone?: string; branchName?: string },
  ) {
    if (!body.name || !body.slug || !body.ownerPhone) {
      throw new BadRequestException('name, slug and ownerPhone are required');
    }
    return this.onboarding.onboard({
      name: body.name,
      slug: body.slug,
      ownerPhone: body.ownerPhone,
      branchName: body.branchName ?? 'Main',
    });
  }

  @UseGuards(AdminGuard)
  @Post('tenants/:id/status')
  async setTenantStatus(
    @Param('id') id: string,
    @Body() body: { status?: 'active' | 'suspended' },
  ) {
    if (body.status !== 'active' && body.status !== 'suspended') {
      throw new BadRequestException("status must be 'active' or 'suspended'");
    }
    const [row] = await getDb()
      .update(schema.tenants)
      .set({ status: body.status })
      .where(eq(schema.tenants.id, id))
      .returning({ id: schema.tenants.id, status: schema.tenants.status });
    return row ?? { id, status: body.status };
  }

  @Get('console')
  @Header('Content-Type', 'text/html; charset=utf-8')
  console(): string {
    return ADMIN_HTML;
  }
}

const ADMIN_HTML = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Peers — Admin</title>
<style>
  :root{--bg:#0f1720;--card:#182430;--ink:#eef3f8;--muted:#93a4b5;--brand:#1db584;--warn:#e0b341;--bad:#e0574b;--line:#243444}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
  h1{font-size:22px;margin:0}
  .badge{color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  .who{color:var(--muted);font-size:13px;margin-bottom:18px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:22px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
  .kpi .n{font-size:24px;font-weight:800;color:var(--brand)}
  .kpi .l{color:var(--muted);font-size:12px;margin-top:4px}
  h2{font-size:15px;margin:20px 0 10px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);font-size:14px}
  th{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  tr:last-child td{border-bottom:0}
  .pill{font-size:12px;font-weight:700;padding:3px 9px;border-radius:8px}
  .active{background:rgba(29,181,132,.16);color:var(--brand)}
  .suspended{background:rgba(224,87,75,.16);color:var(--bad)}
  button{border:0;border-radius:9px;padding:7px 12px;font-weight:600;cursor:pointer;background:var(--brand);color:#062017;font-size:13px}
  button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  .form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end}
  .form label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .form input{width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:#0f1720;color:var(--ink)}
  .msg{color:var(--muted);font-size:13px;min-height:18px;margin-top:8px}
  a{color:var(--brand)}
  .empty{color:var(--muted);padding:20px;text-align:center}
</style>
<body><div class="wrap">
  <header><h1>Admin</h1><span class="badge">Peers · Platform control</span></header>
  <div class="who" id="who">Checking your session…</div>

  <div class="cards" id="kpis"></div>

  <h2>Create a restaurant</h2>
  <div class="form">
    <div><label>Name</label><input id="f_name" placeholder="Demo Grill"></div>
    <div><label>Slug</label><input id="f_slug" placeholder="demo-grill"></div>
    <div><label>Owner phone</label><input id="f_phone" placeholder="+9665xxxxxxxx"></div>
    <div><label>Branch</label><input id="f_branch" placeholder="Main"></div>
    <div><button onclick="createTenant()">Create</button></div>
  </div>
  <div class="msg" id="msg"></div>

  <h2>Restaurants</h2>
  <div id="tenants"></div>
</div>
<script>
const API='/api/v1/admin';
const tok=()=>localStorage.getItem('peers_token');
const hdr=()=>({'Authorization':'Bearer '+(tok()||''),'Content-Type':'application/json'});
const msg=(t)=>document.getElementById('msg').textContent=t;

async function guard(){
  if(!tok()){ location.href='/api/v1/auth/login'; return false; }
  return true;
}
async function loadOverview(){
  const r=await fetch(API+'/overview',{headers:hdr()});
  if(r.status===401){ location.href='/api/v1/auth/login'; return; }
  if(r.status===403){ document.getElementById('who').innerHTML='This account is not a platform admin. <a href="/api/v1/auth/login">Sign in as admin</a>.'; return; }
  const o=await r.json();
  document.getElementById('who').textContent='Signed in as platform admin.';
  document.getElementById('kpis').innerHTML=
    kpi(o.tenantCount,'Restaurants')+
    kpi(o.verticals.map(v=>v.label).join(', '),'Verticals')+
    kpi(o.paymentProvider.toUpperCase(),'Payment provider')+
    kpi(o.paymentConfigured?'Configured':'Sandbox/off','Payment status');
}
function kpi(n,l){return '<div class="kpi"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';}

async function loadTenants(){
  const r=await fetch(API+'/tenants',{headers:hdr()});
  if(!r.ok){return}
  const rows=await r.json();
  const el=document.getElementById('tenants');
  if(!rows.length){el.innerHTML='<div class="empty">No restaurants yet — create one above.</div>';return}
  el.innerHTML='<table><thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
    rows.map(t=>'<tr><td>'+esc(t.name)+'</td><td><a href="/api/v1/r/'+esc(t.slug)+'/widget" target="_blank">'+esc(t.slug)+'</a></td>'+
      '<td><span class="pill '+t.status+'">'+t.status+'</span></td>'+
      '<td>'+(t.status==='active'
        ? '<button class="ghost" onclick="setStatus(\\''+t.id+'\\',\\'suspended\\')">Suspend</button>'
        : '<button onclick="setStatus(\\''+t.id+'\\',\\'active\\')">Activate</button>')+'</td></tr>').join('')+
    '</tbody></table>';
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function createTenant(){
  const body={name:v('f_name'),slug:v('f_slug'),ownerPhone:v('f_phone'),branchName:v('f_branch')||'Main'};
  if(!body.name||!body.slug||!body.ownerPhone){msg('Name, slug and owner phone are required.');return}
  msg('Creating…');
  const r=await fetch(API+'/tenants',{method:'POST',headers:hdr(),body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){msg((d.error&&d.error.message)||'Could not create.');return}
  msg('Created "'+body.name+'". Owner signs in at /api/v1/auth/login with '+body.ownerPhone+'.');
  ['f_name','f_slug','f_phone','f_branch'].forEach(id=>document.getElementById(id).value='');
  loadOverview(); loadTenants();
}
async function setStatus(id,status){
  const r=await fetch(API+'/tenants/'+id+'/status',{method:'POST',headers:hdr(),body:JSON.stringify({status})});
  if(r.ok){ loadTenants(); }
}
function v(id){return document.getElementById(id).value.trim();}

(async()=>{ if(await guard()){ loadOverview(); loadTenants(); } })();
</script></body></html>`;
