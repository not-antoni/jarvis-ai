'use strict';

/**
 * Additional Site Pages
 * Commands, Leaderboard, Docs, Changelog, SBX Exchange
 */

const express = require('express');
const router = express.Router();

const COMMANDS_PAGE = require('./pages/commands.html');
const LEADERBOARD_PAGE = require('./pages/leaderboard.html');
const SBX_PAGE = require('./pages/sbx.html');
const CRYPTO_PAGE = require('./pages/crypto.html');
const DOCS_PAGE = require('./pages/docs.html');
const STATUS_PAGE = require('./pages/status.html');
const CHANGELOG_PAGE = require('./pages/changelog.html');

// ============================================================================
// ROUTES
// ============================================================================

router.get('/commands', (req, res) => {
    res.type('html').send(COMMANDS_PAGE);
});

router.get('/leaderboard', (req, res) => {
    res.type('html').send(LEADERBOARD_PAGE);
});

router.get('/sbx', (req, res) => {
    res.type('html').send(SBX_PAGE);
});

router.get('/docs', (req, res) => {
    res.type('html').send(DOCS_PAGE);
});

router.get('/changelog', (req, res) => {
    res.type('html').send(CHANGELOG_PAGE);
});

router.get('/crypto', (req, res) => {
    res.type('html').send(CRYPTO_PAGE);
});

router.get('/status', (req, res) => {
    res.type('html').send(STATUS_PAGE);
});

// Dashboard redirect to moderator login
router.get('/dashboard', (req, res, next) => {
    // Check if already handled by dashboard route
    if (req.originalUrl.startsWith('/dashboard/')) {
        return next();
    }
    // Redirect to moderator dashboard login
    res.redirect('/moderator/login');
});

// Shop alias -> store
router.get('/shop', (req, res) => {
    res.redirect('/store');
});

module.exports = router;
