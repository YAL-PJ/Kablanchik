// קבלנצ'יק — שרת מקומי.
// מגיש את הממשק, ומעביר בקשות AI ל-CLI של Claude Code / Gemini / Codex שמותקנים ומחוברים במחשב הזה.
// בלי תלויות חיצוניות: Node 18+ בלבד.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// הגדרות מקובץ .env בתיקיית הפרויקט (לא נכנס ל-git). משתני סביבה קיימים גוברים.
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {}
})();

const PORT = Number(process.env.PORT) || 3000;
// ברירת מחדל: רק מהמחשב הזה. KB_HOST=0.0.0.0 פותח גישה מרשת (Tailscale / רשת ביתית) — ואז חובה סיסמה.
const HOST = process.env.KB_HOST || '127.0.0.1';
const LOCAL_ONLY = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
const PASSWORD = process.env.KB_PASSWORD || '';
if (!LOCAL_ONLY && PASSWORD.length < 8) {
  console.error('\nKB_HOST פותח את השרת לרשת, אבל לא הוגדרה סיסמה.\nהוסף לקובץ .env שורה: KB_PASSWORD=סיסמה-של-לפחות-8-תווים\n');
  process.exit(1);
}
const AUTH = PASSWORD.length > 0;
// הטוקן בעוגייה נגזר מהסיסמה: שורד הפעלה מחדש, ומתבטל כשמחליפים סיסמה
const SESSION = AUTH ? crypto.createHash('sha256').update('kablanchik-session:' + PASSWORD).digest('hex') : '';
const PUB = path.join(__dirname, 'public');
// תיקייה ריקה שבה ה-CLI רץ, כדי שלא יקרא קבצי פרויקט או הגדרות מהתיקייה הזו
const WORK = path.join(__dirname, '.ai-workspace');
fs.mkdirSync(WORK, { recursive: true });
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 180000;
const IS_WIN = process.platform === 'win32';

// מוציא אובייקט JSON מטקסט שאולי יש לפניו או אחריו שורות נוספות
function looseJson(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('no JSON in output');
}

const PROVIDERS = {
  claude: {
    label: 'Claude',
    bin: process.env.CLAUDE_BIN || 'claude',
    // הפרומפט נכנס ב-stdin. בלי --bare: מצב bare לא משתמש בהתחברות של המנוי.
    args: ['-p', '--output-format', 'json'],
    parse(out) {
      const j = looseJson(out);
      if (j.is_error) throw new Error(String(j.result || 'Claude returned an error'));
      if (typeof j.result !== 'string') throw new Error('unexpected Claude output');
      return j.result;
    },
  },
  gemini: {
    label: 'Gemini',
    bin: process.env.GEMINI_BIN || 'gemini',
    // ב-Gemini מה שנכנס ב-stdin הוא הקשר, ו--p הוא ההוראה
    args: ['-p', 'Follow the instructions in the input above exactly and reply only as they ask.', '--output-format', 'json'],
    parse(out) {
      const j = looseJson(out);
      if (j.error) throw new Error(String(j.error.message || j.error));
      if (typeof j.response !== 'string') throw new Error('unexpected Gemini output');
      return j.response;
    },
  },
  codex: {
    label: 'ChatGPT (Codex)',
    bin: process.env.CODEX_BIN || 'codex',
    // "-" = קרא את הפרומפט מ-stdin. ב-stdout יוצאת רק ההודעה הסופית.
    args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'],
    parse(out) {
      const t = String(out || '').trim();
      if (!t) throw new Error('empty Codex output');
      return t;
    },
  },
};

