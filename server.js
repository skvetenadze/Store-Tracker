const express = require("express");
const crypto = require("crypto");
const path = require("path");
const pool = require("./db");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const app = express();
const PORT = process.env.PORT || 3000;

// One-time page tokens — consumed on first load, refresh requires PIN again
const pageTokens = new Map();

app.use(express.json({ limit: "10mb" }));

async function sendBreachAlert(ip, count) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.ALERT_EMAIL_TO;

  if (!apiKey) {
    console.error("⚠️  Email alert skipped — RESEND_API_KEY not set in env variables");
    return;
  }

  console.log(`📧 Sending breach alert to ${to} for IP ${ip}...`);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Inventory Tracker <onboarding@resend.dev>",
        to: [to],
        subject: "⚠️ Resell Tracker — Wrong PIN Alert",
        html: `
          <div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#ef4444">⚠️ Failed PIN Attempts</h2>
            <p>Someone entered the wrong PIN <strong>${count} times</strong>.</p>
            <table style="width:100%;border-collapse:collapse;margin-top:12px">
              <tr><td style="padding:8px;color:#666">Time</td><td style="padding:8px"><strong>${new Date().toLocaleString()}</strong></td></tr>
              <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">IP Address</td><td style="padding:8px"><strong>${ip}</strong></td></tr>
              <tr><td style="padding:8px;color:#666">Attempts</td><td style="padding:8px"><strong>${count}</strong></td></tr>
            </table>
            <p style="margin-top:16px;color:#666;font-size:13px">If this wasn't you, consider changing your passcode in Railway env variables.</p>
          </div>`
      })
    });

    const data = await res.json();
    if (res.ok) {
      console.log("✅ Alert email sent successfully, id:", data.id);
    } else {
      console.error("❌ Resend error:", JSON.stringify(data));
    }
  } catch(e) {
    console.error("❌ Failed to send alert email:", e.message);
  }
}

// ── Failed attempt tracker ────────────────────────────────────────────────
const failedAttempts = {};
const RESET_MS = 30 * 60 * 1000;

function getIP(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
}

function trackFail(ip) {
  const now = Date.now();
  if (!failedAttempts[ip] || now - failedAttempts[ip].firstAt > RESET_MS) {
    failedAttempts[ip] = { count: 1, firstAt: now };
  } else {
    failedAttempts[ip].count++;
  }
  return failedAttempts[ip].count;
}

function resetAttempts(ip) {
  delete failedAttempts[ip];
}

// ── Sessions ──────────────────────────────────────────────────────────────
app.use(session({
  store: new pgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "resell-tracker-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }  // session cookie — expires when browser closes
}));

// ── PIN middleware ────────────────────────────────────────────────────────
function requirePin(req, res, next) {
  if (req.session && req.session.pinVerified) return next();
  res.status(401).json({ error: "PIN required" });
}

// ── Static files ──────────────────────────────────────────────────────────
// ── Static files (CSS, images only — NOT index.html) ─────────────────────
app.use(express.static(__dirname, { index: false }));

