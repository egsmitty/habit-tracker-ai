// backend/database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'habits.db');

// ── ONE-TIME RESET (set DELETE_DB=true in Railway env vars, then remove it) ───
if (process.env.DELETE_DB === 'true') {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('🗑️  Database wiped — starting fresh');
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── CREATE TABLES (fresh database or existing) ────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    display_name TEXT,
    username TEXT,
    bio TEXT DEFAULT '',
    banner_color TEXT DEFAULT '#7c3aed',
    username_changed INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    profile TEXT DEFAULT NULL,
    onboarding_complete INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    proof_instructions TEXT NOT NULL,
    frequency_type TEXT DEFAULT 'daily',
    frequency_count INTEGER DEFAULT 1,
    streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    total_completions INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    completed_date TEXT NOT NULL,
    proof_image TEXT,
    proof_note TEXT,
    ai_verdict TEXT,
    ai_explanation TEXT,
    xp_earned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (habit_id) REFERENCES habits(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── ADD MISSING COLUMNS (safe for existing databases) ─────────────────────────
const addColumnIfMissing = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`✅ Added column: ${table}.${column}`);
  }
};

addColumnIfMissing('users', 'name',                'TEXT');
addColumnIfMissing('users', 'profile',             'TEXT DEFAULT NULL');
addColumnIfMissing('users', 'onboarding_complete', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'display_name',        'TEXT');
addColumnIfMissing('users', 'username',            'TEXT');
addColumnIfMissing('users', 'bio',                 "TEXT DEFAULT ''");
addColumnIfMissing('users', 'banner_color',        "TEXT DEFAULT '#7c3aed'");
addColumnIfMissing('users', 'username_changed',    'INTEGER DEFAULT 0');
addColumnIfMissing('habits', 'frequency_type',     "TEXT DEFAULT 'daily'");
addColumnIfMissing('habits', 'frequency_count',    'INTEGER DEFAULT 1');

console.log('✅ Database ready!');
module.exports = db;