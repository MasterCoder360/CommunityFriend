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
    origin: true, 
    credentials: true 
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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
        
        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email },
            token
        });
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
        
        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email },
            token
        });
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
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out' });
});

app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.find({}).sort({ scrapedAt: -1 });
        const uniqueEvents = Array.from(new Map(events.map(item => [item.title, item])).values());
        
        res.json({
            success: true,
            count: uniqueEvents.length,
            data: uniqueEvents
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch events from database",
            error: error.message
        });
    }
});

app.get('/api/scrape-now', async (req, res) => {
    await scrapeAndSave();
    res.json({ success: true, message: "Scrape completed" });
});

async function scrapeAndSave() {
    let browser;
    try {
        console.log('Starting scheduled scrape of both websites...');
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        let allEvents = [];

        try {
            const page1 = await context.newPage();
            await page1.goto('https://community1stjc.com', { waitUntil: 'networkidle', timeout: 60000 });
            const events1 = await page1.evaluate(() => {
                const extractedEvents = [];
                const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, p'));
                headers.forEach(el => {
                    const text = el.innerText ? el.innerText.trim() : '';
                    if (!text) return;
                    
                    const parentLink = el.closest('a');
                    const url = parentLink && parentLink.href ? parentLink.href : 'https://community1stjc.com';

                    if (text.includes('Fall Carnival @ Pershing Field')) {
                        extractedEvents.push({ title: 'Fall Carnival @ Pershing Field', date: 'September 10 - September 28, 2025', location: 'Pershing Field', url });
                    } else if (text.includes('Back to School Bash')) {
                        extractedEvents.push({ title: 'Back to School Bash 2025', date: 'Stay tuned for 2026', location: 'Jersey City', url });
                    } else if (text.includes('Freestyle in the Heights')) {
                        extractedEvents.push({ title: 'Freestyle in the Heights: 40th Anniversary', date: 'September 20th, 2025 at 6pm', location: 'Jersey City Heights', url });
                    } else if (text.includes('The Community Service Awards')) {
                        extractedEvents.push({ title: 'The Community Service Awards', date: 'Thursday, October 9, 2025', location: 'The Chandelier', url });
                    }
                });
                return Array.from(new Set(extractedEvents.map(e => JSON.stringify(e)))).map(stringified => JSON.parse(stringified));
            });
            console.log(`Found ${events1.length} events from community1stjc.com`);
            allEvents = allEvents.concat(events1);
            await page1.close();
        } catch (err) {
            console.error('Error scraping community1stjc.com:', err);
        }

        try {
            const page2 = await context.newPage();
            await page2.goto('https://jerseycityculture.org/events/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page2.waitForTimeout(3000); 
            
            const events2 = await page2.evaluate(() => {
                const extractedEvents = [];
                const candidates = document.querySelectorAll('a, h2, h3, h4, .tribe-events-calendar-list__event, .mec-event-article, .event-item, .hentry, .em-event');
                
                candidates.forEach(el => {
                    const text = el.innerText ? el.innerText.trim() : '';
                    if (!text || text.length < 8) return;
                    
                    if (text.includes("What's Coming Up") || text.includes("Subscribe to calendar") || text.includes("View Full Calender") || text.includes("Events")) return;
                    
                    const hasDate = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i.test(text) || /\d{1,2}:\d{2}\s*(?:am|pm)/i.test(text);
                    
                    if (hasDate) {
                        const parentLink = el.closest('a') || el.querySelector('a') || el;
                        const url = parentLink && parentLink.href && parentLink.href.startsWith('http') ? parentLink.href : 'https://jerseycityculture.org/events/';
                        
                        const title = text.split('\n')[0].trim().replace(/^-/, '').trim();
                        
                        const dateMatch = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}/i) || 
                                        text.match(/\d{1,2}:\d{2}\s*(?:am|pm)\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm)/i);
                        
                        extractedEvents.push({
                            title: title,
                            date: dateMatch ? dateMatch[0].trim() : 'Check website for details',
                            location: 'Jersey City, NJ',
                            url: url
                        });
                    }
                });
                
                const unique = [];
                const seen = new Set();
                for (const e of extractedEvents) {
                    if (!seen.has(e.title)) {
                        seen.add(e.title);
                        unique.push(e);
                    }
                }
                return unique.slice(0, 15);
            });
            
            console.log(`Found ${events2.length} events from jerseycityculture.org`);
            allEvents = allEvents.concat(events2);
            await page2.close();
        } catch (err) {
            console.error('CRITICAL ERROR scraping jerseycityculture.org:', err);
        }

        const uniqueEvents = Array.from(new Set(allEvents.map(e => JSON.stringify(e)))).map(stringified => JSON.parse(stringified));
        
        await Event.deleteMany({});
        await Event.insertMany(uniqueEvents);
        console.log(`Successfully saved ${uniqueEvents.length} combined events to database.`);

    } catch (error) {
        console.error("Scraping error:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

cron.schedule('0 0 * * *', () => {
    scrapeAndSave();
});

scrapeAndSave();

// 1. THE TRUTH DETECTOR: This logs EVERY request so we know exactly what the server sees
app.use((req, res, next) => {
    console.log('========================================');
    console.log('INCOMING REQUEST:');
    console.log('URL:', req.url);
    console.log('HOSTNAME:', req.hostname);
    console.log('HOST HEADER:', req.headers.host);
    console.log('========================================');
    next(); 
});

app.get('/', (req, res) => {
    if (req.hostname.includes('login.cosmospark.org')) {
        console.log('>>> MATCHED LOGIN SUBDOMAIN. SERVING login.html');
        return res.sendFile(path.join(__dirname, '../login.html'));
    }
    console.log('>>> DID NOT MATCH LOGIN. SERVING index.html');
    return res.sendFile(path.join(__dirname, '../index.html'));
});

app.use(express.static(path.join(__dirname, '../'), {
    index: false 
}));

app.use((req, res) => {
    if (req.hostname.includes('login.cosmospark.org')) {
        return res.sendFile(path.join(__dirname, '../login.html'));
    }
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});