if (process.env.DELETE_DB === 'true') {
  const dbPath = path.join(__dirname, 'habits.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('🗑️ Database wiped for fresh start');
  }
}

// backend/database.js
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'habits.db'));
db.pragma('journal_mode = WAL');

// ── STEP 1: Run migration FIRST before anything else ──────────────────────────
// The old schema had `name TEXT NOT NULL` which breaks email-only signup.
// We need to fix this before creating tables or adding columns.
try {
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

  if (!tables.includes('users') && tables.includes('users_old')) {
    // Previous migration crashed halfway — recover by finishing it
    console.log('🔧 Recovering from incomplete migration...');
    db.exec(`
      BEGIN;
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
      INSERT OR IGNORE INTO users (id, email, name, xp, level, profile, onboarding_complete, created_at)
        SELECT id, email, name, xp, level, profile, onboarding_complete, created_at FROM users_old;
      DROP TABLE users_old;
      COMMIT;
    `);
    console.log('✅ Recovery complete');

  } else if (tables.includes('users')) {
    const cols = db.prepare('PRAGMA table_info(users)').all();
    const nameCol = cols.find(c => c.name === 'name');
    if (nameCol && nameCol.notnull === 1) {
      console.log('🔧 Migrating users table...');
      // Get all existing column names so we copy everything
      const colNames = cols.map(c => c.name).join(', ');
      db.exec(`
        BEGIN;
        ALTER TABLE users RENAME TO users_old;
        CREATE TABLE users (
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
        INSERT OR IGNORE INTO users (${colNames})
          SELECT ${colNames} FROM users_old;
        DROP TABLE users_old;
        COMMIT;
      `);
      console.log('✅ Migration complete');
    }
  }
  db.pragma('foreign_keys = ON');
} catch (e) {
  db.pragma('foreign_keys = ON');
  console.error('Migration error:', e.message);
}

// ── STEP 2: Create tables if they don't exist ─────────────────────────────────
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

// ── STEP 3: Add any missing columns to existing tables ────────────────────────
const addColumnIfMissing = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`✅ Added column: ${table}.${column}`);
  }
};

addColumnIfMissing('users', 'profile',             'TEXT DEFAULT NULL');
addColumnIfMissing('users', 'onboarding_complete',  'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'display_name',         'TEXT');
addColumnIfMissing('users', 'username',             'TEXT');
addColumnIfMissing('users', 'bio',                  "TEXT DEFAULT ''");
addColumnIfMissing('users', 'banner_color',         "TEXT DEFAULT '#7c3aed'");
addColumnIfMissing('users', 'username_changed',     'INTEGER DEFAULT 0');
addColumnIfMissing('habits', 'frequency_type',      "TEXT DEFAULT 'daily'");
addColumnIfMissing('habits', 'frequency_count',     'INTEGER DEFAULT 1');

console.log('✅ Database ready!');
module.exports = db;
