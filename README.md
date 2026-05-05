# 📦 Resell Tracker

A clean, fast web app for tracking your resell business — products, profits, shipping statuses, and suppliers — hosted on Railway with a PostgreSQL database.

---

## ✨ Features

- **Dashboard** — live stats cards for Total Profit, Total Sales, Inventory Value, and Items Sold with mini activity charts
- **Inventory** — full product table with search, status filters, and quick-filter chips
- **Suppliers** — supplier cards with star ratings, WeChat/WhatsApp badges, contact info, and notes
- **Status tracking** — Pending · Shipped by Supplier · Delivered at Home · Shipped to Buyer · SOLD · DISPUTE · DAMAGED
- **Auto tracking links** — paste a USPS, UPS, FedEx, or DHL number and it becomes a clickable link
- **Import CSV** — import from a Google Sheets export, columns are auto-mapped
- **Export CSV** — download a full backup of your data anytime
- **Dark / Light mode** — toggle in Settings, preference is saved
- **Custom badge colors** — pick any color for each status badge in Settings
- **Cloud storage** — everything saves to PostgreSQL on Railway, works across any device or browser

---

## 🗂 Project Structure

```
resell-tracker/
├── index.html        # Full frontend (single file — UI, styles, and logic)
├── server.js         # Express server + all API routes
├── db.js             # PostgreSQL connection pool
├── package.json      # Dependencies and start script
└── README.md
```

---

## 🚀 Deploy to Railway

### 1. Push to GitHub

Make sure all files are committed and pushed to a GitHub repository.

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project → Deploy from GitHub Repo**
3. Select your repository — Railway will detect `package.json` and run `npm install` + `npm start` automatically

### 3. Add a PostgreSQL database

1. Inside your Railway project, click **+ New → Database → PostgreSQL**
2. Railway automatically sets the `DATABASE_URL` environment variable — no manual config needed

### 4. Get a public URL

1. Click your web service → **Settings → Networking → Generate Domain**
2. Your app is live at `https://your-app.up.railway.app`

---

## 💻 Run Locally

### Requirements

- [Node.js](https://nodejs.org) v18 or higher
- A PostgreSQL database (local or remote)

### Setup

```bash
# Install dependencies
npm install

# Set your database connection string
# Create a .env file or export directly:
export DATABASE_URL="postgresql://user:password@localhost:5432/resell_tracker"

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

> The app creates all required tables automatically on first run — no migrations needed.

---

## 🗄 Database Tables

The app auto-creates these tables on startup:

### `items`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Unique ID |
| `name` | TEXT | Product name |
| `cost` | NUMERIC | What you paid |
| `sold` | NUMERIC | What you sold it for (NULL = not sold yet) |
| `status` | TEXT | Current status |
| `tracking` | TEXT | Tracking number |
| `notes` | TEXT | Free-form notes |
| `updatedAt` | TEXT | Last modified timestamp |
| `row_order` | INTEGER | Display order |

### `suppliers`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Unique ID |
| `name` | TEXT | Supplier name |
| `contact` | TEXT | Username or phone number |
| `platform` | TEXT | `WeChat` or `WhatsApp` |
| `stars` | INTEGER | Rating out of 5 |
| `description` | TEXT | Notes about this supplier |
| `created_at` | TEXT | When added |

---

## 📥 Importing from Google Sheets

1. In your Google Sheet → **File → Download → CSV**
2. In the app → **⬆ Import CSV** → select the file
3. The app auto-maps these column names:

| Sheet Column | Maps To |
|---|---|
| `Product` or `Name` | Product name |
| `Cost` | Cost |
| `Sold` | Sold price |
| `Status` | Status |
| `Tracking` or `Tracking #` | Tracking number |
| `Notes` | Notes |

---

## 🔧 API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/items` | Load all products |
| `POST` | `/api/items` | Save all products (full replace) |
| `GET` | `/api/suppliers` | Load all suppliers |
| `POST` | `/api/suppliers` | Save all suppliers (full replace) |

---

## 🛠 Tech Stack

- **Frontend** — Vanilla HTML/CSS/JS, single file, no build step
- **Backend** — Node.js + Express
- **Database** — PostgreSQL via the `pg` package
- **Hosting** — Railway
