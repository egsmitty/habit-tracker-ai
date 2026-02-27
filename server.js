// backend/server.js
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── File Upload Setup ────────────────────────────────────────────────────────
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — we compress it ourselves in aiVerifier
  fileFilter: (req, file, cb) => {
    const allowedExts = /jpeg|jpg|png|gif|webp/;
    const allowedMime = /image\/(jpeg|jpg|png|gif|webp)/;
    const extOk = allowedExts.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowedMime.test(file.mimetype);
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPG, PNG, GIF, WEBP)'));
    }
  }
});

// Wrapper that catches multer errors and returns clean JSON instead of crashing
function uploadWithErrorHandling(req, res, next) {
  upload.single('proof_image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image is too large. Maximum size is 20MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function calculateLevel(xp) {
  return Math.floor(1 + Math.sqrt(xp / 50));
}

// XP needed to reach the NEXT level from current level
function xpForLevel(level) {
  return Math.pow(level, 2) * 50;
}

// How far through the current level the user is, as a 0-100 percentage
function xpProgressPercent(xp) {
  const level = calculateLevel(xp);
  const currentLevelXp = xpForLevel(level - 1);   // XP at start of this level
  const nextLevelXp = xpForLevel(level);           // XP needed for next level
  const progressInLevel = xp - currentLevelXp;
  const levelRange = nextLevelXp - currentLevelXp;
  return Math.min(100, Math.round((progressInLevel / levelRange) * 100));
}

// Get today's date in the USER's local timezone using the offset sent from the browser.
// Falls back to UTC if no offset provided.
// offset is in minutes (e.g. -360 for CST which is UTC-6)
function todayString(timezoneOffsetMinutes) {
  const now = new Date();
  if (timezoneOffsetMinutes !== undefined && timezoneOffsetMinutes !== null) {
    // JS getTimezoneOffset() returns the OPPOSITE sign of UTC offset, so we subtract
    const localTime = new Date(now.getTime() - (timezoneOffsetMinutes * 60 * 1000));
    return localTime.toISOString().split('T')[0];
  }
  return now.toISOString().split('T')[0];
}

function yesterdayString(timezoneOffsetMinutes) {
  const now = new Date();
  const adjusted = new Date(now.getTime() - (timezoneOffsetMinutes * 60 * 1000));
  adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  return adjusted.toISOString().split('T')[0];
}

// Delete an uploaded file safely (won't crash if file doesn't exist)
function cleanupFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('Failed to delete file:', filePath, err.message);
    }
  });
}

// Input length limits to prevent abuse
const LIMITS = {
  name: 100,
  description: 500,
  proof_instructions: 1000,
  proof_note: 2000,
  email: 200
};

function truncate(str, max) {
  if (!str) return str;
  return String(str).slice(0, max);
}

// ─── USER ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/users', (req, res) => {
  let { name, email } = req.body;

  name = truncate(name, LIMITS.name)?.trim();
  email = truncate(email, LIMITS.email)?.trim().toLowerCase();

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    const result = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(name, email);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      // If email exists, just log them in instead of erroring
      const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (existing) return res.status(200).json({ ...existing, alreadyExisted: true });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Could not create user' });
  }
});

app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const habitCount = db.prepare('SELECT COUNT(*) as count FROM habits WHERE user_id = ?').get(req.params.id);
  const totalCompletions = db.prepare('SELECT SUM(total_completions) as total FROM habits WHERE user_id = ?').get(req.params.id);
  const level = calculateLevel(user.xp);

  res.json({
    ...user,
    level,
    xpProgressPercent: xpProgressPercent(user.xp),
    xpForNextLevel: xpForLevel(level),
    habitCount: habitCount.count,
    totalCompletions: totalCompletions.total || 0
  });
});

// Save onboarding profile answers
app.put('/api/users/:id/profile', (req, res) => {
  const { profile } = req.body;
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'Profile data is required' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    db.prepare(`
      UPDATE users SET profile = ?, onboarding_complete = 1 WHERE id = ?
    `).run(JSON.stringify(profile), req.params.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ ...updated, profile: JSON.parse(updated.profile) });
  } catch (error) {
    console.error('Save profile error:', error);
    res.status(500).json({ error: 'Could not save profile' });
  }
});

// ─── HABIT ROUTES ─────────────────────────────────────────────────────────────

app.get('/api/users/:userId/habits', (req, res) => {
  try {
    const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at DESC').all(req.params.userId);
    const tzOffset = parseInt(req.query.tzOffset) || 0;
    const today = todayString(tzOffset);

    const habitsWithStatus = habits.map(habit => {
      // Only count VERIFIED completions as "done today" — rejected attempts don't block you
      const completedToday = db.prepare(
        'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ? AND ai_verdict = ?'
      ).get(habit.id, today, 'VERIFIED');

      return { ...habit, completedToday: !!completedToday };
    });

    res.json(habitsWithStatus);
  } catch (error) {
    console.error('Load habits error:', error);
    res.status(500).json({ error: 'Could not load habits' });
  }
});

