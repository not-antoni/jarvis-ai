/**
 * Advanced Session Manager - Persistent session state, cross-session data sharing,
 * session pooling, and intelligent session lifecycle management
 */

const fs = require('fs').promises;
const path = require('path');

class AdvancedSessionManager {
    constructor(config = {}) {
        this.sessionStore = new Map(); // sessionId -> sessionData
        this.sessionPool = []; // Warm pool of ready sessions
        this.persistenceDir = config.persistenceDir || './session-data';
        this.maxPoolSize = config.maxPoolSize || 5;
        this.sessionTTLMs = config.sessionTTLMs || 60 * 60 * 1000; // 1 hour
        this.persistState = config.persistState !== false; // Enable by default
        
        this.stats = {
            totalCreated: 0,
            totalDestroyed: 0,
            poolReuses: 0,
            persistSaves: 0,
            persistLoads: 0
        };

        this.initPersistence();
    }

    /**
     * Initialize persistence directory
     */
    async initPersistence() {
        if (!this.persistState) return;

        try {
            await fs.mkdir(this.persistenceDir, { recursive: true });
        } catch (error) {
            console.error('[AdvancedSessionManager] Failed to create persistence dir:', error.message);
        }
    }

    /**
     * Create new session with optional persistent state
     */
    async createSession(sessionId, options = {}) {
        const session = {
            id: sessionId,
            createdAt: Date.now(),
            lastAccessAt: Date.now(),
            accessCount: 0,
            cookies: [],
            localStorage: {},
            sessionStorage: {},
            metadata: options.metadata || {},
            browser: options.browser || null,
            page: options.page || null,
            dataSharing: new Map() // Share data across contexts
        };

        // Try to restore from persistence
        if (this.persistState && options.restoreState !== false) {
            const restored = await this.loadSessionState(sessionId);
            if (restored) {
                session.cookies = restored.cookies || [];
                session.localStorage = restored.localStorage || {};
                session.sessionStorage = restored.sessionStorage || {};
                this.stats.persistLoads++;
            }
        }

        this.sessionStore.set(sessionId, session);
        this.stats.totalCreated++;

        return session;
    }

    /**
     * Get or create session from pool
     */
    async acquireFromPool(options = {}) {
        if (this.sessionPool.length > 0) {
            const sessionId = this.sessionPool.shift();
            const session = this.sessionStore.get(sessionId);
            
            if (session) {
                session.lastAccessAt = Date.now();
                session.accessCount++;
                this.stats.poolReuses++;
                return session;
            }
        }

        // Create new session
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        return this.createSession(newSessionId, options);
    }

    /**
     * Release session back to pool
     */
    async releaseToPool(sessionId) {
        const session = this.sessionStore.get(sessionId);
        if (!session) return;

        // Persist state
        if (this.persistState) {
            await this.saveSessionState(sessionId, session);
        }

        // Add to pool if not full
        if (this.sessionPool.length < this.maxPoolSize) {
            this.sessionPool.push(sessionId);
        } else {
            // Destroy if pool full
            await this.destroySession(sessionId);
        }
    }

    /**
     * Share data across sessions
     */
    shareData(fromSessionId, toSessionId, key, value) {
        const fromSession = this.sessionStore.get(fromSessionId);
        const toSession = this.sessionStore.get(toSessionId);

        if (!fromSession || !toSession) {
            throw new Error('Session not found');
        }

        toSession.dataSharing.set(key, {
            value,
            source: fromSessionId,
            sharedAt: Date.now()
        });
    }

    /**
     * Get shared data
     */
    getSharedData(sessionId, key) {
        const session = this.sessionStore.get(sessionId);
        if (!session) return null;

        const shared = session.dataSharing.get(key);
        return shared ? shared.value : null;
    }

    /**
     * Sync cookies across sessions
     */
    async syncCookies(fromSessionId, toSessionId, page) {
        const fromSession = this.sessionStore.get(fromSessionId);
        const toSession = this.sessionStore.get(toSessionId);

        if (!fromSession || !toSession || !page) return;

        try {
            // Copy cookies
            for (const cookie of fromSession.cookies) {
                await page.setCookie(cookie);
            }

            // Store in target session
            toSession.cookies = fromSession.cookies;
        } catch (error) {
            console.error('[AdvancedSessionManager] Cookie sync failed:', error.message);
        }
    }

    /**
     * Sync local storage across sessions
     */
    async syncLocalStorage(fromSessionId, toSessionId, page) {
        const fromSession = this.sessionStore.get(fromSessionId);
        const toSession = this.sessionStore.get(toSessionId);

        if (!fromSession || !toSession || !page) return;

        try {
            await page.evaluate((data) => {
                for (const [key, value] of Object.entries(data)) {
                    localStorage.setItem(key, value);
                }
            }, fromSession.localStorage);

            toSession.localStorage = { ...fromSession.localStorage };
        } catch (error) {
            console.error('[AdvancedSessionManager] Local storage sync failed:', error.message);
        }
    }

