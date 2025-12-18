'use strict';

/**
 * User Authentication Routes
 * Discord OAuth flow for website users
 */

const express = require('express');
const router = express.Router();
const userAuth = require('../src/services/user-auth');

// OAuth login - redirect to Discord
router.get('/auth/login', (req, res) => {
    if (!userAuth.isOAuthConfigured()) {
        return res.status(503).json({ error: 'OAuth not configured' });
    }
    
    // Generate state for CSRF protection
    const state = require('crypto').randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { 
        httpOnly: true, 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 5 * 60 * 1000 // 5 minutes
    });
    
    const url = userAuth.getOAuthUrl(state);
    res.redirect(url);
});

// OAuth callback
router.get('/auth/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        
        if (!code) {
            return res.redirect('/?error=no_code');
        }
        
        // Verify state (CSRF protection)
        const savedState = req.cookies?.oauth_state;
        if (state && savedState && state !== savedState) {
            return res.redirect('/?error=invalid_state');
        }
        
        // Clear state cookie
        res.clearCookie('oauth_state');
        
        // Exchange code for token
        const tokenData = await userAuth.exchangeCode(code);
        
        // Get user info
        const discordUser = await userAuth.getDiscordUser(tokenData.access_token);
        
        // Create session
        const session = userAuth.createSession(
            discordUser,
            tokenData.access_token,
            tokenData.refresh_token
        );
        
        // Set session cookie (30 days)
        res.cookie('jarvis_session', session.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
        
        // Redirect to home with success
        res.redirect('/?login=success');
        
    } catch (error) {
        console.error('[UserAuth] Callback error:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Logout
router.get('/auth/logout', (req, res) => {
    const session = userAuth.getSessionFromRequest(req);
    if (session) {
        userAuth.deleteSession(session.token);
    }
    res.clearCookie('jarvis_session');
    res.redirect('/');
});

// Get current user (API)
router.get('/api/user', (req, res) => {
    const session = userAuth.getSessionFromRequest(req);
    
    if (!session) {
        return res.json({ authenticated: false });
    }
    
    res.json({
        authenticated: true,
        user: {
            id: session.userId,
            username: session.username,
            globalName: session.globalName,
            avatar: userAuth.getAvatarUrl(session),
            discriminator: session.discriminator
        }
    });
});

// Check auth status
router.get('/api/auth/status', (req, res) => {
    const session = userAuth.getSessionFromRequest(req);
    res.json({
        authenticated: !!session,
        oauthConfigured: userAuth.isOAuthConfigured()
    });
});

module.exports = router;