// ── Standalone PIN page (no app HTML at all) ──────────────────────────────
const PIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resell Tracker</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0d0d;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif}
  .pin-box{display:flex;flex-direction:column;align-items:center;gap:0;width:100%;max-width:320px;padding:20px}
  .pin-logo{width:56px;height:56px;background:#1a4731;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:20px}
  .pin-title{font-size:20px;font-weight:700;color:#f0f0f0;margin-bottom:6px}
  .pin-sub{font-size:13px;color:#555;margin-bottom:32px;text-align:center}
  .pin-dots{display:flex;gap:14px;margin-bottom:36px}
  .pin-dot{width:16px;height:16px;border-radius:50%;border:2px solid #3a3a3a;background:transparent;transition:background .15s,border-color .15s,transform .1s}
  .pin-dot.filled{background:#22c55e;border-color:#22c55e;transform:scale(1.1)}
  .pin-dot.error{background:#f87171;border-color:#f87171}
  .pin-pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px}
  .pin-key{width:72px;height:72px;border-radius:50%;border:1px solid #3a3a3a;background:#161616;color:#f0f0f0;font-size:22px;font-weight:600;cursor:pointer;transition:background .1s,transform .1s;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;user-select:none}
  .pin-key:hover{background:#1e1e1e}
  .pin-key:active{background:#272727;transform:scale(.93)}
  .pin-key.empty{border:none;background:none;cursor:default;pointer-events:none}
  .pin-key.del{font-size:18px;color:#aaa}
  .pin-err{margin-top:20px;font-size:13px;font-weight:600;color:#f87171;min-height:20px;text-align:center}
  @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
  .shake{animation:shake .35s ease}
  .biometric-btn{margin-top:24px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;border:none;background:none;color:#f0f0f0;padding:0}
  .biometric-icon{width:56px;height:56px;border-radius:16px;background:#1a1a1a;border:1px solid #2a2a2a;display:flex;align-items:center;justify-content:center;font-size:28px;transition:background .15s,transform .1s}
  .biometric-btn:active .biometric-icon{background:#272727;transform:scale(.93)}
  .biometric-lbl{font-size:12px;color:#555;font-weight:500}
  .divider{display:flex;align-items:center;gap:10px;width:100%;margin:24px 0 0}
  .divider-line{flex:1;height:1px;background:#2a2a2a}
  .divider-txt{font-size:11px;color:#444;white-space:nowrap}
</style>
</head>
<body>
<div class="pin-box">
  <div class="pin-logo">&#128230;</div>
  <div class="pin-title">Resell Tracker</div>
  <div class="pin-sub" id="pin-sub">Enter your 4-digit passcode</div>

  <!-- Biometric button (shown when registered) -->
  <button class="biometric-btn" id="biometric-btn" style="display:none" onclick="biometricAuth()">
    <div class="biometric-icon">&#x1F9B9;&#x200D;&#x2642;&#xFE0F;</div>
    <span class="biometric-lbl" id="biometric-lbl">Use Face ID</span>
  </button>

  <div class="divider" id="pin-divider" style="display:none">
    <div class="divider-line"></div>
    <div class="divider-txt">or enter PIN</div>
    <div class="divider-line"></div>
  </div>

  <div id="pin-section" style="margin-top:24px;display:flex;flex-direction:column;align-items:center;gap:0">
    <div class="pin-dots" id="pin-dots">
      <div class="pin-dot" id="d0"></div>
      <div class="pin-dot" id="d1"></div>
      <div class="pin-dot" id="d2"></div>
      <div class="pin-dot" id="d3"></div>
    </div>
    <div class="pin-pad">
      <button class="pin-key" onclick="pk('1')">1</button>
      <button class="pin-key" onclick="pk('2')">2</button>
      <button class="pin-key" onclick="pk('3')">3</button>
      <button class="pin-key" onclick="pk('4')">4</button>
      <button class="pin-key" onclick="pk('5')">5</button>
      <button class="pin-key" onclick="pk('6')">6</button>
      <button class="pin-key" onclick="pk('7')">7</button>
      <button class="pin-key" onclick="pk('8')">8</button>
      <button class="pin-key" onclick="pk('9')">9</button>
      <button class="pin-key empty"></button>
      <button class="pin-key" onclick="pk('0')">0</button>
      <button class="pin-key del" onclick="pdel()">&#9003;</button>
    </div>
  </div>
  <div class="pin-err" id="pin-err"></div>
</div>
<script>
  var pin='';
  function pk(d){if(pin.length>=4)return;pin+=d;upd();if(pin.length===4)submit();}
  function pdel(){if(!pin.length)return;pin=pin.slice(0,-1);upd();}
  function upd(){for(var i=0;i<4;i++)document.getElementById('d'+i).className='pin-dot'+(i<pin.length?' filled':'');}
  async function submit(){
    try{
      var r=await fetch('/api/auth/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
      var d=await r.json();
      if(d.success){window.location.href='/app?t='+d.token;}
      else{document.getElementById('pin-err').textContent='Incorrect PIN. Try again.';pin='';upd();}
    }catch(e){document.getElementById('pin-err').textContent='Error. Try again.';pin='';upd();}
  }
  document.addEventListener('keydown',function(e){
    if(e.key>='0'&&e.key<='9')pk(e.key);
    else if(e.key==='Backspace')pdel();
  });

  // ── Biometric ──
  async function checkBiometric(){
    // Only show on devices that support platform authenticator (Face ID / Touch ID)
    if(!window.PublicKeyCredential) return;
    try {
      var avail = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if(!avail) return;
      var r = await fetch('/api/auth/webauthn/status');
      var d = await r.json();
      if(d.registered){
        document.getElementById('biometric-btn').style.display='flex';
        document.getElementById('pin-divider').style.display='flex';
        // Detect Face ID vs Touch ID (rough heuristic — iOS 12+ supports Face ID on X/Pro models)
        var ua = navigator.userAgent;
        var lbl = 'Use Biometrics';
        if(/iPhone|iPad/.test(ua)) lbl = 'Use Face ID / Touch ID';
        else if(/Android/.test(ua)) lbl = 'Use Fingerprint';
        document.getElementById('biometric-lbl').textContent = lbl;
        // Auto-trigger biometric on load
        biometricAuth();
      }
    } catch(e){}
  }

  async function biometricAuth(){
    var errEl = document.getElementById('pin-err');
    errEl.textContent = '';
    try {
      var cr = await fetch('/api/auth/webauthn/auth-challenge');
      var opts = await cr.json();
      if(opts.error) { errEl.textContent = opts.error; return; }
      // Convert base64url strings to ArrayBuffers
      opts.challenge = b64ToBuffer(opts.challenge);
      opts.allowCredentials = (opts.allowCredentials||[]).map(function(c){
        return { type: c.type, id: b64ToBuffer(c.id) };
      });
      var assertion = await navigator.credentials.get({ publicKey: opts });
      var r = await fetch('/api/auth/webauthn/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assertion.id,
          rawId: bufToB64(assertion.rawId),
          response: {
            clientDataJSON: bufToB64(assertion.response.clientDataJSON),
            authenticatorData: bufToB64(assertion.response.authenticatorData),
            signature: bufToB64(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufToB64(assertion.response.userHandle) : null
          }
        })
      });
      var d = await r.json();
      if(d.success) { window.location.href = '/app?t=' + d.token; }
      else { errEl.textContent = 'Biometric failed. Use PIN instead.'; }
    } catch(e) {
      // User cancelled or not available — just show PIN silently
      if(e.name !== 'NotAllowedError') errEl.textContent = 'Biometric error. Use PIN instead.';
    }
  }

  function b64ToBuffer(b64){
    var bin = atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
    var buf = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    return buf.buffer;
  }
  function bufToB64(buf){
    var bytes = new Uint8Array(buf);
    var bin = '';
    for(var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  checkBiometric();
</script>
</body>
</html>`;


// ── WebAuthn / Biometric routes ───────────────────────────────────────────
const WEBAUTHN_RP_ID = process.env.RP_ID || new URL(process.env.APP_URL || 'http://localhost:3000').hostname;
const WEBAUTHN_ORIGIN = process.env.APP_URL || 'http://localhost:3000';

// Registration: get challenge
app.get('/api/auth/webauthn/register-challenge', (req, res) => {
  const challenge = crypto.randomBytes(32);
  req.session.webauthnChallenge = challenge.toString('base64url');
  res.json({
    challenge: req.session.webauthnChallenge,
    rp: { name: 'Resell Tracker', id: WEBAUTHN_RP_ID },
    user: { id: Buffer.from('resell-user').toString('base64url'), name: 'owner', displayName: 'Owner' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
    timeout: 60000,
    attestation: 'none'
  });
});

// Registration: save credential
app.post('/api/auth/webauthn/register', async (req, res) => {
  // Must be PIN-verified to register biometrics
  if (!(req.session && req.session.pinVerified)) return res.status(401).json({ error: 'PIN required first' });
  const { id, rawId, response: authResp } = req.body;
  if (!id || !authResp) return res.status(400).json({ error: 'Missing credential' });
  try {
    // Parse clientDataJSON to verify challenge and origin
    const clientData = JSON.parse(Buffer.from(authResp.clientDataJSON, 'base64url').toString());
    if (clientData.challenge !== req.session.webauthnChallenge) return res.status(400).json({ error: 'Challenge mismatch' });
    if (clientData.origin !== WEBAUTHN_ORIGIN) return res.status(400).json({ error: 'Origin mismatch' });
    // Store credential (public key stored as-is for verification)
    await pool.query(
      `INSERT INTO webauthn_credentials (id, credential_id, public_key, sign_count, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (credential_id) DO UPDATE SET public_key=$3, sign_count=$4`,
      [crypto.randomUUID(), rawId, authResp.attestationObject, 0, new Date().toISOString()]
    );
    delete req.session.webauthnChallenge;
    res.json({ success: true });
  } catch(e) { console.error('WebAuthn register error:', e); res.status(500).json({ error: e.message }); }
});

// Auth: get challenge
app.get('/api/auth/webauthn/auth-challenge', async (req, res) => {
  try {
    const result = await pool.query('SELECT credential_id FROM webauthn_credentials LIMIT 10');
    if (result.rows.length === 0) return res.status(404).json({ error: 'No credentials registered' });
    const challenge = crypto.randomBytes(32);
    req.session.webauthnChallenge = challenge.toString('base64url');
    res.json({
      challenge: req.session.webauthnChallenge,
      rpId: WEBAUTHN_RP_ID,
      allowCredentials: result.rows.map(r => ({ type: 'public-key', id: r.credential_id })),
      userVerification: 'required',
      timeout: 60000
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Auth: verify and grant session
app.post('/api/auth/webauthn/auth', async (req, res) => {
  const { id, rawId, response: authResp } = req.body;
  if (!id || !authResp) return res.status(400).json({ error: 'Missing credential' });
  try {
    // Find credential in DB
    const result = await pool.query('SELECT * FROM webauthn_credentials WHERE credential_id=$1', [rawId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Unknown credential' });
    // Verify clientDataJSON
    const clientData = JSON.parse(Buffer.from(authResp.clientDataJSON, 'base64url').toString());
    if (clientData.challenge !== req.session.webauthnChallenge) return res.status(401).json({ error: 'Challenge mismatch' });
    if (clientData.origin !== WEBAUTHN_ORIGIN) return res.status(401).json({ error: 'Origin mismatch' });
    // Grant session
    delete req.session.webauthnChallenge;
    req.session.pinVerified = true;
    const token = crypto.randomBytes(20).toString('hex');
    pageTokens.set(token, Date.now());
    setTimeout(() => pageTokens.delete(token), 60000);
    res.json({ success: true, token });
  } catch(e) { console.error('WebAuthn auth error:', e); res.status(500).json({ error: e.message }); }
});

// Check if biometrics are registered
app.get('/api/auth/webauthn/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as cnt FROM webauthn_credentials');
    res.json({ registered: parseInt(result.rows[0].cnt) > 0 });
  } catch(e) { res.json({ registered: false }); }
});

// Remove biometric registration
app.delete('/api/auth/webauthn/credentials', requirePin, async (req, res) => {
  try {
    await pool.query('DELETE FROM webauthn_credentials');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PIN routes ────────────────────────────────────────────────────────────
app.get("/api/auth/pin-status", (req, res) => {
  res.json({ verified: !!(req.session && req.session.pinVerified) });
});

app.post("/api/auth/pin", async (req, res) => {
  const { pin } = req.body;
  const correct = process.env.PASSCODE || "0000";
  const ip = getIP(req);

  if (String(pin) === String(correct)) {
    resetAttempts(ip);
    req.session.pinVerified = true;
    const token = crypto.randomBytes(20).toString("hex");
    pageTokens.set(token, Date.now());
    setTimeout(() => pageTokens.delete(token), 60000); // expire after 60s if unused
    res.json({ success: true, token });
  } else {
    const count = trackFail(ip);
    console.log(`Wrong PIN from ${ip} — attempt ${count}`);
    if (count >= 3) {
      sendBreachAlert(ip, count);
    }
    res.status(401).json({ error: "Incorrect PIN", attempts: count });
  }
});

app.post("/api/auth/lock", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// ── Protected API routes ──────────────────────────────────────────────────
app.get("/api/items", requirePin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, cost, sold, status, tracking, notes, row_order,
             updatedat AS "updatedAt", sold_at AS "sold_at"
      FROM items ORDER BY row_order ASC NULLS LAST, updatedat DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("LOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/items", requirePin, async (req, res) => {
  const items = req.body;
  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? null : n;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM items");
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(
        `INSERT INTO items (id, name, cost, sold, status, tracking, notes, updatedAt, sold_at, row_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [item.id, item.name || "", num(item.cost), num(item.sold),
         item.status || "Pending", item.tracking || "", item.notes || "",
         item.updatedAt || new Date().toISOString(), item.sold_at || null, i]
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, saved: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SAVE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/suppliers", requirePin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM suppliers ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("SUPPLIERS LOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/suppliers", requirePin, async (req, res) => {
  const suppliers = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM suppliers");
    for (const s of suppliers) {
      await client.query(
        `INSERT INTO suppliers (id, name, contact, platform, stars, description, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [s.id, s.name || "", s.contact || "", s.platform || "WeChat",
         s.stars || 0, s.description || s.desc || "",
         s.created_at || new Date().toISOString()]
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, saved: suppliers.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SUPPLIERS SAVE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ── Email Templates ───────────────────────────────────────────────────────
app.get("/api/email-templates", requirePin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM email_templates ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/email-templates", requirePin, async (req, res) => {
  const { id, name, html } = req.body;
  if (!name || !html) return res.status(400).json({ error: "Missing name or html" });
  try {
    await pool.query(
      `INSERT INTO email_templates (id, name, html, created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=$2, html=$3`,
      [id || Date.now().toString(36), name, html, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/email-templates/:id", requirePin, async (req, res) => {
  try {
    await pool.query("DELETE FROM email_templates WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Send Email ────────────────────────────────────────────────────────────
app.post("/api/send-email", requirePin, async (req, res) => {
  const { to, subject, html } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not set" });
  if (!to || !subject || !html) return res.status(400).json({ error: "Missing to, subject, or html" });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Inventory Tracker <onboarding@resend.dev>",
        to: [to], subject, html
      })
    });
    const data = await r.json();
    if (r.ok) res.json({ success: true, id: data.id });
    else res.status(500).json({ error: data.message || "Resend error" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Routes ───────────────────────────────────────────────────────────────
// Always show PIN page — no session check
app.get("/", (req, res) => res.send(PIN_PAGE));

// App page: requires valid session + one-time token
app.get("/app", (req, res) => {
  if (!(req.session && req.session.pinVerified)) {
    return res.redirect("/");
  }
  const token = req.query.t;
  if (!token || !pageTokens.has(token)) {
    return res.redirect("/"); // Refresh or missing token → back to PIN
  }
  pageTokens.delete(token); // Consume — single use only
  res.sendFile(path.join(__dirname, "index.html"));
});

// Fallback
app.get("*", (req, res) => res.redirect("/"));

// ── DB init ───────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, name TEXT, cost NUMERIC, sold NUMERIC,
    status TEXT, tracking TEXT, notes TEXT, updatedAt TEXT, row_order INTEGER
  );`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS updatedAt TEXT;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS row_order INTEGER;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS sold_at TEXT;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT, contact TEXT, platform TEXT,
    stars INTEGER, description TEXT, created_at TEXT
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY, name TEXT, html TEXT, created_at TEXT
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    sign_count INTEGER DEFAULT 0,
    created_at TEXT
  );`);
}

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log("Server running on port " + PORT));
});
