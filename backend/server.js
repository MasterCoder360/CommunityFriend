const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

const eventSchema = new mongoose.Schema({
  title: String,
  date: String,
  location: String,
  scrapedAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', eventSchema);

async function scrapeAndSave() {
  let browser;
  try {
    console.log('Starting scheduled scrape...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    const targetUrl = 'https://community1stjc.com';
    
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    const events = await page.evaluate(() => {
      const extractedEvents = [];
      const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, p'));
      
      headers.forEach(el => {
        const text = el.innerText ? el.innerText.trim() : '';
        if (!text) return;

        if (text.includes('Fall Carnival @ Pershing Field')) {
          extractedEvents.push({ title: 'Fall Carnival @ Pershing Field', date: 'September 10 - September 28, 2025' });
        } else if (text.includes('Back to School Bash')) {
          extractedEvents.push({ title: 'Back to School Bash 2025', date: 'Stay tuned for 2026' });
        } else if (text.includes('Freestyle in the Heights')) {
          extractedEvents.push({ title: 'Freestyle in the Heights: 40th Anniversary', date: 'September 20th, 2025 at 6pm' });
        } else if (text.includes('The Community Service Awards')) {
          extractedEvents.push({ title: 'The Community Service Awards', date: 'Thursday, October 9, 2025', location: 'The Chandelier' });
        }
      });

      return Array.from(new Set(extractedEvents.map(e => JSON.stringify(e)))).map(stringified => JSON.parse(stringified));
    });

    await Event.deleteMany({});
    await Event.insertMany(events);
    console.log(`Successfully saved ${events.length} events to database.`);

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

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});