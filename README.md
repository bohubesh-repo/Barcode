# Internal Barcode Tool

A lightweight internal barcode system with two modules:

- **Generate Barcode** (product + batch + serial generation)
- **Scan Barcode** (mobile camera scanning + data retrieval)

## Stack

- Node.js + Express
- SQLite (single shared database file)
- Vanilla HTML/CSS/JS
- Server-side Code128 generation (`bwip-js`)
- Browser scanner via ZXing JS library

## Features

- Fixed barcode format: `[SKU]-[ENC_BATCH]-[SERIAL]`
- Deterministic `ENC_BATCH` from `raw_batch_string` using HMAC-SHA256 and Base32 (first 6 chars)
- Uniqueness guards for:
  - `products.sku`
  - `batches.enc_batch`
  - `units.full_barcode`
- Auto serial generation (`0001` ... `N`) when creating a batch
- Barcode PNG endpoint per unit
- Batch PDF sheet download (multiple barcodes)
- Mobile-friendly scanner page

## Run Locally (Free)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start server:

   ```bash
   npm start
   ```

3. Open:

- Laptop: `http://localhost:8000`
- Mobile (same WiFi): `http://<YOUR_LAPTOP_IP>:8000`

## Notes

- Secret key is backend-only via env var `BARCODE_SECRET_KEY`.
- Database is `barcode.db` in project root.
- No login/auth included by design.
