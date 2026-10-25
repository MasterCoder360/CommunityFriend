const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: [
        'https://login.cosmospark.org',
        'https://community.cosmospark.org',
        'https://cosmospark.org',
        'https://api.cosmospark.org',
        'https://communityfriend.onrender.com'
    ],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

const eventSchema = new mongoose.Schema({
  title: String,
  date: String,
  location: String,
  url: String,
  scrapedAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', eventSchema);

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Database tables initialized');
    } catch (err) {
        console.error('Database initialization error:', err);
    }
}

initDatabase();

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, hashedPassword]
        );
        const user = result.rows[0];
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            domain: '.cosmospark.org',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (err) {
        if (err.code === '23505') {
            res.status(409).json({ success: false, message: 'Username or email already exists' });
        } else {
            res.status(500).json({ success: false, message: 'Registration failed', error: err.message });
        }
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            domain: '.cosmospark.org',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Login failed', error: err.message });
    }
});

app.get('/api/me', async (req, res) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [decoded.userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token', { domain: '.cosmospark.org' });
    res.json({ success: true, message: 'Logged out' });
});

app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.find({}).sort({ scrapedAt: -1 });
        const uniqueEvents = Array.from(new Map(events.map(item => [item.title, item])).values());
        res.json({ success: true, count: uniqueEvents.length, data: uniqueEvents });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch events", error: error.message });
    }
});

app.get('/', (req, res) => {
    if (req.hostname.includes('login.cosmospark.org')) {
        return res.redirect(302, '/login');
    }
    res.json({ message: "CommunityFriend API is running." });
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html'));
});

app.use(express.static(path.join(__dirname, '../'), { index: false }));

app.use((req, res) => {
    if (req.hostname.includes('login.cosmospark.org')) {
        return res.sendFile(path.join(__dirname, '../login.html'));
    }
    res.status(404).json({ error: "Endpoint not found" });
});

app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});