    /**
     * Capture session state from page
     */
    async capturePageState(sessionId, page) {
        const session = this.sessionStore.get(sessionId);
        if (!session || !page) return;

        try {
            // Capture cookies
            session.cookies = await page.cookies();

            // Capture local storage
            session.localStorage = await page.evaluate(() => {
                const data = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    data[key] = localStorage.getItem(key);
                }
                return data;
            });

            // Capture session storage
            session.sessionStorage = await page.evaluate(() => {
                const data = {};
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    data[key] = sessionStorage.getItem(key);
                }
                return data;
            });

            session.lastAccessAt = Date.now();
        } catch (error) {
            console.error('[AdvancedSessionManager] State capture failed:', error.message);
        }
    }

    /**
     * Restore session state to page
     */
    async restorePageState(sessionId, page) {
        const session = this.sessionStore.get(sessionId);
        if (!session || !page) return;

        try {
            // Restore cookies
            if (session.cookies.length > 0) {
                await page.setCookie(...session.cookies);
            }

            // Restore local storage
            if (Object.keys(session.localStorage).length > 0) {
                await page.evaluate((data) => {
                    for (const [key, value] of Object.entries(data)) {
                        localStorage.setItem(key, value);
                    }
                }, session.localStorage);
            }

            session.lastAccessAt = Date.now();
        } catch (error) {
            console.error('[AdvancedSessionManager] State restore failed:', error.message);
        }
    }

    /**
     * Save session state to disk
     */
    async saveSessionState(sessionId, session) {
        if (!this.persistState) return;

        try {
            const filePath = path.join(this.persistenceDir, `${sessionId}.json`);
            
            const state = {
                id: session.id,
                createdAt: session.createdAt,
                cookies: session.cookies,
                localStorage: session.localStorage,
                sessionStorage: session.sessionStorage,
                metadata: session.metadata,
                savedAt: Date.now()
            };

            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
            this.stats.persistSaves++;
        } catch (error) {
            console.error('[AdvancedSessionManager] Save state failed:', error.message);
        }
    }

    /**
     * Load session state from disk
     */
    async loadSessionState(sessionId) {
        if (!this.persistState) return null;

        try {
            const filePath = path.join(this.persistenceDir, `${sessionId}.json`);
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            return null; // File doesn't exist or error reading
        }
    }

    /**
     * Destroy session
     */
    async destroySession(sessionId) {
        const session = this.sessionStore.get(sessionId);
        if (!session) return;

        // Clean up resources
        if (session.page) {
            try {
                await session.page.close().catch(() => {});
            } catch {}
        }

        this.sessionStore.delete(sessionId);
        this.stats.totalDestroyed++;

        // Remove from persistence
        if (this.persistState) {
            try {
                const filePath = path.join(this.persistenceDir, `${sessionId}.json`);
                await fs.unlink(filePath).catch(() => {});
            } catch {}
        }
    }

    /**
     * Get all sessions
     */
    getSessions() {
        return Array.from(this.sessionStore.values()).map(session => ({
            id: session.id,
            createdAt: session.createdAt,
            lastAccessAt: session.lastAccessAt,
            accessCount: session.accessCount,
            ageMs: Date.now() - session.createdAt,
            hasData: {
                cookies: session.cookies.length,
                localStorage: Object.keys(session.localStorage).length,
                sessionStorage: Object.keys(session.sessionStorage).length
            }
        }));
    }

    /**
     * Cleanup expired sessions
     */
    async cleanup() {
        const now = Date.now();
        const expired = [];

        for (const [sessionId, session] of this.sessionStore.entries()) {
            if (now - session.lastAccessAt > this.sessionTTLMs) {
                expired.push(sessionId);
            }
        }

        for (const sessionId of expired) {
            await this.destroySession(sessionId);
        }

        return expired.length;
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeSessions: this.sessionStore.size,
            poolSize: this.sessionPool.length,
            persistenceEnabled: this.persistState
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        // Save all sessions
        if (this.persistState) {
            for (const [sessionId, session] of this.sessionStore.entries()) {
                await this.saveSessionState(sessionId, session);
            }
        }

        // Destroy all sessions
        const sessionIds = Array.from(this.sessionStore.keys());
        for (const sessionId of sessionIds) {
            await this.destroySession(sessionId);
        }

        this.sessionPool = [];
    }
}

module.exports = AdvancedSessionManager;
