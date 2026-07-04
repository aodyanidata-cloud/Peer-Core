import {
  Controller,
  Post,
  Get,
  Body,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * AuthController — the login surface over HTTP (public). Mobile-OTP flow:
 * request a code, then verify it for a session token. The token drives the
 * guarded portals. With no SMS provider wired, the code is printed to the
 * server logs (LoggingOtpSender). Generic engine seam — no vertical logic.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request-otp')
  async requestOtp(@Body() body: { phone?: string }) {
    if (!body.phone) throw new BadRequestException('phone is required');
    await this.auth.requestOtp(body.phone);
    return { ok: true };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { phone?: string; code?: string }) {
    if (!body.phone || !body.code) {
      throw new BadRequestException('phone and code are required');
    }
    const { token } = await this.auth.verifyOtp(body.phone, body.code);
    const ctx = await this.auth.authenticate(token);
    return {
      token,
      userId: ctx.userId,
      isPlatformAdmin: ctx.isPlatformAdmin,
      roles: ctx.memberships.map((m) => m.role),
    };
  }

  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  login(): string {
    return LOGIN_HTML;
  }
}

const LOGIN_HTML = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Peers — Sign in</title>
<style>
  :root{--bg:#0f1720;--card:#182430;--ink:#eef3f8;--muted:#93a4b5;--brand:#1db584;--line:#243444;--warn:#e0b341}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .card{width:360px;max-width:92vw;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px}
  h1{margin:0 0 4px;font-size:22px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:18px}
  label{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.06em}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:#0f1720;color:var(--ink);font-size:15px}
  button{width:100%;margin-top:16px;border:0;border-radius:10px;padding:12px;font-weight:700;cursor:pointer;background:var(--brand);color:#062017;font-size:15px}
  .msg{margin-top:14px;font-size:13px;color:var(--muted);min-height:18px}
  .hint{margin-top:10px;font-size:12px;color:var(--warn)}
  .hide{display:none}
</style>
<body><div class="card">
  <h1>Sign in</h1>
  <div class="sub">Peers — portal access</div>

  <div id="step1">
    <label>Mobile number</label>
    <input id="phone" placeholder="+9665xxxxxxxx" autocomplete="tel">
    <button onclick="requestOtp()">Send code</button>
  </div>

  <div id="step2" class="hide">
    <label>Verification code</label>
    <input id="code" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code">
    <button onclick="verify()">Verify & continue</button>
    <div class="hint">No SMS is wired locally — the code is printed in the server logs.</div>
  </div>

  <div class="msg" id="msg"></div>
</div>
<script>
const API='/api/v1/auth';
const msg=(t)=>document.getElementById('msg').textContent=t;
async function requestOtp(){
  const phone=document.getElementById('phone').value.trim();
  if(!phone){msg('Enter your mobile number.');return}
  msg('Sending…');
  const r=await fetch(API+'/request-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
  if(!r.ok){const e=await r.json().catch(()=>({}));msg((e.error&&e.error.message)||'Could not send code.');return}
  document.getElementById('step1').classList.add('hide');
  document.getElementById('step2').classList.remove('hide');
  msg('Code sent. Check the server logs for it.');
}
async function verify(){
  const phone=document.getElementById('phone').value.trim();
  const code=document.getElementById('code').value.trim();
  if(!code){msg('Enter the code.');return}
  msg('Verifying…');
  const r=await fetch(API+'/verify-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,code})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){msg((data.error&&data.error.message)||'Invalid code.');return}
  localStorage.setItem('peers_token',data.token);
  if(data.isPlatformAdmin){ location.href='/api/v1/admin/console'; }
  else if(data.roles && data.roles.length){ location.href='/api/v1/staff/console'; }
  else { msg('Signed in, but this account has no portal access yet.'); }
}
</script></body></html>`;