// ב-Windows ה-CLI מותקנים כ-.cmd ודורשים shell; אז צריך לצטט ארגומנטים עם רווחים
const winQuote = a => (/[\s"&|<>^]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a);

function run(bin, args, input, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    let out = '', err = '', done = false;
    let child;
    try {
      // ב-Windows: בונים שורת פקודה אחת בעצמנו (עם ציטוט), כדי ש-.cmd יעבדו ובלי אזהרת DEP0190
      child = IS_WIN
        ? spawn([bin, ...args].map(winQuote).join(' '), { cwd: WORK, shell: true, windowsHide: true, env: process.env })
        : spawn(bin, args, { cwd: WORK, windowsHide: true, env: process.env });
    } catch (e) {
      resolve({ code: -1, out: '', err: String(e.message || e), ms: 0 });
      return;
    }
    const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - started }); };
    const timer = setTimeout(() => { err += '\n[timeout]'; try { child.kill(); } catch {} finish(-2); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', e => { err += String(e.message || e); finish(-1); });
    child.on('close', code => finish(code));
    child.stdin.on('error', () => {});
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

async function providerStatus() {
  const entries = await Promise.all(Object.entries(PROVIDERS).map(async ([id, p]) => {
    const r = await run(p.bin, ['--version'], null, 20000);
    const first = s => String(s || '').trim().split(/\r?\n/)[0].slice(0, 160);
    const ok = r.code === 0;
    const reason = ok ? '' : r.code === -2 ? 'לא ענה תוך 20 שניות' : (first(r.err) || first(r.out) || `יצא עם קוד ${r.code}`);
    return { id, label: p.label, bin: p.bin, available: ok, version: ok ? first(r.out || r.err).slice(0, 80) : '', reason };
  }));
  return entries;
}

async function callAi(id, prompt) {
  const p = PROVIDERS[id];
  if (!p) return { ok: false, error: 'unknown provider' };
  const r = await run(p.bin, p.args, prompt, TIMEOUT_MS);
  const tail = s => String(s || '').trim().split('\n').slice(-6).join('\n').slice(-800);
  if (r.code === -2) return { ok: false, ms: r.ms, error: `עבר הזמן המרבי (${Math.round(TIMEOUT_MS / 1000)} שניות).` };
  if (r.code === -1) return { ok: false, ms: r.ms, error: `לא הצלחתי להפעיל את ${p.bin}. הוא מותקן ונמצא ב-PATH?\n${tail(r.err)}` };
  try {
    const text = p.parse(r.out);
    if (r.code !== 0 && !text) throw new Error('exit ' + r.code);
    return { ok: true, ms: r.ms, text };
  } catch (e) {
    return { ok: false, ms: r.ms, error: `${p.label} לא החזיר תשובה תקינה (קוד ${r.code}). ${e.message}\n${tail(r.err) || tail(r.out)}` };
  }
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- הרשאות ----------
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const loggedIn = req => !AUTH || safeEq(cookies(req).kb_session || '', SESSION);

// במצב מקומי: רק Host של localhost (מגן מ-DNS rebinding). במצב רשת: העוגייה (SameSite=Strict) היא ההגנה.
function trusted(req) {
  if (req.headers['x-kablanchik'] !== '1') return false;
  if (!LOCAL_ONLY) return true;
  const host = String(req.headers.host || '');
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

// הגבלת ניסיונות התחברות: 5 כישלונות לכתובת => חסימה ל-15 דקות
const fails = new Map();
const blocked = ip => { const f = fails.get(ip); return f && f.n >= 5 && Date.now() - f.t < 15 * 60e3; };
const fail = ip => { const f = fails.get(ip); const n = f && Date.now() - f.t < 15 * 60e3 ? f.n + 1 : 1; fails.set(ip, { n, t: Date.now() }); };

function loginPage(msg) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>קבלנצ'יק · כניסה</title>
<style>:root{--bg:#f2f4f7;--s:#fff;--i:#161a21;--m:#5a6272;--l:#d8dde5;--a:#2350b5;--e:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--s:#161a21;--i:#e8ebf1;--m:#9aa3b2;--l:#2a313c;--a:#7ea2ff;--e:#ff8f85;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--i);font:16px system-ui,"Segoe UI",Arial,sans-serif;padding:16px}
form{background:var(--s);border:1px solid var(--l);border-radius:12px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:1.4rem}p{margin:0;color:var(--m);font-size:.9rem}input{font:inherit;padding:10px 12px;border:1px solid var(--l);border-radius:8px;background:var(--bg);color:var(--i)}
button{font:inherit;padding:10px;border:0;border-radius:8px;background:var(--a);color:var(--s);font-weight:600;cursor:pointer}.e{color:var(--e)}</style></head>
<body><form method="post" action="/login"><h1>קבלנצ'יק</h1><p>הכנס את הסיסמה שהגדרת בקובץ ‎.env‎ במחשב.</p>
<input type="password" name="password" autocomplete="current-password" aria-label="סיסמה" autofocus required>
${msg ? `<p class="e">${msg}</p>` : ''}<button type="submit">כניסה</button></form></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.socket.remoteAddress || '';
  try {
    if (url.pathname === '/login' && req.method === 'POST' && AUTH) {
      if (blocked(ip)) return send(res, 429, loginPage('יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.'), 'text/html; charset=utf-8');
      const pw = new URLSearchParams(await readBody(req, 4096)).get('password') || '';
      if (!safeEq(pw, PASSWORD)) {
        fail(ip); console.log(`[login] failed from ${ip}`);
        return send(res, 401, loginPage('סיסמה שגויה.'), 'text/html; charset=utf-8');
      }
      fails.delete(ip);
      res.writeHead(303, { Location: '/', 'Set-Cookie': `kb_session=${SESSION}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}` });
      return res.end();
    }
    if (url.pathname === '/logout') {
      res.writeHead(303, { Location: '/', 'Set-Cookie': 'kb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      return res.end();
    }
    if (!loggedIn(req)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { ok: false, error: 'login required' });
      return send(res, 200, loginPage(''), 'text/html; charset=utf-8');
    }
    if (url.pathname.startsWith('/api/')) {
      if (!trusted(req)) return send(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && url.pathname === '/api/providers') return send(res, 200, await providerStatus());
      if (req.method === 'POST' && url.pathname === '/api/ai') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { ok: false, error: 'empty prompt' });
        const r = await callAi(String(body.provider), body.prompt);
        console.log(`[ai] ${body.provider} ${r.ok ? 'ok' : 'fail'} ${r.ms ?? 0}ms`);
        return send(res, 200, r);
      }
      return send(res, 404, { error: 'not found' });
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUB, rel);
    if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`קבלנצ'יק רץ: http://localhost:${PORT}`);
    if (LOCAL_ONLY) {
      console.log('  גישה: רק מהמחשב הזה' + (AUTH ? ', עם סיסמה' : ''));
    } else {
      console.log('  גישה: מהרשת, עם סיסמה. כתובות של המחשב הזה:');
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`    http://${a.address}:${PORT}   (${name}${a.address.startsWith('100.') ? ', כנראה Tailscale' : ''})`);
      }
    }
    providerStatus().then(list => {
      list.forEach(p => console.log(`  ${p.available ? '✓' : '✗'} ${p.label}${p.available ? ' — ' + p.version : `  (הפקודה "${p.bin} --version" נכשלה: ${p.reason})`}`));
      if (list.some(p => !p.available)) console.log('  מודל שלא נמצא: בדוק שהוא מותקן ושהפקודה שלו עובדת בטרמינל הזה. אפשר גם להגדיר נתיב מלא, ראה README.');
    });
  });
}
module.exports = { server, looseJson, PROVIDERS };
