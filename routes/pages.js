'use strict';

/**
 * Additional Site Pages
 * Status
 */

const express = require('express');
const router = express.Router();

const STATUS_PAGE = require('./pages/status.html');

// ============================================================================
// ROUTES
// ============================================================================

router.get('/status', (req, res) => {
    res.type('html').send(STATUS_PAGE);
});

module.exports = router;
