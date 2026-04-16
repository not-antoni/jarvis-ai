'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../src/utils/public-config');

const publicConfig = getPublicConfig();
const DISCORD_INVITE = publicConfig.discordInviteUrl;
const BOT_INVITE = publicConfig.botInviteUrl;
const SITE_BASE_URL = publicConfig.baseUrl;
const GA_MEASUREMENT_ID = publicConfig.gaMeasurementId;
const CONTACT_EMAIL = 'dev@jorvis.org';

let _appContext = null;
function setAppContext(ctx) { _appContext = ctx; }
function getServerCount() {
    try {
        const count = _appContext?.getClient()?.guilds?.cache?.size || 0;
        if (count >= 1000) return (count / 1000).toFixed(1) + 'K+';
        if (count > 0) return count + '+';
    } catch {}
    return '';
}

const LANDING_PAGE = fs.readFileSync(path.join(__dirname, 'templates', 'landing.html'), 'utf8')
    .replaceAll('%%GA_MEASUREMENT_ID%%', GA_MEASUREMENT_ID)
    .replaceAll('%%SITE_BASE_URL%%', SITE_BASE_URL)
    .replaceAll('%%DISCORD_INVITE%%', DISCORD_INVITE)
    .replaceAll('%%BOT_INVITE%%', BOT_INVITE)
    .replaceAll('%%CONTACT_EMAIL%%', CONTACT_EMAIL);

function serveLanding(req, res) {
    res.type('html').send(LANDING_PAGE.replace('%%SERVER_COUNT%%', getServerCount()));
}

router.get('/', serveLanding);
router.get('/home', serveLanding);

module.exports = router;
module.exports.setAppContext = setAppContext;
