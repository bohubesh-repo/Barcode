const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const bwipjs = require('bwip-js');
const PDFDocument = require('pdfkit');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 8000;
const SECRET_KEY = process.env.BARCODE_SECRET_KEY || 'dev-secret-change-me';
const DB_PATH = path.join(__dirname, '..', 'barcode.db');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      model TEXT NOT NULL,
      color TEXT NOT NULL,
      size TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      raw_batch_string TEXT NOT NULL,
      enc_batch TEXT UNIQUE NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      serial TEXT NOT NULL,
      full_barcode TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'In Stock',
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(batch_id) REFERENCES batches(id)
    )
  `);
});

function normalize(value) {
  const cleaned = (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) throw new Error('Input parts must contain alphanumeric characters');
  return cleaned;
}

function generateSku(category, subcategory, model, color, size) {
  return [category, subcategory, model, color, size].map(normalize).join('-');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function generateEncBatch(rawBatchString) {
  const digest = crypto.createHmac('sha256', SECRET_KEY).update(rawBatchString).digest();
  return base32Encode(digest).slice(0, 6);
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function conflictMessage(error, fallback) {
  if (!error || !error.message) return fallback;
  if (error.message.includes('products.sku')) return 'Duplicate SKU';
  if (error.message.includes('batches.enc_batch')) return 'Duplicate ENC_BATCH';
  if (error.message.includes('units.full_barcode')) return 'Duplicate full_barcode';
  return fallback;
}

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/generate', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'generate.html')));
app.get('/scan', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'scan.html')));

app.post('/api/products', async (req, res) => {
  try {
    const { category, subcategory, model, color, size } = req.body;
    const sku = generateSku(category, subcategory, model, color, size);

    await run(
      `INSERT INTO products (sku, category, subcategory, model, color, size) VALUES (?, ?, ?, ?, ?, ?)`,
      [sku, category.trim(), subcategory.trim(), model.trim(), color.trim(), size.trim()]
    );

    res.json({ message: 'Product created', sku });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE constraint failed')) {
      res.status(409).json({ detail: conflictMessage(error, 'Duplicate SKU') });
      return;
    }
    res.status(400).json({ detail: error.message || 'Invalid product data' });
  }
});

app.get('/api/products', async (_req, res) => {
  const rows = await all('SELECT sku FROM products ORDER BY sku ASC');
  res.json(rows);
});

app.post('/api/batches', async (req, res) => {
  const { sku, production_date, manufacturer_code, batch_number, quantity } = req.body;
  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    res.status(400).json({ detail: 'Quantity must be positive' });
    return;
  }

  const rawBatch = `${String(production_date).trim()}|${String(manufacturer_code).trim().toUpperCase()}|${String(batch_number).trim()}`;
  const encBatch = generateEncBatch(rawBatch);

  try {
    await run('BEGIN TRANSACTION');

    const product = await get('SELECT id, sku FROM products WHERE sku = ?', [sku]);
    if (!product) {
      await run('ROLLBACK');
      res.status(404).json({ detail: 'SKU not found' });
      return;
    }

    const batchResult = await run(
      `INSERT INTO batches (product_id, raw_batch_string, enc_batch, quantity, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [product.id, rawBatch, encBatch, qty, new Date().toISOString()]
    );

    const batchId = batchResult.lastID;
    const stmt = db.prepare(
      'INSERT INTO units (product_id, batch_id, serial, full_barcode, status) VALUES (?, ?, ?, ?, ?)'
    );

    await new Promise((resolve, reject) => {
      stmt.serialize(() => {
        for (let i = 1; i <= qty; i += 1) {
          const serial = String(i).padStart(4, '0');
          const fullBarcode = `${product.sku}-${encBatch}-${serial}`;
          stmt.run([product.id, batchId, serial, fullBarcode, 'In Stock'], (err) => {
            if (err) reject(err);
          });
        }
        stmt.finalize((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    await run('COMMIT');
    res.json({
      message: 'Batch created',
      batch_id: batchId,
      enc_batch: encBatch,
      raw_batch_string: rawBatch,
      quantity: qty,
    });
  } catch (error) {
    try { await run('ROLLBACK'); } catch (_e) { /* ignore */ }
    if (String(error.message || '').includes('UNIQUE constraint failed')) {
      res.status(409).json({ detail: conflictMessage(error, 'Duplicate data') });
      return;
    }
    res.status(500).json({ detail: error.message || 'Batch creation failed' });
  }
});

app.get('/api/units/:fullBarcode', async (req, res) => {
  const { fullBarcode } = req.params;
  const row = await get(
    `SELECT
      u.id,
      u.serial,
      u.full_barcode,
      u.status,
      p.sku,
      p.category,
      p.subcategory,
      p.model,
      p.color,
      p.size,
      b.enc_batch,
      b.raw_batch_string
    FROM units u
    JOIN products p ON u.product_id = p.id
    JOIN batches b ON u.batch_id = b.id
    WHERE u.full_barcode = ?`,
    [fullBarcode]
  );

  if (!row) {
    res.status(404).json({ detail: 'Barcode not found' });
    return;
  }
  res.json(row);
});

app.get('/barcode/:unitId.png', async (req, res) => {
  const row = await get('SELECT full_barcode FROM units WHERE id = ?', [req.params.unitId]);
  if (!row) {
    res.status(404).json({ detail: 'Unit not found' });
    return;
  }

  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: row.full_barcode,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: 'center',
  });

  res.type('png').send(png);
});

app.get('/batch/:batchId/pdf', async (req, res) => {
  const rows = await all('SELECT id, full_barcode FROM units WHERE batch_id = ? ORDER BY id ASC', [req.params.batchId]);
  if (!rows.length) {
    res.status(404).json({ detail: 'Batch not found' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=batch-${req.params.batchId}.pdf`);

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  doc.pipe(res);

  let x = 30;
  let y = 40;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    // eslint-disable-next-line no-await-in-loop
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: row.full_barcode,
      scale: 2,
      height: 10,
      includetext: true,
      textxalign: 'center',
    });

    doc.image(png, x, y, { width: 240, height: 70 });
    doc.fontSize(8).text(row.full_barcode, x, y + 75);

    if (x === 30) {
      x = 300;
    } else {
      x = 30;
      y += 110;
    }

    if (y > 730) {
      doc.addPage();
      x = 30;
      y = 40;
    }
  }

  doc.end();
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Barcode tool running on http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', () => {
  db.close(() => process.exit(0));
});
