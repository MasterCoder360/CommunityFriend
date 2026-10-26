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
app.get('/api/search-idealist', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ success: false, message: 'Query parameter "q" is required' });
    }

    let browser;
    try {
        console.log(`Starting Idealist search for: "${q}"`);
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });

        // Mask webdriver to bypass basic bot detection
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        
        const page = await context.newPage();
        const searchUrl = `https://www.idealist.org/en/volunteer?q=${encodeURIComponent(q)}`;
        
        console.log('Navigating to:', searchUrl);
        
        // Use 'domcontentloaded' with a strict 15-second timeout to prevent infinite hanging
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Short, fixed wait for React to paint the initial cards
        await page.waitForTimeout(2000);

        // Check if we hit a Cloudflare/CAPTCHA block
        const pageTitle = await page.title();
        if (pageTitle.includes('Attention Required') || pageTitle.includes('Cloudflare')) {
            console.error('Blocked by Cloudflare bot protection.');
            await browser.close();
            return res.status(503).json({ success: false, message: 'Service temporarily blocked by anti-bot protection. Please try again in a few minutes.' });
        }

        const results = await page.evaluate(() => {
            const opportunities = [];
            const seenUrls = new Set();
            
            // Idealist cards are usually links containing specific text patterns
            const allLinks = Array.from(document.querySelectorAll('a'));
            
            allLinks.forEach(link => {
                const href = link.getAttribute('href') || '';
                if (href.includes('/en/volunteer/') && !href.includes('?') && !href.includes('#')) {
                    const text = link.innerText.trim();
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    if (lines.length >= 2) {
                        const title = lines[0];
                        const org = lines[1];
                        
                        // Filter out navigation links, "View more", etc.
                        if (title.length > 10 && !title.toLowerCase().includes('view') && !title.toLowerCase().includes('sign up') && !title.toLowerCase().includes('learn more')) {
                            const fullUrl = href.startsWith('http') ? href : 'https://www.idealist.org' + href;
                            
                            if (!seenUrls.has(fullUrl)) {
                                seenUrls.add(fullUrl);
                                
                                const locationLine = lines.find(l => l.match(/Remote|On-site|Hybrid|Anywhere/i) || l.match(/[A-Z][a-z]+, [A-Z]{2}/));
                                
                                opportunities.push({
                                    title: title,
                                    organization: org,
                                    location: locationLine || 'Location not specified',
                                    posted: lines.find(l => l.match(/Posted \d+ (hours?|days?|months?|weeks?) ago/i)) || '',
                                    url: fullUrl
                                });
                            }
                        }
                    }
                }
            });
            
            return opportunities.slice(0, 15);
        });

        console.log(`Successfully extracted ${results.length} opportunities from Idealist.`);
        await browser.close();
        res.json({ success: true, count: results.length, data: results });
    } catch (error) {
        console.error('Idealist scraping error:', error);
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        res.status(500).json({ success: false, message: 'Failed to search Idealist. The site may be blocking automated requests.', error: error.message });
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