# ReviewTap Design Studio

A standalone self-serve design tool that lets ReviewTap clients design their product artwork after checkout — no back-and-forth approval needed.

## Architecture

```
D:\Reviewtap Design\
├── frontend/       React + Vite + Fabric.js (port 3000)
├── backend/        Node.js + Express (port 4000)
└── .env.example    All required environment variables
```

## Quick Start

### Frontend
```bash
cd frontend
npm install
npm run dev       # http://localhost:3000
```

### Backend
```bash
cd backend
npm install
cp ../.env.example .env   # fill in your keys
npm run dev               # http://localhost:4000
```

### Test the flow
Open http://localhost:3000, enter any name + order number **TEST** (or RT-1001, RT-1002, RT-1003).

---

## Feature Overview

| Feature | Status |
|---|---|
| Entry screen (business name + order number) | ✅ |
| Order lookup (mock — swap for real Shopify lookup) | ✅ |
| Sequential product navigator | ✅ |
| Fabric.js canvas editor | ✅ |
| Template background (locked layer) | ✅ |
| Bleed / safe-area / snap zone guides | ✅ |
| Logo upload (PNG, JPG, SVG, WebP) | ✅ |
| Background removal toggle (remove.bg API) | ✅ |
| Drag / resize / rotate | ✅ |
| Snap-to-zone + canvas boundary clamping | ✅ |
| Undo / redo (Ctrl+Z / Ctrl+Y) | ✅ |
| Bring forward / send backward | ✅ |
| Delete selected (Delete key) | ✅ |
| PNG export at 300 DPI | ✅ |
| Backend TIFF conversion (Sharp, LZW compression) | ✅ |
| Google Drive upload (service account) | ✅ |
| Per-client subfolder creation on Drive | ✅ |
| Completion screen (no download exposed) | ✅ |

---

## Environment Variables

Copy `.env.example` → `backend/.env` and fill in:

```
REMOVE_BG_API_KEY        # https://www.remove.bg/api — free tier: 50 images/month
GOOGLE_SERVICE_ACCOUNT_JSON  # JSON content of your GCP service account key
GOOGLE_DRIVE_FOLDER_ID   # Drive folder ID (share it with the service account email)
```

### Google Drive Setup
1. Create a GCP project → Enable Drive API
2. Create a Service Account → download JSON key
3. Create a folder in your Drive
4. Share that folder with the service account email (Editor)
5. Copy the folder ID from the URL: `drive.google.com/drive/folders/<FOLDER_ID>`

---

## Products

Defined in `frontend/src/lib/products.js` and mirrored in `backend/src/lib/products.js`.

| Product | Physical size | Canvas (300 DPI px) | Template |
|---|---|---|---|
| ReviewTap Stand | 120×190mm + 3mm bleed | 1489×2315 | `stand_template.svg` |
| ReviewTap Card (CR80) | 85.6×54mm + 3mm bleed | 1081×709 | `card_template.svg` |

### Adding products
1. Add entry to `frontend/src/lib/products.js`
2. Mirror it in `backend/src/lib/products.js`
3. Place template image in `frontend/public/templates/`

### Replacing placeholder templates
Place your Canva exports as:
- `frontend/public/templates/stand_template.png`
- `frontend/public/templates/card_template.png`

Then update the `template` field in `products.js` from `.svg` → `.png`.

---

## Order Lookup (V1 → Production)

Currently uses `frontend/src/lib/mockOrders.js`. To connect real orders:
- Option A: Pass `products=stand,card` as URL params in the post-purchase link
- Option B: Add a backend route `/api/order/:number` that queries Shopify Admin API

---

## File Naming & Drive Structure

Files are named: `BusinessName_ProductName_Design.tiff`

Drive structure: `Root folder / Business Name / filename.tiff`

One subfolder is auto-created per client business name on first upload.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React 18 + Vite 5 | Fast dev, modern |
| Canvas | Fabric.js 5 | Mature, full-featured object model |
| Styling | Tailwind CSS 3 | Utility-first, consistent |
| BG removal | remove.bg API | Fastest to ship; swap for `rembg` (self-hosted) to eliminate per-call cost |
| TIFF export | Sharp (server-side) | LZW TIFF at exact print dimensions |
| Backend | Express + Node ESM | Lightweight |
| Drive | googleapis v140 + service account | Serverless, no OAuth dance |
