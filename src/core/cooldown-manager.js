/**
 * Global cooldown manager with per-user, per-key rate limits.
 * Designed to replace the ad-hoc cooldown map inside DiscordHandlers.
 */

const DEFAULT_MAX_ENTRIES = 50_000;

class CooldownManager {
    constructor({ defaultCooldownMs = 5_000, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
        this.defaultCooldownMs = Number.isFinite(defaultCooldownMs) && defaultCooldownMs > 0
            ? defaultCooldownMs
            : 5_000;
        this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0
            ? maxEntries
            : DEFAULT_MAX_ENTRIES;
        this.cooldowns = new Map();
    }

    /**
     * Returns a composite string key for the cooldown map.
     */
    static makeKey(scope, userId) {
        return `${scope}::${userId}`;
    }

    /**
     * Checks whether the requested scope is currently rate limited for the user.
     * Returns an object with { limited, remainingMs }.
     */
    isLimited(scope, userId, cooldownMs = null) {
        const effectiveCooldown = Number.isFinite(cooldownMs)
            ? Math.max(0, cooldownMs)
            : this.defaultCooldownMs;

        const now = Date.now();
        const key = CooldownManager.makeKey(scope, userId);
        const last = this.cooldowns.get(key);

        if (!last) {
            return { limited: false, remainingMs: 0 };
        }

        const elapsed = now - last;
        if (elapsed >= effectiveCooldown) {
            return { limited: false, remainingMs: 0 };
        }

        return { limited: true, remainingMs: effectiveCooldown - elapsed };
    }

    /**
     * Marks the scope as used for the user if not already rate-limited.
     * Returns the limiter result for convenience.
     */
    hit(scope, userId, cooldownMs = null) {
        const result = this.isLimited(scope, userId, cooldownMs);
        if (!result.limited) {
            this.set(scope, userId);
        }
        return result;
    }

    /**
     * Forcefully sets the cooldown timestamp to now, regardless of existing state.
     */
    set(scope, userId) {
        const key = CooldownManager.makeKey(scope, userId);
        if (this.cooldowns.size >= this.maxEntries) {
            this.prune();
        }
        this.cooldowns.set(key, Date.now());
    }

    /**
     * Clears a cooldown entry for a scope/user pair.
     */
    clear(scope, userId) {
        const key = CooldownManager.makeKey(scope, userId);
        this.cooldowns.delete(key);
    }

    /**
     * Removes stale entries older than the longest observed cooldown.
     * When we don't have an explicit duration, fall back to the default window.
     */
    prune(maxAgeMs = null) {
        const now = Date.now();
        const windowMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0
            ? maxAgeMs
            : Math.max(this.defaultCooldownMs * 10, 60 * 60 * 1000);

        for (const [key, timestamp] of this.cooldowns.entries()) {
            if (now - timestamp > windowMs) {
                this.cooldowns.delete(key);
            }
        }
    }

    /**
     * Returns a snapshot useful for debugging or telemetry.
     */
    inspect(scope = null) {
        if (!scope) {
            return { size: this.cooldowns.size };
        }

        const prefix = `${scope}::`;
        let count = 0;
        for (const key of this.cooldowns.keys()) {
            if (key.startsWith(prefix)) {
                count += 1;
            }
        }
        return { size: count };
    }
}

module.exports = CooldownManager;

