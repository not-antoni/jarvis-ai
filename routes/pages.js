'use strict';

/**
 * Additional Site Pages
 * Changelog, Status
 */

const express = require('express');
const router = express.Router();

const STATUS_PAGE = require('./pages/status.html');
const CHANGELOG_PAGE = require('./pages/changelog.html');

// ============================================================================
// ROUTES
// ============================================================================

router.get('/changelog', (req, res) => {
    res.type('html').send(CHANGELOG_PAGE);
});

router.get('/status', (req, res) => {
    res.type('html').send(STATUS_PAGE);
});

module.exports = router;
