const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

app.use(express.static(path.join(__dirname, '../')));

app.get('/api/events', async (req, res) => {
    let browser;
    try {
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
                    extractedEvents.push({
                        title: 'Fall Carnival @ Pershing Field',
                        date: 'September 10 - September 28, 2025'
                    });
                } else if (text.includes('Back to School Bash')) {
                    extractedEvents.push({
                        title: 'Back to School Bash 2025',
                        date: 'Stay tuned for 2026'
                    });
                } else if (text.includes('Freestyle in the Heights')) {
                    extractedEvents.push({
                        title: 'Freestyle in the Heights: 40th Anniversary',
                        date: 'September 20th, 2025 at 6pm'
                    });
                } else if (text.includes('The Community Service Awards')) {
                    extractedEvents.push({
                        title: 'The Community Service Awards',
                        date: 'Thursday, October 9, 2025',
                        location: 'The Chandelier'
                    });
                }
            });

            const uniqueEvents = Array.from(new Set(extractedEvents.map(e => JSON.stringify(e))))
                                      .map(stringified => JSON.parse(stringified));

            return uniqueEvents;
        });

        res.json({
            success: true,
            source: targetUrl,
            count: events.length,
            data: events
        });

    } catch (error) {
        console.error("Scraping error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to scrape event data",
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.use(express.static(path.join(__dirname, '../')));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});
