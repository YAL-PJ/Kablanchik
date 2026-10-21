// קבלנצ'יק — שרת מקומי.
// מגיש את הממשק, ומעביר בקשות AI ל-CLI של Claude Code / Gemini / Codex שמותקנים ומחוברים במחשב הזה.
// בלי תלויות חיצוניות: Node 18+ בלבד.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // רק מהמחשב הזה — שאף אחד ברשת לא ירוץ על המנוי שלך
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

// הגנה מאתרים זרים שמנסים לשלוח בקשות ל-localhost דרך הדפדפן שלך
function trusted(req) {
  const host = String(req.headers.host || '');
  const okHost = host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
  return okHost && req.headers['x-kablanchik'] === '1';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
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
    providerStatus().then(list => {
      list.forEach(p => console.log(`  ${p.available ? '✓' : '✗'} ${p.label}${p.available ? ' — ' + p.version : `  (הפקודה "${p.bin} --version" נכשלה: ${p.reason})`}`));
      if (list.some(p => !p.available)) console.log('  מודל שלא נמצא: בדוק שהוא מותקן ושהפקודה שלו עובדת בטרמינל הזה. אפשר גם להגדיר נתיב מלא, ראה README.');
    });
  });
}
module.exports = { server, looseJson, PROVIDERS };
