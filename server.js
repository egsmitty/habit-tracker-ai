// backend/server.js
// The main server file - this runs the whole backend

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { verifyHabit } = require('./aiVerifier');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── File Upload Setup ───────────────────────────────────────────────────────
// Create uploads folder if it doesn't exist
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => {
    // Give each file a unique name so they don't overwrite each other
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const valid = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    valid ? cb(null, true) : cb(new Error('Only image files are allowed'));
  }
});

// ─── Helper Functions ────────────────────────────────────────────────────────

// Calculate what level a user should be at based on XP
function calculateLevel(xp) {
  // Each level requires more XP: Level 2 = 100xp, Level 3 = 250xp, etc.
  return Math.floor(1 + Math.sqrt(xp / 50));
}

// Get today's date as a string like "2024-01-15"
function todayString() {
  return new Date().toISOString().split('T')[0];
}

// ─── USER ROUTES ─────────────────────────────────────────────────────────────

// Create a new user
app.post('/api/users', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
    const result = stmt.run(name, email);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Could not create user' });
  }
});

// Get a user by ID (with their stats)
app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Add extra stats
  const habitCount = db.prepare('SELECT COUNT(*) as count FROM habits WHERE user_id = ?').get(req.params.id);
  const totalCompletions = db.prepare('SELECT SUM(total_completions) as total FROM habits WHERE user_id = ?').get(req.params.id);

  res.json({
    ...user,
    level: calculateLevel(user.xp),
    xpForNextLevel: Math.pow(calculateLevel(user.xp), 2) * 50,
    habitCount: habitCount.count,
    totalCompletions: totalCompletions.total || 0
  });
});

// ─── HABIT ROUTES ─────────────────────────────────────────────────────────────

// Get all habits for a user
app.get('/api/users/:userId/habits', (req, res) => {
  const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at DESC').all(req.params.userId);
  
  const today = todayString();
  
  // For each habit, check if it was already completed today
  const habitsWithStatus = habits.map(habit => {
    const completedToday = db.prepare(
      'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ?'
    ).get(habit.id, today);

    return {
      ...habit,
      completedToday: !!completedToday
    };
  });

  res.json(habitsWithStatus);
});

// Create a new habit
app.post('/api/users/:userId/habits', (req, res) => {
  const { name, description, proof_instructions } = req.body;
  const userId = req.params.userId;

  if (!name || !proof_instructions) {
    return res.status(400).json({ error: 'Name and proof instructions are required' });
  }

  // Check user exists
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const stmt = db.prepare(
    'INSERT INTO habits (user_id, name, description, proof_instructions) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(userId, name, description || '', proof_instructions);
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(result.lastInsertRowid);
  
  res.status(201).json(habit);
});

// Delete a habit
app.delete('/api/habits/:id', (req, res) => {
  const habit = db.prepare('SELECT id FROM habits WHERE id = ?').get(req.params.id);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  db.prepare('DELETE FROM completions WHERE habit_id = ?').run(req.params.id);
  db.prepare('DELETE FROM habits WHERE id = ?').run(req.params.id);
  
  res.json({ message: 'Habit deleted' });
});

// ─── VERIFICATION ROUTE ───────────────────────────────────────────────────────

// Submit proof and get AI verification
app.post('/api/habits/:habitId/verify', upload.single('proof_image'), async (req, res) => {
  const { habitId } = req.params;
  const { proof_note } = req.body;
  const imagePath = req.file ? req.file.path : null;

  // Get the habit
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  // Check if already completed today
  const today = todayString();
  const alreadyDone = db.prepare(
    'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ?'
  ).get(habitId, today);

  if (alreadyDone) {
    return res.status(400).json({ error: 'Already completed today! Come back tomorrow.' });
  }

  // Need at least some proof
  if (!imagePath && !proof_note) {
    return res.status(400).json({ error: 'Please provide an image or a note as proof' });
  }

  try {
    console.log(`🤖 Verifying habit: ${habit.name}`);
    
    // Ask Claude to verify
    const verification = await verifyHabit(
      habit.name,
      habit.description,
      habit.proof_instructions,
      imagePath,
      proof_note
    );

    // Save the completion record
    const stmt = db.prepare(`
      INSERT INTO completions (habit_id, user_id, completed_date, proof_image, proof_note, ai_verdict, ai_explanation, xp_earned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      habitId,
      habit.user_id,
      today,
      imagePath,
      proof_note || null,
      verification.verified ? 'VERIFIED' : 'REJECTED',
      verification.explanation,
      verification.xpEarned
    );

    // If verified, update streak and XP
    if (verification.verified) {
      // Check if streak should continue (completed yesterday?)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const completedYesterday = db.prepare(
        'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ? AND ai_verdict = ?'
      ).get(habitId, yesterdayStr, 'VERIFIED');

      const newStreak = completedYesterday ? habit.streak + 1 : 1;
      const newLongestStreak = Math.max(newStreak, habit.longest_streak);

      db.prepare(`
        UPDATE habits 
        SET streak = ?, longest_streak = ?, total_completions = total_completions + 1
        WHERE id = ?
      `).run(newStreak, newLongestStreak, habitId);

      // Add XP to user
      db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(verification.xpEarned, habit.user_id);
      
      // Bonus XP for streaks
      let streakBonus = 0;
      if (newStreak === 7) streakBonus = 100;
      else if (newStreak === 30) streakBonus = 500;
      else if (newStreak % 10 === 0) streakBonus = 50;
      
      if (streakBonus > 0) {
        db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(streakBonus, habit.user_id);
      }
    }

    // Return the result
    const updatedHabit = db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
    const user = db.prepare('SELECT xp FROM users WHERE id = ?').get(habit.user_id);

    res.json({
      verified: verification.verified,
      explanation: verification.explanation,
      xpEarned: verification.xpEarned,
      newStreak: updatedHabit.streak,
      userXp: user.xp,
      userLevel: calculateLevel(user.xp)
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─── HISTORY ROUTE ────────────────────────────────────────────────────────────

// Get completion history for a habit
app.get('/api/habits/:habitId/history', (req, res) => {
  const completions = db.prepare(`
    SELECT * FROM completions 
    WHERE habit_id = ? 
    ORDER BY created_at DESC 
    LIMIT 30
  `).all(req.params.habitId);
  
  res.json(completions);
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads stored in ./uploads/`);
});
