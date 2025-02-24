// server.js

const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs = require('fs');
const csvParse = require('csv-parse/lib/sync');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your_secret_key'; // Replace with a strong secret in production

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Use JSON body parser middleware
app.use(bodyParser.json());

// Set up lowdb to persist data in db.json
const adapter = new FileSync('db.json');
const db = low(adapter);

// Set default structure if the db is empty
db.defaults({ users: [] }).write();

// ----- Authentication Endpoints -----

// Login endpoint – for demo purposes, any username is accepted
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // In production, verify password properly.
  let user = db.get('users').find({ username }).value();
  if (!user) {
    // Create new user if one doesn't exist
    user = { username, draftState: {} };
    db.get('users').push(user).write();
  }
  // Create and return a JWT token valid for 24 hours.
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// Middleware to authenticate JWT tokens
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user; // Contains { username }
    next();
  });
}

// ----- Load Player Data from CSV -----

let playersData = [];
try {
  const csvData = fs.readFileSync('data.csv', 'utf8');
  const records = csvParse(csvData, {
    columns: true,
    skip_empty_lines: true
  });
  playersData = records;
  console.log('Player data loaded from CSV.');
} catch (err) {
  console.error('Error reading CSV file', err);
}

// ----- API Endpoints for Player Data & Draft State -----

// GET /api/players
// Returns player data merged with the user's draft state.
app.get('/api/players', authenticateToken, (req, res) => {
  const username = req.user.username;
  // Retrieve user's draft state from the database.
  const user = db.get('users').find({ username }).value();
  const draftState = user ? user.draftState : {};
  // Merge the draft state into players data.
  const mergedData = playersData.map(player => ({
    ...player,
    // Filter the "POS" column to only the first two letters (e.g., "QB" from "QB1")
    POS: player.POS ? player.POS.trim().substring(0,2).toUpperCase() : "",
    drafted: draftState[player.RK] || false
  }));
  // Sort so that non-drafted players come first; if equal, sort by RK.
  mergedData.sort((a, b) => {
    if (a.drafted === b.drafted) {
      return parseInt(a.RK) - parseInt(b.RK);
    }
    return a.drafted ? 1 : -1;
  });
  res.json(mergedData);
});

// POST /api/draft
// Update the draft state for a specific player.
// Expects JSON body: { RK: "1", drafted: true }
app.post('/api/draft', authenticateToken, (req, res) => {
  const { RK, drafted } = req.body;
  const username = req.user.username;
  const user = db.get('users').find({ username }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Update the user's draft state
  user.draftState[RK] = drafted;
  db.get('users')
    .find({ username })
    .assign({ draftState: user.draftState })
    .write();
  res.json({ message: 'Draft state updated' });
});

// ----- Start the Server -----
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
