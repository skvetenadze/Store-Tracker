const express = require("express");
const path = require("path");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));

// ── Sessions stored in Postgres ──────────────────────────────────────────
app.use(session({
  store: new pgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "resell-tracker-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: "lax"
  }
}));

// ── Auth middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Auth routes (public) ──────────────────────────────────────────────────
app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get("/api/auth/has-users", async (req, res) => {
  try {
    const count = await pool.query("SELECT COUNT(*) FROM users");
    res.json({ hasUsers: parseInt(count.rows[0].count) > 0 });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [username]
    );
    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid username or password" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "Invalid username or password" });

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// Register — open only when no users exist yet, or when an admin is logged in
app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const count = await pool.query("SELECT COUNT(*) FROM users");
    const isFirst = parseInt(count.rows[0].count) === 0;
    const isAdmin = req.session && req.session.userId;

    if (!isFirst && !isAdmin)
      return res.status(403).json({ error: "Registration is closed" });

    const existing = await pool.query(
      "SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [username]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "Username already taken" });

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3)",
      [username, hash, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Protected API routes ──────────────────────────────────────────────────
app.get("/api/items", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM items ORDER BY row_order ASC NULLS LAST, updatedAt DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("LOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/items", requireAuth, async (req, res) => {
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
        `INSERT INTO items (id, name, cost, sold, status, tracking, notes, updatedAt, row_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [item.id, item.name || "", num(item.cost), num(item.sold),
         item.status || "Pending", item.tracking || "", item.notes || "",
         item.updatedAt || new Date().toISOString(), i]
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

app.get("/api/suppliers", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM suppliers ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("SUPPLIERS LOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/suppliers", requireAuth, async (req, res) => {
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── DB init ───────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, name TEXT, cost NUMERIC, sold NUMERIC,
      status TEXT, tracking TEXT, notes TEXT, updatedAt TEXT, row_order INTEGER
    );
  `);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS updatedAt TEXT;`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS row_order INTEGER;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT, contact TEXT, platform TEXT,
      stars INTEGER, description TEXT, created_at TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT
    );
  `);
}

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
  });
});
