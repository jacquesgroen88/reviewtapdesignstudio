import Database from 'better-sqlite3'
import path     from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH   = path.join(__dirname, '../../data/reviewtap.db')

let db = null

export function getDb() {
  if (db) return db

  // Ensure data directory exists
  import('fs').then(fs => fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }))

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')  // better concurrent read performance
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS qr_codes (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      destination TEXT NOT NULL,
      scan_count  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_status (
      row_slug    TEXT PRIMARY KEY,   -- Formaloo row slug
      status      TEXT NOT NULL DEFAULT 'pending',
                                      -- pending | in_progress | done | skipped
      note        TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  return db
}

// ── QR code operations ────────────────────────────────────────────────────────

export function listQRCodes() {
  return getDb().prepare('SELECT * FROM qr_codes ORDER BY created_at DESC').all()
}

export function getQRCode(id) {
  return getDb().prepare('SELECT * FROM qr_codes WHERE id = ?').get(id)
}

export function createQRCode({ id, label, destination }) {
  const stmt = getDb().prepare(`
    INSERT INTO qr_codes (id, label, destination)
    VALUES (@id, @label, @destination)
  `)
  stmt.run({ id, label, destination })
  return getQRCode(id)
}

export function updateQRCode(id, { label, destination }) {
  const stmt = getDb().prepare(`
    UPDATE qr_codes
    SET label = COALESCE(@label, label),
        destination = COALESCE(@destination, destination),
        updated_at = datetime('now')
    WHERE id = @id
  `)
  stmt.run({ id, label: label ?? null, destination: destination ?? null })
  return getQRCode(id)
}

export function deleteQRCode(id) {
  getDb().prepare('DELETE FROM qr_codes WHERE id = ?').run(id)
}

export function incrementScanCount(id) {
  getDb().prepare(`
    UPDATE qr_codes SET scan_count = scan_count + 1, updated_at = datetime('now') WHERE id = ?
  `).run(id)
}

// ── Order status operations ───────────────────────────────────────────────────

export function getOrderStatus(rowSlug) {
  return getDb().prepare('SELECT * FROM order_status WHERE row_slug = ?').get(rowSlug)
}

export function setOrderStatus(rowSlug, status, note = null) {
  getDb().prepare(`
    INSERT INTO order_status (row_slug, status, note, updated_at)
    VALUES (@rowSlug, @status, @note, datetime('now'))
    ON CONFLICT(row_slug) DO UPDATE SET
      status     = @status,
      note       = COALESCE(@note, note),
      updated_at = datetime('now')
  `).run({ rowSlug, status, note })
}

export function getAllOrderStatuses() {
  return getDb().prepare('SELECT * FROM order_status').all()
}

export function bulkImport(entries) {
  const insert = getDb().prepare(`
    INSERT OR IGNORE INTO qr_codes (id, label, destination)
    VALUES (@id, @label, @destination)
  `)
  const tx = getDb().transaction(rows => rows.forEach(r => insert.run(r)))
  tx(entries)
}
