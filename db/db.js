/* ==========================================================================
   db/db.js
   SQLite veritabanı (tek dosya). Küçük/orta ölçek için yeterlidir;
   büyük kullanıcı sayısına çıkılırsa PostgreSQL'e taşınabilir
   (better-sqlite3 -> pg değişimi bu dosyada izole tutulmuştur).
   ========================================================================== */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbYolu = process.env.DATABASE_PATH || "./data/kpss.db";
fs.mkdirSync(path.dirname(dbYolu), { recursive: true });

const db = new Database(dbYolu);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  ad TEXT,
  tip TEXT DEFAULT 'ucretsiz',      -- ucretsiz | premium
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject TEXT,
  topic TEXT,
  question TEXT,
  options TEXT,                      -- JSON: {A,B,C,D,E}
  correct_answer TEXT,
  explanation TEXT,
  difficulty TEXT,
  source TEXT,                       -- 'ai' | 'user' | 'current_affairs'
  created_by TEXT,                   -- user id, ai ise NULL
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  question_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  test_turu TEXT,                    -- 'guncel' | 'konu' | 'kisisel'
  dogru INTEGER,
  yanlis INTEGER,
  bos INTEGER,
  detay TEXT,                        -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wrong_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  question_id TEXT,
  verilen_cevap TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subject TEXT,
  dakika INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS current_affairs (
  id TEXT PRIMARY KEY,
  title TEXT,
  summary TEXT,
  category TEXT,
  published_at TEXT,
  source_name TEXT,
  source_url TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  current_affairs_id TEXT,
  title TEXT,
  url TEXT,
  domain TEXT,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  gun TEXT,                          -- 'YYYY-MM-DD', günlük limit sayacı için
  sayi INTEGER DEFAULT 0,
  UNIQUE(user_id, gun)
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  islem TEXT,                        -- 'teacher' | 'generate-questions' | 'solve-image' | 'current-affairs'
  saglayici TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reported_questions (
  id TEXT PRIMARY KEY,
  question_id TEXT,
  user_id TEXT,
  sebep TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  anahtar TEXT PRIMARY KEY,
  deger TEXT
);
`);

module.exports = db;
