const express = require("express");
const path = require("path");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT,
      cost NUMERIC,
      sold NUMERIC,
      status TEXT,
      tracking TEXT,
      notes TEXT,
      updatedAt TEXT,
      row_order INTEGER
    );
  `);

  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS updatedAt TEXT;
  `);

  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS row_order INTEGER;
  `);

  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS sold_at TEXT;
  `);
}

app.get("/api/items", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, cost, sold, status, tracking, notes, row_order,
             updatedat   AS "updatedAt",
             sold_at     AS "sold_at"
      FROM items
      ORDER BY row_order ASC NULLS LAST, updatedat DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("LOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/items", async (req, res) => {
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
        `INSERT INTO items
         (id, name, cost, sold, status, tracking, notes, updatedAt, sold_at, row_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          item.id,
          item.name || "",
          num(item.cost),
          num(item.sold),
          item.status || "Pending",
          item.tracking || "",
          item.notes || "",
          item.updatedAt || new Date().toISOString(),
          item.sold_at || null,
          i
        ]
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
  });
});