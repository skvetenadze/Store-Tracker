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
        from: "Resell Tracker <onboarding@resend.dev>",
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
  .pin-sub{font-size:13px;color:#555;margin-bottom:32px}
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
</style>
</head>
<body>
<div class="pin-box">
  <div class="pin-logo">&#128230;</div>
  <div class="pin-title">Resell Tracker</div>
  <div class="pin-sub">Enter your 4-digit passcode</div>
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
</script>
</body>
</html>`;

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
        from: process.env.EMAIL_FROM || "Resell Tracker <onboarding@resend.dev>",
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
}

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log("Server running on port " + PORT));
});
