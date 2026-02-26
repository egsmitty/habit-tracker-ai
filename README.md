# ⚒️ HabitForge — AI Habit Tracker

An AI-powered habit tracker where Claude verifies your proof instead of you just ticking a checkbox.

---

## 📁 Folder Structure

```
habit-tracker/
├── backend/
│   ├── server.js          ← Main Express server (all API routes)
│   ├── database.js        ← SQLite database setup
│   ├── aiVerifier.js      ← Claude AI verification logic
│   ├── package.json       ← Node.js dependencies
│   ├── .env.example       ← Copy this to .env and add your API key
│   └── uploads/           ← Created automatically, stores proof images
└── frontend/
    └── public/
        └── index.html     ← The entire frontend (open this in a browser)
```

---

## 🚀 Setup (Step by Step)

### Step 1: Get an Anthropic API Key
1. Go to https://console.anthropic.com
2. Sign up / log in
3. Go to **API Keys** → click **Create Key**
4. Copy the key (starts with `sk-ant-...`)

### Step 2: Install Node.js
- Download from https://nodejs.org (choose the LTS version)

### Step 3: Set Up the Backend
```bash
# Navigate to the backend folder
cd habit-tracker/backend

# Install all dependencies
npm install

# Copy the example env file
cp .env.example .env

# Open .env in any text editor and paste your API key:
# ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Step 4: Start the Server
```bash
# In the backend folder:
node server.js

# You should see:
# ✅ Database ready!
# 🚀 Server running on http://localhost:3001
```

### Step 5: Open the Frontend
- Just open `frontend/public/index.html` in your browser
- That's it! No build step needed.

---

## 💡 How to Use

1. **Sign up** with your name and email on first load
2. **Create a habit** — give it a name and tell the AI what proof counts
3. **Submit proof daily** — upload an image and/or write a note
4. **AI verifies** — Claude decides if you actually did it
5. **Earn XP and streaks** — level up over time!

### Example Habits & Proof Instructions

| Habit | Proof Instructions |
|-------|-------------------|
| Morning Run | Screenshot from Strava/Apple Health showing today's run distance |
| Read 20 Pages | Photo of the book open to your current page with today's date visible nearby |
| Drink 8 Glasses of Water | Photo of your water tracking app or a tally written today |
| Meditate 10 Minutes | Screenshot from a meditation app showing a completed session today |
| No Junk Food | Photo of what you ate today (meals) |

---

## 🏆 XP & Levels

- ✅ Verified with high confidence: **+50 XP**
- ✅ Verified with medium confidence: **+35 XP**
- ✅ Verified with low confidence: **+20 XP**
- 🔥 7-day streak bonus: **+100 XP**
- 🔥 30-day streak bonus: **+500 XP**
- 🔥 Every 10-day streak: **+50 XP**

---

## 🛠️ Troubleshooting

**"Cannot connect to server"** → Make sure you ran `node server.js` in the backend folder

**"API key invalid"** → Check your `.env` file has the correct key with no extra spaces

**Image won't upload** → Max size is 10MB, must be JPG/PNG/GIF/WebP

**"Already completed today"** → Each habit can only be verified once per day

---

## 📡 API Endpoints (for reference)

| Method | Route | What it does |
|--------|-------|-------------|
| POST | `/api/users` | Create new user |
| GET | `/api/users/:id` | Get user + stats |
| GET | `/api/users/:id/habits` | List all habits |
| POST | `/api/users/:id/habits` | Create habit |
| DELETE | `/api/habits/:id` | Delete habit |
| POST | `/api/habits/:id/verify` | Submit proof for AI verification |
| GET | `/api/habits/:id/history` | Get last 30 completions |
