import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DATABASE_PATH || "./data/visits.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    code        TEXT PRIMARY KEY,
    label       TEXT,
    redirectUrl TEXT,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL,
    ip         TEXT,
    userAgent  TEXT,
    referer    TEXT,
    createdAt  TEXT NOT NULL,
    FOREIGN KEY (code) REFERENCES links(code)
  );

  CREATE INDEX IF NOT EXISTS idx_visits_code ON visits(code);
`);

const stmts = {
  createLink: db.prepare(
    "INSERT INTO links (code, label, redirectUrl, createdAt) VALUES (?, ?, ?, ?)"
  ),
  getLink: db.prepare("SELECT * FROM links WHERE code = ?"),
  listLinks: db.prepare("SELECT * FROM links ORDER BY createdAt DESC"),
  countVisits: db.prepare("SELECT COUNT(*) AS n FROM visits WHERE code = ?"),
  recordVisit: db.prepare(
    "INSERT INTO visits (code, ip, userAgent, referer, createdAt) VALUES (?, ?, ?, ?, ?)"
  ),
  listVisits: db.prepare(
    "SELECT * FROM visits WHERE code = ? ORDER BY createdAt DESC LIMIT 500"
  ),
};

export function createLink({ code, label, redirectUrl }) {
  stmts.createLink.run(code, label || null, redirectUrl || null, new Date().toISOString());
  return stmts.getLink.get(code);
}

export function getLink(code) {
  return stmts.getLink.get(code);
}

export function listLinks() {
  return stmts.listLinks.all().map((link) => ({
    ...link,
    visitCount: stmts.countVisits.get(link.code).n,
  }));
}

export function recordVisit({ code, ip, userAgent, referer }) {
  stmts.recordVisit.run(code, ip || null, userAgent || null, referer || null, new Date().toISOString());
}

export function listVisits(code) {
  return stmts.listVisits.all(code);
}
