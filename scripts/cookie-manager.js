/**
 * YouTube Cookie Manager
 * Maintains a headless Chrome session logged into Google and exports cookies for yt-dlp
 * 
 * Usage:
 * 1. First run: node cookie-manager.js --setup (will open a visible browser for login)
 * 2. After login: node cookie-manager.js --export (exports cookies to cookies.txt)
 * 3. Auto mode: node cookie-manager.js --daemon (runs in background, refreshes cookies every 30 min)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.join(__dirname, 'yt-cookies.txt');
const SESSION_PATH = path.join(__dirname, '.chrome-session');
const YOUTUBE_URL = 'https://www.youtube.com';

async function launchBrowser(headless = true) {
    // Try to find Chrome/Chromium, or use bundled version
    const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        process.env.CHROME_PATH
    ].filter(Boolean);

    const fs = require('fs');
    let executablePath = possiblePaths.find(p => fs.existsSync(p));

    // If no system Chrome found, use puppeteer's bundled Chromium
    if (!executablePath) {
        console.log('[CookieManager] No system Chrome found, using bundled Chromium');
        executablePath = undefined; // Puppeteer will use bundled version
    } else {
        console.log('[CookieManager] Using browser:', executablePath);
    }

    return puppeteer.launch({
        headless: headless ? 'new' : false,
        userDataDir: SESSION_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--window-size=1280,720'
        ],
        ...(executablePath && { executablePath })
    });
}

function cookiesToNetscape(cookies) {
    const lines = ['# Netscape HTTP Cookie File'];

    for (const cookie of cookies) {
        const domain = cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain;
        const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expiry = cookie.expires ? Math.floor(cookie.expires) : 0;

        lines.push([
            domain,
            includeSubdomains,
            cookie.path,
            secure,
            expiry,
            cookie.name,
            cookie.value
        ].join('\t'));
    }

    return lines.join('\n');
}

async function exportCookies(page) {
    const cookies = await page.cookies(YOUTUBE_URL, 'https://accounts.google.com');
    const netscapeCookies = cookiesToNetscape(cookies);
    fs.writeFileSync(COOKIES_PATH, netscapeCookies);
    console.log(`[CookieManager] Exported ${cookies.length} cookies to ${COOKIES_PATH}`);
    return cookies.length;
}

async function checkLoginStatus(page) {
    await page.goto(YOUTUBE_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Check if signed in by looking for avatar or sign-in button
    const signInButton = await page.$('a[aria-label="Sign in"]');
    const isLoggedIn = !signInButton;

    console.log(`[CookieManager] Login status: ${isLoggedIn ? 'LOGGED IN' : 'NOT LOGGED IN'}`);
    return isLoggedIn;
}

async function setupLogin() {
    console.log('[CookieManager] Starting setup mode - opening browser for login...');
    console.log('[CookieManager] Please log into your Google account in the browser window.');
    console.log('[CookieManager] After logging in, close the browser to save the session.');

    const browser = await launchBrowser(false); // Visible browser
    const page = await browser.newPage();

    await page.goto('https://accounts.google.com', { waitUntil: 'networkidle2' });

    // Wait for user to close browser
    await new Promise(resolve => {
        browser.on('disconnected', resolve);
    });

    console.log('[CookieManager] Browser closed. Session saved.');
    console.log('[CookieManager] Run with --export to export cookies.');
}

async function exportMode() {
    console.log('[CookieManager] Exporting cookies...');

    const browser = await launchBrowser(true);
    const page = await browser.newPage();

    try {
        const isLoggedIn = await checkLoginStatus(page);

        if (!isLoggedIn) {
            console.error('[CookieManager] Not logged in! Run with --setup first.');
            await browser.close();
            process.exit(1);
        }

        await exportCookies(page);
        console.log('[CookieManager] Cookies exported successfully!');
    } finally {
        await browser.close();
    }
}

async function daemonMode() {
    console.log('[CookieManager] Starting daemon mode...');
    console.log('[CookieManager] Will refresh cookies every 30 minutes.');

    const refresh = async () => {
        let browser;
        try {
            browser = await launchBrowser(true);
            const page = await browser.newPage();

            const isLoggedIn = await checkLoginStatus(page);

            if (!isLoggedIn) {
                console.error('[CookieManager] Session expired! Need to re-login.');
                return;
            }

            // Visit YouTube to refresh session
            await page.goto(YOUTUBE_URL, { waitUntil: 'networkidle2' });
            await page.waitForTimeout(5000);

            await exportCookies(page);
        } catch (error) {
            console.error('[CookieManager] Error during refresh:', error.message);
        } finally {
            if (browser) await browser.close();
        }
    };

    // Initial export
    await refresh();

    // Refresh every 30 minutes
    setInterval(refresh, 30 * 60 * 1000);

    console.log('[CookieManager] Daemon running. Press Ctrl+C to stop.');
}

// Main
const args = process.argv.slice(2);

if (args.includes('--setup')) {
    setupLogin().catch(console.error);
} else if (args.includes('--export')) {
    exportMode().catch(console.error);
} else if (args.includes('--daemon')) {
    daemonMode().catch(console.error);
} else {
    console.log(`
YouTube Cookie Manager

Usage:
  node cookie-manager.js --setup    Open browser to log into Google (run once)
  node cookie-manager.js --export   Export cookies to file
  node cookie-manager.js --daemon   Run in background, refresh cookies every 30 min

The --setup mode requires a display (X11 or VNC).
For headless servers, run --setup locally with the same Chrome user data,
then copy the .chrome-session folder to the server.
`);
}