app.post('/api/users/:userId/habits', (req, res) => {
  let { name, description, proof_instructions } = req.body;
  const userId = req.params.userId;

  name = truncate(name, LIMITS.name)?.trim();
  description = truncate(description, LIMITS.description)?.trim();
  proof_instructions = truncate(proof_instructions, LIMITS.proof_instructions)?.trim();

  if (!name || !proof_instructions) {
    return res.status(400).json({ error: 'Name and proof instructions are required' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const result = db.prepare(
      'INSERT INTO habits (user_id, name, description, proof_instructions) VALUES (?, ?, ?, ?)'
    ).run(userId, name, description || '', proof_instructions);

    const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(habit);
  } catch (error) {
    console.error('Create habit error:', error);
    res.status(500).json({ error: 'Could not create habit' });
  }
});

app.delete('/api/habits/:id', (req, res) => {
  const { userId } = req.query;
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(req.params.id);

  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  // Make sure the habit belongs to the user making the request
  if (userId && String(habit.user_id) !== String(userId)) {
    return res.status(403).json({ error: 'Not allowed to delete this habit' });
  }

  try {
    db.prepare('DELETE FROM completions WHERE habit_id = ?').run(req.params.id);
    db.prepare('DELETE FROM habits WHERE id = ?').run(req.params.id);
    res.json({ message: 'Habit deleted' });
  } catch (error) {
    console.error('Delete habit error:', error);
    res.status(500).json({ error: 'Could not delete habit' });
  }
});

// ─── VERIFICATION ROUTE ───────────────────────────────────────────────────────

app.post('/api/habits/:habitId/verify', uploadWithErrorHandling, async (req, res) => {
  const { habitId } = req.params;
  let { proof_note, tzOffset } = req.body;
  const imagePath = req.file ? req.file.path : null;

  proof_note = truncate(proof_note, LIMITS.proof_note)?.trim() || null;
  const tzOffsetNum = parseInt(tzOffset) || 0;

  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
  if (!habit) {
    cleanupFile(imagePath);
    return res.status(404).json({ error: 'Habit not found' });
  }

  // Only VERIFIED completions block you — rejected attempts let you try again
  const today = todayString(tzOffsetNum);
  const alreadyVerified = db.prepare(
    'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ? AND ai_verdict = ?'
  ).get(habitId, today, 'VERIFIED');

  if (alreadyVerified) {
    cleanupFile(imagePath);
    return res.status(400).json({ error: 'Already verified today! Come back tomorrow.' });
  }

  if (!imagePath && !proof_note) {
    return res.status(400).json({ error: 'Please provide an image or a note as proof' });
  }

  try {
    console.log(`🤖 Verifying habit: ${habit.name}`);

    const verification = await verifyHabit(
      habit.name,
      habit.description,
      habit.proof_instructions,
      imagePath,
      proof_note
    );

    // Always save the attempt — verified or not
    db.prepare(`
      INSERT INTO completions (habit_id, user_id, completed_date, proof_image, proof_note, ai_verdict, ai_explanation, xp_earned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      habitId,
      habit.user_id,
      today,
      imagePath,
      proof_note,
      verification.verified ? 'VERIFIED' : 'REJECTED',
      verification.explanation,
      verification.xpEarned
    );

    if (verification.verified) {
      const yesterday = yesterdayString(tzOffsetNum);
      const completedYesterday = db.prepare(
        'SELECT id FROM completions WHERE habit_id = ? AND completed_date = ? AND ai_verdict = ?'
      ).get(habitId, yesterday, 'VERIFIED');

      const newStreak = completedYesterday ? habit.streak + 1 : 1;
      const newLongestStreak = Math.max(newStreak, habit.longest_streak);

      db.prepare(`
        UPDATE habits SET streak = ?, longest_streak = ?, total_completions = total_completions + 1
        WHERE id = ?
      `).run(newStreak, newLongestStreak, habitId);

      db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(verification.xpEarned, habit.user_id);

      // Streak milestone bonuses
      let streakBonus = 0;
      if (newStreak === 3)       streakBonus = 30;
      else if (newStreak === 7)  streakBonus = 100;
      else if (newStreak === 14) streakBonus = 150;
      else if (newStreak === 30) streakBonus = 500;
      else if (newStreak === 100) streakBonus = 2000;
      else if (newStreak % 10 === 0) streakBonus = 50;

      if (streakBonus > 0) {
        db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(streakBonus, habit.user_id);
        console.log(`🎉 Streak milestone! ${newStreak} days — bonus ${streakBonus} XP`);
      }
    }

    const updatedHabit = db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
    const user = db.prepare('SELECT xp FROM users WHERE id = ?').get(habit.user_id);
    const level = calculateLevel(user.xp);

    res.json({
      verified: verification.verified,
      explanation: verification.explanation,
      xpEarned: verification.xpEarned,
      newStreak: updatedHabit.streak,
      userXp: user.xp,
      userLevel: level,
      xpProgressPercent: xpProgressPercent(user.xp)
    });

  } catch (error) {
    // Clean up the uploaded file if something went wrong
    cleanupFile(imagePath);
    console.error('Verification route error:', error);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─── HISTORY ROUTE ────────────────────────────────────────────────────────────

app.get('/api/habits/:habitId/history', (req, res) => {
  try {
    const completions = db.prepare(`
      SELECT * FROM completions WHERE habit_id = ? ORDER BY created_at DESC LIMIT 30
    `).all(req.params.habitId);
    res.json(completions);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Could not load history' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads stored in ./uploads/`);

  // Warn on startup if API key is missing
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here') {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY is not set in your .env file!');
  }
});
