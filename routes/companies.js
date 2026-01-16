/**
 * Companies Routes
 * Web routes for viewing companies in the Stark Economy
 * 
 * Routes:
 * - /companies - List all companies
 * - /companies/:id - Individual company page
 */

'use strict';

const express = require('express');
const router = express.Router();

// Lazy load to avoid circular dependencies
let starkCompanies = null;
function getCompanies() {
    if (!starkCompanies) {
        starkCompanies = require('../src/services/stark-companies');
    }
    return starkCompanies;
}

// ============================================================================
// COMPANY LISTING PAGE
// ============================================================================

/**
 * GET /companies
 * Display list of all companies
 */
router.get('/', async (req, res) => {
    try {
        const companies = getCompanies();
        const database = require('../src/services/database');
        const col = await database.getCollection('starkCompanies');

        // Get all companies, sorted by profit
        const allCompanies = await col.find({}).sort({ baseProfit: -1 }).limit(100).toArray();

        // Group by tier
        const tiers = { ultra: [], mega: [], large: [], small: [], basic: [] };
        for (const c of allCompanies) {
            if (tiers[c.tier]) {
                tiers[c.tier].push(c);
            }
        }

        res.send(renderCompanyListPage(tiers, companies));
    } catch (error) {
        console.error('[Companies] List page error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load companies.'));
    }
});

/**
 * GET /companies/:id
 * Display individual company page
 */
router.get('/:id', async (req, res) => {
    try {
        const companies = getCompanies();
        const company = await companies.getCompany(req.params.id);

        if (!company) {
            return res.status(404).send(renderErrorPage('Not Found', 'Company not found.'));
        }

        const profit = companies.calculateCurrentProfit(company);
        const typeData = companies.COMPANY_TYPES[company.type] || {};

        res.send(renderCompanyPage(company, profit, typeData, companies));
    } catch (error) {
        console.error('[Companies] Page error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load company.'));
    }
});

// GET /companies/:id/image - Serve company image
router.get('/:id/image', async (req, res) => {
    try {
        const companies = getCompanies();
        const company = await companies.getCompany(req.params.id);

        if (!company || !company.imageUrl) {
            return res.redirect('/assets/company-placeholder.png');
        }

        const img = company.imageUrl;

        // Handle Base64 images
        if (img.startsWith('data:')) {
            const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const mimeType = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
                return res.send(buffer);
            }
        }

        // Handle external URLs (redirect to them)
        if (img.startsWith('http')) {
            return res.redirect(img);
        }

        // Fallback for local paths (though we moved to Base64)
        if (img.startsWith('/')) {
            return res.redirect(img);
        }

        res.redirect('/assets/company-placeholder.png');
    } catch (error) {
        console.error('[Companies] Image load error:', error);
        res.redirect('/assets/company-placeholder.png');
    }
});

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderCompanyListPage(tiers, companies) {
    const tierOrder = ['ultra', 'mega', 'large', 'small', 'basic'];
    const tierColors = {
        ultra: '#f1c40f',
        mega: '#9b59b6',
        large: '#3498db',
        small: '#2ecc71',
        basic: '#95a5a6'
    };

    let tierSections = '';
    for (const tier of tierOrder) {
        const tierCompanies = tiers[tier] || [];
        if (tierCompanies.length === 0) continue;

        const companyCards = tierCompanies.map(c => {
            const profit = companies.calculateCurrentProfit(c);
            const image = c.imageUrl || '/assets/company-placeholder.png';
            return `
                <a href="/companies/${encodeURIComponent(c.id)}" class="company-card">
                    <img src="/companies/${encodeURIComponent(c.id)}/image" alt="${escapeHtml(c.displayName)}" loading="lazy" onerror="this.src='/assets/company-placeholder.png'">
                    <div class="info">
                        <h3>${escapeHtml(c.displayName)}</h3>
                        <p>Owner: ${escapeHtml(c.ownerName)}</p>
                        <p>Profit: ${companies.formatCompact(profit)}/h</p>
                    </div>
                </a>
            `;
        }).join('');

        tierSections += `
            <section class="tier-section">
                <h2 style="color: ${tierColors[tier]}">${tier.toUpperCase()} Tier</h2>
                <div class="company-grid">${companyCards}</div>
            </section>
        `;
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Companies | Stark Economy</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            padding: 2rem;
        }
        h1 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 2rem;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .tier-section {
            margin-bottom: 3rem;
        }
        .tier-section h2 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .company-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
        }
        .company-card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            overflow: hidden;
            text-decoration: none;
            color: inherit;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .company-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 30px rgba(0,212,255,0.2);
        }
        .company-card img {
            width: 100%;
            height: 150px;
            object-fit: cover;
            background: rgba(0,0,0,0.3);
        }
        .company-card .info {
            padding: 1rem;
        }
        .company-card h3 {
            font-size: 1.1rem;
            margin-bottom: 0.5rem;
        }
        .company-card p {
            color: #888;
            font-size: 0.9rem;
        }
        .back-link {
            display: inline-block;
            color: #00d4ff;
            text-decoration: none;
            margin-bottom: 1rem;
        }
    </style>
