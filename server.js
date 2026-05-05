const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

const pool = require("./db");

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
id TEXT PRIMARY KEY
      name TEXT,
      cost NUMERIC,
      sold NUMERIC,
      status TEXT,
      tracking TEXT,
      notes TEXT
    );
  `);
}

initDB();

app.get("/api/items", async (req, res) => {
  const result = await pool.query("SELECT * FROM items ORDER BY id DESC");
  res.json(result.rows);
});

app.post("/api/items", async (req, res) => {
  const items = req.body;

  for (const item of items) {
    await pool.query(
      `INSERT INTO items (id, name, cost, sold, status, tracking, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id)
       DO UPDATE SET
         name = EXCLUDED.name,
         cost = EXCLUDED.cost,
         sold = EXCLUDED.sold,
         status = EXCLUDED.status,
         tracking = EXCLUDED.tracking,
         notes = EXCLUDED.notes`,
      [
        item.id,
        item.name,
        item.cost,
        item.sold,
        item.status,
        item.tracking,
        item.notes
      ]
    );
  }

  res.json({ success: true });
});