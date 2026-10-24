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
  url: String,
  scrapedAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', eventSchema);

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
      allEvents = allEvents.concat(events1);
      await page1.close();
    } catch (err) {
      console.error('Error scraping community1stjc.com:', err);
    }

    try {
      const page2 = await context.newPage();
      await page2.goto('https://jerseycityculture.org/events/', { waitUntil: 'networkidle', timeout: 60000 });
      const events2 = await page2.evaluate(() => {
        const extractedEvents = [];
        const eventCards = document.querySelectorAll('.tribe-events-calendar-list__event, .mec-event-article, .event-item, .hentry, .tribe-events-calendar-list__event-details');
        const targets = eventCards.length > 0 ? eventCards : document.querySelectorAll('h2, h3, h4');
        
        targets.forEach(el => {
          const title = el.innerText ? el.innerText.trim() : '';
          if (!title || title.length < 5) return;
          if (title.includes("What's Coming Up") || title.includes("List of events") || title.includes("Events")) return;
          
          const container = el.closest('.tribe-events-calendar-list__event, .mec-event-article, .event-item, .hentry, .tribe-events-calendar-list__event-details') || el.parentElement;
          const containerText = container ? container.innerText : el.innerText;
          
          const dateMatch = containerText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}/i) || 
                            containerText.match(/\d{1,2}:\d{2}\s*(?:am|pm)\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm)/i);
          
          const parentLink = el.closest('a') || (container ? container.querySelector('a') : null);
          const url = parentLink && parentLink.href ? parentLink.href : 'https://jerseycityculture.org/events/';
          
          extractedEvents.push({
            title: title,
            date: dateMatch ? dateMatch[0].trim() : 'Check website for details',
            location: 'Jersey City, NJ',
            url: url
          });
        });
        return Array.from(new Set(extractedEvents.map(e => JSON.stringify(e)))).map(stringified => JSON.parse(stringified));
      });
      allEvents = allEvents.concat(events2);
      await page2.close();
    } catch (err) {
      console.error('Error scraping jerseycityculture.org:', err);
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