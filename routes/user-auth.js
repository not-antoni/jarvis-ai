'use strict';

/**
 * User Authentication Routes
 * Discord OAuth flow for website users
 */

const express = require('express');
const router = express.Router();
const userAuth = require('../src/services/user-auth');

// Detect if we're on HTTPS (for cookie secure flag)
const isHttps = (userAuth.PUBLIC_BASE_URL || '').startsWith('https');

// OAuth login - redirect to Discord
router.get('/auth/login', (req, res) => {
    if (!userAuth.isOAuthConfigured()) {
        return res.status(503).json({ error: 'OAuth not configured' });
    }
    
    // Get OAuth URL with generated state
    const { url, state } = userAuth.getOAuthUrl('/');
    
    // Save state to cookie for CSRF verification
    res.cookie('oauth_state', state, { 
        httpOnly: true, 
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 5 * 60 * 1000 // 5 minutes
    });
    
    res.redirect(url);
});

// OAuth callback
router.get('/auth/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError, error_description } = req.query;
        
        // Check for OAuth error from Discord
        if (oauthError) {
            console.error('[UserAuth] OAuth error from Discord:', oauthError, error_description);
            return res.redirect(`/?error=${oauthError}`);
        }
        
        if (!code) {
            console.error('[UserAuth] No code in callback');
            return res.redirect('/?error=no_code');
        }
        
        // Verify state (CSRF protection) - only if both exist
        const savedState = req.cookies?.oauth_state;
        console.log('[UserAuth] State check - received:', state?.slice(0, 8), 'saved:', savedState?.slice(0, 8));
        
        if (state && savedState && state !== savedState) {
            console.error('[UserAuth] State mismatch');
            return res.redirect('/?error=invalid_state');
        }
        
        // Clear state cookie
        res.clearCookie('oauth_state', { path: '/' });
        
        // Exchange code for token
        console.log('[UserAuth] Exchanging code for token...');
        const tokenData = await userAuth.exchangeCode(code);
        
        // Get user info
        console.log('[UserAuth] Getting Discord user...');
        const discordUser = await userAuth.getDiscordUser(tokenData.access_token);
        console.log('[UserAuth] Got user:', discordUser.username);
        
        // Create session
        const session = userAuth.createSession(
            discordUser,
            tokenData.access_token,
            tokenData.refresh_token
        );
        
        // Set session cookie (30 days)
        res.cookie('jarvis_session', session.token, {
            httpOnly: true,
            secure: isHttps,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
        
        console.log('[UserAuth] Login successful for:', discordUser.username);
        
        // Redirect to home with success
        res.redirect('/?login=success');
        
    } catch (error) {
        console.error('[UserAuth] Callback error:', error.message, error.stack);
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
    
    const botOwnerId = process.env.BOT_OWNER_ID;
    const isOwner = session.odUserId === botOwnerId || session.userId === botOwnerId;
    
    res.json({
        authenticated: true,
        user: {
            id: session.userId,
            odUserId: session.odUserId,
            username: session.username,
            globalName: session.globalName,
            avatar: userAuth.getAvatarUrl(session),
            discriminator: session.discriminator,
            isOwner
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