</head>
<body>
    <a href="/" class="back-link">← Back to Home</a>
    <h1>🏢 Stark Economy Companies</h1>
    ${tierSections || '<p style="text-align:center;color:#888">No companies yet!</p>'}
</body>
</html>
    `;
}

function renderCompanyPage(company, profit, typeData, companies) {
    const tierColors = {
        ultra: '#f1c40f',
        mega: '#9b59b6',
        large: '#3498db',
        small: '#2ecc71',
        basic: '#95a5a6'
    };
    const tierColor = tierColors[company.tier] || '#888';
    const image = company.imageUrl || '/assets/company-placeholder.png';
    const description = company.description || 'No description set.';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(company.displayName)} | Stark Economy</title>
    <meta property="og:title" content="${escapeHtml(company.displayName)}">
    <meta property="og:description" content="${escapeHtml(description.substring(0, 150))}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            padding: 2rem;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .back-link {
            display: inline-block;
            color: #00d4ff;
            text-decoration: none;
            margin-bottom: 1.5rem;
        }
        .company-header {
            display: flex;
            gap: 2rem;
            margin-bottom: 2rem;
        }
        .company-image {
            width: 200px;
            height: 200px;
            border-radius: 16px;
            object-fit: cover;
            background: rgba(0,0,0,0.3);
            flex-shrink: 0;
        }
        .company-info h1 {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        .tier-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
            text-transform: uppercase;
            background: ${tierColor};
            color: #000;
            margin-bottom: 1rem;
        }
        .owner {
            color: #888;
            margin-bottom: 1rem;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .stat-card {
            background: rgba(255,255,255,0.05);
            padding: 1rem;
            border-radius: 8px;
            text-align: center;
        }
        .stat-card .value {
            font-size: 1.5rem;
            font-weight: bold;
            color: #00d4ff;
        }
        .stat-card .label {
            font-size: 0.85rem;
            color: #888;
        }
        .description {
            background: rgba(255,255,255,0.05);
            padding: 1.5rem;
            border-radius: 12px;
            line-height: 1.6;
        }
        .description h2 {
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }
        @media (max-width: 600px) {
            .company-header { flex-direction: column; align-items: center; text-align: center; }
            .stats-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/companies" class="back-link">← All Companies</a>
        
        <div class="company-header">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(company.displayName)}" class="company-image" onerror="this.src='/assets/company-placeholder.png'">
            <div class="company-info">
                <h1>${escapeHtml(company.displayName)}</h1>
                <span class="tier-badge">${company.tier}</span>
                <p class="owner">Owned by <strong>${escapeHtml(company.ownerName)}</strong></p>
                <p style="color:#666;font-size:0.85rem">ID: ${escapeHtml(company.id)}</p>
            </div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="value">${companies.formatCompact(profit)}</div>
                <div class="label">Profit/Hour</div>
            </div>
            <div class="stat-card">
                <div class="value">${company.risk}%</div>
                <div class="label">Risk Level</div>
            </div>
            <div class="stat-card">
                <div class="value">${company.currentProfitPercent || 100}%</div>
                <div class="label">Profit %</div>
            </div>
        </div>
        
        <div class="description">
            <h2>📝 Description</h2>
            <p>${escapeHtml(description)}</p>
        </div>
    </div>
</body>
</html>
    `;
}

function renderErrorPage(title, message) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | Stark Economy</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        h1 { color: #ff6b6b; margin-bottom: 1rem; }
        a { color: #00d4ff; }
    </style>
</head>
<body>
    <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        <p style="margin-top:1rem"><a href="/companies">← Back to Companies</a></p>
    </div>
</body>
</html>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = router;
