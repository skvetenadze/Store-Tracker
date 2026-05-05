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
      updatedAt TEXT
    );
  `);
}

app.get("/api/items", async (req, res) => {
  const result = await pool.query("SELECT * FROM items ORDER BY updatedAt DESC");
  res.json(result.rows);
});

app.post("/api/items", async (req, res) => {
  const items = req.body;

  await pool.query("DELETE FROM items");

  for (const item of items) {
    await pool.query(
      `INSERT INTO items (id, name, cost, sold, status, tracking, notes, updatedAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        item.id,
        item.name,
        item.cost,
        item.sold,
        item.status,
        item.tracking,
        item.notes,
        item.updatedAt
      ]
    );
  }

  res.json({ success: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
  });
});