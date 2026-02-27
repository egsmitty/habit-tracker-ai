// backend/database.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'habits.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
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

// Safely add new columns to existing databases
// (If you already have a database, ALTER TABLE adds the missing columns without wiping data)
const addColumnIfMissing = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some(c => c.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`✅ Added column: ${table}.${column}`);
  }
};

addColumnIfMissing('users', 'profile', 'TEXT DEFAULT NULL');
addColumnIfMissing('users', 'onboarding_complete', 'INTEGER DEFAULT 0');
addColumnIfMissing('habits', 'frequency_type', "TEXT DEFAULT 'daily'");
addColumnIfMissing('habits', 'frequency_count', 'INTEGER DEFAULT 1');

console.log('✅ Database ready!');
module.exports = db;
