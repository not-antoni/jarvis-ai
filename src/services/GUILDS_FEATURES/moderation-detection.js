'use strict';

const crypto = require('crypto');

// ============ ENHANCED TRACKING SYSTEMS ============

// Message fingerprinting for raid/copy-paste detection
const messageFingerprints = new Map(); // guildId -> [{hash, userId, timestamp}]
const FINGERPRINT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FINGERPRINT_THRESHOLD = 3; // Same message 3+ times = suspicious

// Member activity tracking (for first-message detection on ANY account)
const memberMessageHistory = new Map(); // guildId -> Map(userId -> {firstMsgTime, msgCount, lastActive})

// Link reputation cache (avoid repeated lookups)
const linkReputationCache = new Map(); // url -> {safe: boolean, checkedAt: timestamp}
const LINK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Known bad domains (updated periodically)
const KNOWN_BAD_DOMAINS = new Set([
    'discord.gift', 'discordgift.com', 'steamcommunity.ru', 'steampowered.ru',
    'discorcl.com', 'dlscord.com', 'disc0rd.com', 'dicsord.com',
    'nitro-gift.com', 'discord-nitro.gift', 'free-nitro.com',
    'cryptoairdrop.xyz', 'eth-airdrop.com', 'btc-giveaway.com'
]);

// Tracked members (new members being monitored)
const trackedMembers = new Map();

// Monitoring settings
const MONITORING_DURATION_MS = 60 * 60 * 1000; // 1 hour
const PAUSE_DURATION_MS = 5 * 60 * 1000; // 5 min pause after detection

// AI Moderation prompts - these run internally and check for specific response format
// The AI MUST respond with exactly "ACTION:FLAG" or "ACTION:SAFE" followed by details
const INTERNAL_MODERATION_PROMPT = `You are Jarvis's internal content moderation system. You run silently in the background.

You will receive message context including:
- Username, User ID, Mention format
- Current date/time
- Message content
- Account age

Analyze for:
- SCAM: crypto scams, fake giveaways, phishing, "free nitro", suspicious links
- SPAM: advertising, repetitive messages, self-promotion, unsolicited DM requests
- HARMFUL: harassment, threats, hate speech, slurs, doxxing
- NSFW: sexual content, explicit material
- MALWARE: malicious links, phishing URLs, IP grabbers

You MUST respond in this EXACT format:
ACTION:FLAG or ACTION:SAFE
SEVERITY:low|medium|high|critical
CATEGORY:scam|spam|harmful|nsfw|malware|safe
REASON:<brief explanation>
CONFIDENCE:<0.0-1.0>

Example unsafe response:
ACTION:FLAG
SEVERITY:high
CATEGORY:scam
REASON:Message contains fake Discord Nitro link attempting to steal credentials
CONFIDENCE:0.95

Example safe response:
ACTION:SAFE
SEVERITY:low
CATEGORY:safe
REASON:Normal conversation message
CONFIDENCE:0.98`;

const OLLAMA_IMAGE_PROMPT = `You are an advanced image content moderation AI with expertise in detecting scams and harmful content.

CRITICAL - Flag these as HIGH/CRITICAL severity (common on old/compromised accounts):

**CRYPTO/FINANCIAL SCAMS:**
- Screenshots of crypto wallets, Bitcoin transactions, or trading platforms
- People sitting at computers showing trading dashboards or profits
- "Proof" screenshots of payments, withdrawals, or earnings
- Photoshopped bank statements or transaction confirmations
- Images showing "guaranteed returns" or investment opportunities
- Telegram/WhatsApp screenshots showing "successful trades"
- Celebrity endorsement images (often fake)

**QR CODES (HIGH PRIORITY):**
- ANY QR code should be flagged as suspicious
- QR codes are commonly used for crypto wallet scams
- Even legitimate-looking QR codes in DMs are suspicious

**FAKE DISCORD/GAMING:**
- Fake Discord Nitro gift images
- Steam gift card/wallet screenshots
- Fake giveaway winner announcements
- Screenshots designed to build fake trust

**SOCIAL ENGINEERING:**
- Fake customer support screenshots
- Impersonation of Discord staff
- "Verify your account" type images
- Fake ban/suspension warnings

Also check for:
- NSFW/inappropriate/sexual content
- Gore or disturbing content
- Spam/advertising images
- Fake giveaway announcements

Respond in this EXACT format:
ACTION:FLAG or ACTION:SAFE
SEVERITY:low|medium|high|critical
CATEGORY:crypto_scam|qr_code|nsfw|gore|spam|phishing|safe
REASON:<brief explanation of what you detected>
CONFIDENCE:<0.0-1.0>`;

// Risk scoring weights - Enhanced for old account detection
const RISK_FACTORS = {
    // Account age factors
    newAccount: { days: 7, weight: 30 },
    veryNewAccount: { days: 1, weight: 50 },

    // Server activity factors (works on OLD accounts too)
    noAvatar: { weight: 15 },
    newMember: { days: 1, weight: 20 },
    firstMessageInServer: { weight: 35 },      // First message ever in this server
    longInactive: { days: 30, weight: 25 },    // No messages in 30+ days, now active

    // Content-based factors (account-age independent)
    cryptoKeywords: { weight: 25 },
    urgencyLanguage: { weight: 20 },
    suspiciousLinks: { weight: 35 },
    knownBadDomain: { weight: 50 },            // Domain in blocklist
    massmentions: { weight: 15 },
    excessiveEmoji: { weight: 15 },            // 5+ emojis suggesting spam
    allCaps: { weight: 10 },                   // Shouting (SPAM STYLE)

    // Behavioral factors (catches old compromised accounts)
    copyPasteDetected: { weight: 45 },         // Same message from multiple users
    firstMsgWithLink: { weight: 40 },          // First message contains URL
    firstMsgMassMention: { weight: 50 },       // First message has @everyone/@here
    suspiciousUsername: { weight: 25 },        // Username matches scam patterns
    qrCodeMention: { weight: 35 }              // Message mentions QR code scanning
};

// Suspicious username patterns (for old compromised accounts)
const SUSPICIOUS_USERNAME_PATTERNS = [
    /support.*discord/i, /discord.*support/i,
    /admin.*help/i, /help.*admin/i,
    /free.*nitro/i, /nitro.*free/i,
    /crypto.*trader/i, /trader.*crypto/i,
    /investment.*expert/i, /forex.*master/i,
    /^[a-z]{2,4}\d{6,}$/i  // Random letters + many numbers (bot pattern)
];

// Spam tracking for anti-spam module
const spamTracker = new Map(); // guildId:userId -> { messages: [], lastViolation: timestamp }
const raidTracker = new Map(); // guildId -> { joins: [timestamps] }

// Severity levels
const SEVERITY_LEVELS = { low: 1, medium: 2, high: 3, critical: 4 };

// Fallback patterns for when AI is unavailable
const FALLBACK_PATTERNS = [
    { pattern: /free\s*nitro|discord\.gift|discordgift/i, category: 'scam', severity: 'high' },
    {
        pattern: /click\s*(here|this|now)|bit\.ly|tinyurl|t\.co/i,
        category: 'spam',
        severity: 'medium'
    },
    {
        pattern: /crypto\s*(airdrop|giveaway)|nft\s*(mint|drop|free)/i,
        category: 'scam',
        severity: 'high'
    },
    {
        pattern: /earn\s*\$\d+|investment\s*opportunity|passive\s*income/i,
        category: 'scam',
        severity: 'high'
    },
    { pattern: /18\+|nsfw|onlyfans|fansly|porn/i, category: 'nsfw', severity: 'medium' },
    { pattern: /@everyone|@here/i, category: 'spam', severity: 'low' },
    { pattern: /dm\s*me|check\s*my\s*(bio|profile)/i, category: 'spam', severity: 'low' }
];

// ============ FINGERPRINT / COPY-PASTE DETECTION ============

/**
 * Get message fingerprint hash for copy-paste detection
 */
function getMessageFingerprint(content) {
    if (!content || content.length < 20) return null;
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Check if message is a copy-paste (same content from multiple users)
 */
function checkCopyPaste(guildId, userId, content) {
    const hash = getMessageFingerprint(content);
    if (!hash) return { detected: false };

    const now = Date.now();
    let guildFingerprints = messageFingerprints.get(guildId) || [];

    // Clean old fingerprints
    guildFingerprints = guildFingerprints.filter(f => now - f.timestamp < FINGERPRINT_WINDOW_MS);

    // Count occurrences of this hash from different users
    const sameHashFromOthers = guildFingerprints.filter(
        f => f.hash === hash && f.userId !== userId
    );

    // Add current message
    guildFingerprints.push({ hash, userId, timestamp: now });

    // Limit size
    if (guildFingerprints.length > 100) {
        guildFingerprints = guildFingerprints.slice(-100);
    }

    messageFingerprints.set(guildId, guildFingerprints);

    return {
        detected: sameHashFromOthers.length >= FINGERPRINT_THRESHOLD - 1,
        count: sameHashFromOthers.length + 1
    };
}

// ============ MEMBER ACTIVITY TRACKING ============

/**
 * Check if this is user's first message in server
 */
function isFirstMessageInServer(guildId, userId) {
    const guildHistory = memberMessageHistory.get(guildId);
    if (!guildHistory) return true;
    const userHistory = guildHistory.get(userId);
    return !userHistory || userHistory.msgCount === 0;
}

/**
 * Check if user was inactive for a long time
 */
function wasLongInactive(guildId, userId) {
    const guildHistory = memberMessageHistory.get(guildId);
    if (!guildHistory) return false;
    const userHistory = guildHistory.get(userId);
    if (!userHistory || !userHistory.lastActive) return false;

    const daysSinceActive = (Date.now() - userHistory.lastActive) / (1000 * 60 * 60 * 24);
    return daysSinceActive >= RISK_FACTORS.longInactive.days;
}

/**
 * Update member's message history
 */
function recordMemberActivity(guildId, userId) {
    if (!memberMessageHistory.has(guildId)) {
        memberMessageHistory.set(guildId, new Map());
    }
    const guildHistory = memberMessageHistory.get(guildId);
    const existing = guildHistory.get(userId) || { firstMsgTime: null, msgCount: 0, lastActive: null };

    if (!existing.firstMsgTime) {
        existing.firstMsgTime = Date.now();
    }
    existing.msgCount++;
    existing.lastActive = Date.now();

    guildHistory.set(userId, existing);
}

/**
 * Check if username matches suspicious patterns
 */
function hasSuspiciousUsername(username) {
    if (!username) return false;
    return SUSPICIOUS_USERNAME_PATTERNS.some(pattern => pattern.test(username));
}

// ============ LINK CHECKING ============

/**
 * Check link against known bad domains
 */
function checkKnownBadDomains(content) {
    if (!content) return { found: false };

    const urlRegex = /https?:\/\/([^/\s]+)/gi;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
        const domain = match[1].toLowerCase();
        for (const badDomain of KNOWN_BAD_DOMAINS) {
            if (domain === badDomain || domain.endsWith('.' + badDomain)) {
                return { found: true, domain: badDomain };
            }
        }
    }
    return { found: false };
}

/**
 * Check URLs against Google Safe Browsing API (async, optional)
 * Requires GOOGLE_SAFE_BROWSING_API_KEY in .env
 */
async function checkGoogleSafeBrowsing(urls) {
    const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    if (!apiKey || urls.length === 0) return { unsafe: false, threats: [] };

    // Check cache first
    const now = Date.now();
    const uncachedUrls = urls.filter(url => {
        const cached = linkReputationCache.get(url);
        return !cached || (now - cached.checkedAt) > LINK_CACHE_TTL_MS;
    });

    // All cached and safe
    if (uncachedUrls.length === 0) {
        const threats = urls.filter(url => {
            const cached = linkReputationCache.get(url);
            return cached && !cached.safe;
        });
        return { unsafe: threats.length > 0, threats };
    }

    try {
        const response = await fetch(
            `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client: { clientId: 'jarvis-bot', clientVersion: '1.0.0' },
                    threatInfo: {
                        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                        platformTypes: ['ANY_PLATFORM'],
                        threatEntryTypes: ['URL'],
                        threatEntries: uncachedUrls.map(url => ({ url }))
                    }
                })
            }
        );

        if (!response.ok) {
            console.warn('[SafeBrowsing] API error:', response.status);
            return { unsafe: false, threats: [] };
        }

        const data = await response.json();
        const matches = data.matches || [];
        const threatUrls = new Set(matches.map(m => m.threat?.url).filter(Boolean));

        // Cache results
        for (const url of uncachedUrls) {
            linkReputationCache.set(url, {
                safe: !threatUrls.has(url),
                checkedAt: now,
                threatType: matches.find(m => m.threat?.url === url)?.threatType || null
            });
        }

        return {
            unsafe: threatUrls.size > 0,
            threats: Array.from(threatUrls)
        };
    } catch (error) {
        console.warn('[SafeBrowsing] Check failed:', error.message);
        return { unsafe: false, threats: [] };
    }
}

/**
 * Extract all URLs from content
 */
function extractUrls(content) {
    if (!content) return [];
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    return content.match(urlRegex) || [];
}

// ============ RISK SCORING ============

/**
 * Calculate risk score for a message/user (Enhanced for old accounts)
 */
function calculateRiskScore(message, member, context) {
    let score = 0;
    const factors = [];
    const guildId = message.guild?.id;
    const userId = message.author.id;
    const content = context.messageContent || '';

    // ============ ACCOUNT AGE FACTORS ============
    if (context.accountAgeDays < 1) {
        score += RISK_FACTORS.veryNewAccount.weight;
        factors.push('Very new account (<1 day)');
    } else if (context.accountAgeDays < 7) {
        score += RISK_FACTORS.newAccount.weight;
        factors.push('New account (<7 days)');
    }

    // No avatar
    if (!message.author.avatar) {
        score += RISK_FACTORS.noAvatar.weight;
        factors.push('Default avatar');
    }

    // New to server
    if (context.memberAgeDays !== null && context.memberAgeDays < 1) {
        score += RISK_FACTORS.newMember.weight;
        factors.push('Just joined server');
    }

    // ============ BEHAVIORAL FACTORS (OLD ACCOUNT DETECTION) ============

    // First message in server (catches sleeper/compromised accounts)
    const isFirstMsg = isFirstMessageInServer(guildId, userId);
    if (isFirstMsg) {
        score += RISK_FACTORS.firstMessageInServer.weight;
        factors.push('First message in server');

        // First message with link = very suspicious
        if (/https?:\/\//i.test(content)) {
            score += RISK_FACTORS.firstMsgWithLink.weight;
            factors.push('First msg contains link');
        }

        // First message with mass mention = critical
        if (/@everyone|@here/.test(content)) {
            score += RISK_FACTORS.firstMsgMassMention.weight;
            factors.push('First msg has mass mention');
        }
    }

    // Long inactive user suddenly active
    if (wasLongInactive(guildId, userId)) {
        score += RISK_FACTORS.longInactive.weight;
        factors.push('Was inactive 30+ days');
    }

    // Copy-paste detection (raid indicator)
    const copyPaste = checkCopyPaste(guildId, userId, content);
    if (copyPaste.detected) {
        score += RISK_FACTORS.copyPasteDetected.weight;
        factors.push(`Copy-paste detected (${copyPaste.count}x)`);
    }

    // Suspicious username
    if (hasSuspiciousUsername(message.author.username) || hasSuspiciousUsername(message.author.displayName)) {
        score += RISK_FACTORS.suspiciousUsername.weight;
        factors.push('Suspicious username pattern');
    }

    // ============ CONTENT-BASED FACTORS ============

    // Crypto keywords
    const cryptoPattern = /crypto|bitcoin|btc|eth|ethereum|nft|airdrop|wallet|blockchain|defi|token|binance|coinbase/i;
    if (cryptoPattern.test(content)) {
        score += RISK_FACTORS.cryptoKeywords.weight;
        factors.push('Crypto keywords');
    }

    // Urgency language
    const urgencyPattern = /act now|limited time|hurry|fast|quick|urgent|immediately|don't miss|last chance|expires soon/i;
    if (urgencyPattern.test(content)) {
        score += RISK_FACTORS.urgencyLanguage.weight;
        factors.push('Urgency language');
    }

    // QR code mentions
    if (/qr\s*code|scan\s*(this|the|my)/i.test(content)) {
        score += RISK_FACTORS.qrCodeMention.weight;
        factors.push('QR code mention');
    }

    // Known bad domains
    const badDomain = checkKnownBadDomains(content);
    if (badDomain.found) {
        score += RISK_FACTORS.knownBadDomain.weight;
        factors.push(`Known bad domain: ${badDomain.domain}`);
    }

    // Suspicious links (shortened URLs)
    const linkPattern = /bit\.ly|tinyurl|t\.co|is\.gd|goo\.gl|ow\.ly|buff\.ly/i;
    if (linkPattern.test(content)) {
        score += RISK_FACTORS.suspiciousLinks.weight;
        factors.push('Shortened URLs');
    }

    // Mass mentions
    if (/@everyone|@here/.test(content) && !isFirstMsg) {
        score += RISK_FACTORS.massmentions.weight;
        factors.push('Mass mentions');
    }

    // Excessive emoji (spam indicator)
    const emojiCount = (content.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount >= 5) {
        score += RISK_FACTORS.excessiveEmoji.weight;
        factors.push(`Excessive emoji (${emojiCount})`);
    }

    // ALL CAPS (shouting/spam)
    const words = content.split(/\s+/).filter(w => w.length > 2);
    const capsWords = words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w));
    if (words.length >= 5 && capsWords.length / words.length > 0.6) {
        score += RISK_FACTORS.allCaps.weight;
        factors.push('Excessive caps');
    }

    // Record this message for future reference
    recordMemberActivity(guildId, userId);

    return { score: Math.min(score, 100), factors };
}

// ============ AUTO-MOD MODULES ============

/**
 * Check all auto-mod modules
 * Returns { triggered: boolean, module: string, action: string, reason: string }
 */
function checkAutoModules(message, settings) {
    const content = message.content || '';
    const guildId = message.guild.id;
    const userId = message.author.id;

    // Anti-Spam (message rate)
    if (settings.antiSpam) {
        const key = `${guildId}:${userId}`;
        const now = Date.now();
        let userData = spamTracker.get(key) || { messages: [], lastViolation: 0 };

        // Clean old messages outside window
        userData.messages = userData.messages.filter(t => now - t < settings.antiSpamWindow);
        userData.messages.push(now);

        // Optimization: Cap array size to prevent memory bloat (max needed + buffer)
        const maxNeeded = (settings.antiSpamMaxMessages || 5) + 5;
        if (userData.messages.length > maxNeeded) {
            userData.messages = userData.messages.slice(-maxNeeded);
        }

        spamTracker.set(key, userData);

        if (userData.messages.length > settings.antiSpamMaxMessages) {
            // Cooldown to prevent spam alerts
            if (now - userData.lastViolation > 30000) {
                userData.lastViolation = now;
                spamTracker.set(key, userData);
                return {
                    triggered: true,
                    module: 'Anti-Spam',
                    action: settings.antiSpamAction,
                    reason: `Sent ${userData.messages.length} messages in ${settings.antiSpamWindow / 1000}s`
                };
            }
        }
    }

    // Anti-Mention Spam
    if (settings.antiMentionSpam) {
        const mentionCount = (message.mentions.users?.size || 0) +
            (message.mentions.roles?.size || 0) +
            (message.mentions.everyone ? 10 : 0);
        if (mentionCount > settings.antiMentionMax) {
            return {
                triggered: true,
                module: 'Anti-Mention',
                action: settings.antiMentionAction,
                reason: `${mentionCount} mentions (max: ${settings.antiMentionMax})`
            };
        }
    }

    // Anti-Emoji Spam
    if (settings.antiEmojiSpam) {
        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:[a-zA-Z0-9_]+:\d+>)/gu;
        const emojiCount = (content.match(emojiRegex) || []).length;
        if (emojiCount > settings.antiEmojiMax) {
            return {
                triggered: true,
                module: 'Anti-Emoji',
                action: settings.antiEmojiAction,
                reason: `${emojiCount} emojis (max: ${settings.antiEmojiMax})`
            };
        }
    }

    // Anti-Caps
    if (settings.antiCaps && content.length >= settings.antiCapsMinLength) {
        const letters = content.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 0) {
            const capsCount = (letters.match(/[A-Z]/g) || []).length;
            const capsPercent = (capsCount / letters.length) * 100;
            if (capsPercent >= settings.antiCapsPercent) {
                return {
                    triggered: true,
                    module: 'Anti-Caps',
                    action: settings.antiCapsAction,
                    reason: `${Math.round(capsPercent)}% caps (max: ${settings.antiCapsPercent}%)`
                };
            }
        }
    }

    // Anti-Invites (Discord invites)
    if (settings.antiInvites) {
        const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;
        if (inviteRegex.test(content)) {
            return {
                triggered: true,
                module: 'Anti-Invite',
                action: settings.antiInvitesAction,
                reason: 'Discord invite link detected'
            };
        }
    }

    // Anti-Links
    if (settings.antiLinks) {
        const urlRegex = /https?:\/\/[^\s]+/gi;
        const urls = content.match(urlRegex) || [];
        const whitelist = settings.antiLinksWhitelist || [];

        for (const url of urls) {
            try {
                const domain = new URL(url).hostname.toLowerCase();
                const isWhitelisted = whitelist.some(w =>
                    domain === w.toLowerCase() || domain.endsWith('.' + w.toLowerCase())
                );
                if (!isWhitelisted) {
                    return {
                        triggered: true,
                        module: 'Anti-Link',
                        action: settings.antiLinksAction,
                        reason: `Link detected: ${domain}`
                    };
                }
            } catch { }
        }
    }

    return { triggered: false };
}

/**
 * Check for raid (mass joins)
 */
function checkRaidDetection(member, settings) {
    if (!settings.antiRaid) return false;

    const guildId = member.guild.id;
    const now = Date.now();

    let raidData = raidTracker.get(guildId) || { joins: [], inLockdown: false };

    // Clean old joins
    raidData.joins = raidData.joins.filter(t => now - t < settings.antiRaidJoinWindow);
    raidData.joins.push(now);

    // Optimization: Cap array size to prevent memory bloat during massive raids
    const maxJoins = (settings.antiRaidJoinThreshold || 10) + 10;
    if (raidData.joins.length > maxJoins) {
        raidData.joins = raidData.joins.slice(-maxJoins);
    }

    raidTracker.set(guildId, raidData);

    if (raidData.joins.length >= settings.antiRaidJoinThreshold && !raidData.inLockdown) {
        raidData.inLockdown = true;
        raidTracker.set(guildId, raidData);

        // Auto-reset lockdown after 5 minutes
        setTimeout(() => {
            const data = raidTracker.get(guildId);
            if (data) {
                data.inLockdown = false;
                data.joins = [];
                raidTracker.set(guildId, data);
            }
        }, 5 * 60 * 1000);

        return {
            detected: true,
            joinCount: raidData.joins.length,
            action: settings.antiRaidAction
        };
    }

    return { detected: false };
}

// ============ AI MODERATION ============

/**
 * Build rich context for AI moderation
 */
function buildModerationContext(message, member) {
    const now = new Date();
    const accountCreated = message.author.createdAt;
    const accountAgeDays = Math.floor((now - accountCreated) / (1000 * 60 * 60 * 24));
    const joinedAt = member?.joinedAt;
    const memberAgeDays = joinedAt ? Math.floor((now - joinedAt) / (1000 * 60 * 60 * 24)) : null;

    return {
        username: message.author.username,
        displayName: message.author.displayName || message.author.username,
        userId: message.author.id,
        mention: `<@${message.author.id}>`,
        isBot: message.author.bot,
        accountCreated: accountCreated.toISOString(),
        accountAgeDays,
        memberAgeDays,
        guildName: message.guild?.name || 'DM',
        guildId: message.guild?.id || null,
        channelName: message.channel?.name || 'DM',
        channelId: message.channel?.id,
        currentTime: now.toISOString(),
        currentDate: now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        messageContent: message.content?.substring(0, 1000) || '',
        hasAttachments: message.attachments?.size > 0,
        attachmentCount: message.attachments?.size || 0
    };
}

/**
 * Format context for AI prompt
 */
function formatContextForAI(context) {
    return `=== MESSAGE CONTEXT ===
User: ${context.displayName} (@${context.username})
User ID: ${context.userId}
Mention: ${context.mention}
Account Age: ${context.accountAgeDays} days old
Member Age: ${context.memberAgeDays !== null ? `${context.memberAgeDays} days in server` : 'Unknown'}
Server: ${context.guildName}
Channel: #${context.channelName}
Date/Time: ${context.currentDate} at ${new Date(context.currentTime).toLocaleTimeString()}

=== MESSAGE CONTENT ===
${context.messageContent}

=== ATTACHMENTS ===
${context.hasAttachments ? `${context.attachmentCount} attachment(s)` : 'None'}`;
}

/**
 * Parse AI response in the specific format
 */
function parseAIResponse(response) {
    if (!response || typeof response !== 'string') {
        return null;
    }

    const result = {
        isUnsafe: false,
        severity: 'low',
        categories: [],
        reason: '',
        confidence: 0.5
    };

    // Extract ACTION
    const actionMatch = response.match(/ACTION:\s*(FLAG|SAFE)/i);
    if (actionMatch) {
        result.isUnsafe = actionMatch[1].toUpperCase() === 'FLAG';
    }

    // Extract SEVERITY
    const severityMatch = response.match(/SEVERITY:\s*(low|medium|high|critical)/i);
    if (severityMatch) {
        result.severity = severityMatch[1].toLowerCase();
    }

    // Extract CATEGORY
    const categoryMatch = response.match(/CATEGORY:\s*(\w+)/i);
    if (categoryMatch && categoryMatch[1].toLowerCase() !== 'safe') {
        result.categories = [categoryMatch[1].toLowerCase()];
    }

    // Extract REASON - everything after REASON: until the next field or end
    const reasonMatch = response.match(/REASON:\s*(.+?)(?=\s*(?:CONFIDENCE:|$))/is);
    if (reasonMatch) {
        result.reason = reasonMatch[1].trim();
    }

    // Extract CONFIDENCE
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
        const conf = parseFloat(confidenceMatch[1]);
        if (!isNaN(conf) && conf >= 0 && conf <= 1) {
            result.confidence = conf;
        }
    }

    return result;
}

/**
 * Analyze with fallback patterns (no AI needed)
 */
function analyzeWithPatterns(content) {
    for (const { pattern, category, severity } of FALLBACK_PATTERNS) {
        if (pattern.test(content)) {
            return {
                success: true,
                result: {
                    isUnsafe: true,
                    severity,
                    categories: [category],
                    reason: `Matched pattern: ${category}`,
                    confidence: 0.7
                }
            };
        }
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'No patterns matched',
            confidence: 1.0
        }
    };
}

/**
 * Analyze text content using internal AI moderation
 */
async function analyzeTextContent(message, member, settings) {
    const context = buildModerationContext(message, member);
    const contextString = formatContextForAI(context);

    // Run Google Safe Browsing check in parallel (non-blocking)
    const urls = extractUrls(context.messageContent);
    const safeBrowsingPromise = urls.length > 0
        ? checkGoogleSafeBrowsing(urls).catch(() => ({ unsafe: false, threats: [] }))
        : Promise.resolve({ unsafe: false, threats: [] });

    // Try AI first if enabled
    if (settings?.useAI) {
        try {
            const aiManager = require('../ai-providers');

            // Use the correct method signature: generateResponse(systemPrompt, userPrompt, maxTokens)
            const response = await aiManager.generateResponse(
                INTERNAL_MODERATION_PROMPT,
                contextString,
                200
            );

            if (response?.content) {
                const parsed = parseAIResponse(response.content);
                if (parsed) {
                    // Enhance with Safe Browsing results
                    const safeBrowsing = await safeBrowsingPromise;
                    if (safeBrowsing.unsafe && !parsed.isUnsafe) {
                        parsed.isUnsafe = true;
                        parsed.severity = 'high';
                        parsed.categories = ['malware'];
                        parsed.reason = `Google Safe Browsing flagged: ${safeBrowsing.threats.join(', ')}`;
                        parsed.confidence = 0.95;
                    }
                    return { success: true, result: parsed, context };
                }
            }
        } catch (error) {
            console.warn('[Moderation] AI analysis failed, using fallback:', error.message);
        }
    }

    // Fallback to pattern matching
    if (settings?.useFallbackPatterns !== false) {
        const patternResult = analyzeWithPatterns(context.messageContent);

        // Enhance with Safe Browsing results
        const safeBrowsing = await safeBrowsingPromise;
        if (safeBrowsing.unsafe && !patternResult.result?.isUnsafe) {
            patternResult.result = {
                isUnsafe: true,
                severity: 'high',
                categories: ['malware'],
                reason: `Google Safe Browsing flagged: ${safeBrowsing.threats.join(', ')}`,
                confidence: 0.95
            };
        }

        return { ...patternResult, context };
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'AI unavailable',
            confidence: 0.5
        },
        context
    };
}

/**
 * Analyze image content using Ollama with rich context
 */
async function analyzeImageContent(imageUrl, message, member, settings) {
    const context = buildModerationContext(message, member);

    try {
        const aiManager = require('../ai-providers');

        // Build context-aware prompt for image analysis
        const contextPrompt = `${OLLAMA_IMAGE_PROMPT}

=== CONTEXT ===
User: ${context.displayName} (@${context.username})
User ID: ${context.userId}
Account Age: ${context.accountAgeDays} days
Date/Time: ${context.currentDate}
Server: ${context.guildName}`;

        // Use the ai-providers module to handle image analysis
        const response = await aiManager.generateResponseWithImages(
            OLLAMA_IMAGE_PROMPT,
            contextPrompt,
            [{ url: imageUrl }],
            200,
            { allowModerationOnly: true }
        );

        if (response?.content) {
            // Try parsing with our format first
            const parsed = parseAIResponse(response.content);
            if (parsed) {
                return { success: true, result: parsed, context };
            }

            // Fallback to JSON parsing
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const jsonResult = JSON.parse(jsonMatch[0]);
                    console.log('[Moderation] JSON parsed result:', JSON.stringify(jsonResult));
                    return { success: true, result: jsonResult, context };
                } catch { }
            }
        }
    } catch (error) {
        console.warn('[Moderation] Image analysis failed:', error.message);
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'Could not analyze',
            confidence: 0.3
        },
        context
    };
}

// ============ TRACKING ============

function shouldMonitorMember(member, settings) {
    if (!settings.monitorNewMembers) return false;
    const accountAge = Date.now() - member.user.createdAt.getTime();
    const thresholdMs = settings.newMemberThresholdDays * 24 * 60 * 60 * 1000;
    return accountAge < thresholdMs;
}

function startTracking(guildId, userId) {
    if (!trackedMembers.has(guildId)) {
        trackedMembers.set(guildId, new Map());
    }
    trackedMembers.get(guildId).set(userId, {
        joinedAt: Date.now(),
        lastMessageAt: null,
        messageCount: 0,
        paused: false
    });
}

function isActivelyTracking(guildId, userId) {
    const guildTracked = trackedMembers.get(guildId);
    if (!guildTracked) return false;

    const tracking = guildTracked.get(userId);
    if (!tracking) return false;

    if (Date.now() - tracking.joinedAt > MONITORING_DURATION_MS) {
        guildTracked.delete(userId);
        return false;
    }

    if (tracking.paused && tracking.pausedUntil && Date.now() < tracking.pausedUntil) {
        return false;
    }

    tracking.paused = false;
    return true;
}

function pauseTracking(guildId, userId) {
    const tracking = trackedMembers.get(guildId)?.get(userId);
    if (tracking) {
        tracking.paused = true;
        tracking.pausedUntil = Date.now() + PAUSE_DURATION_MS;
    }
}

// ============ SEVERITY CHECK ============

function meetsMinSeverity(resultSeverity, minSeverity) {
    return (SEVERITY_LEVELS[resultSeverity] || 0) >= (SEVERITY_LEVELS[minSeverity] || 2);
}

module.exports = {
    // Shared state
    trackedMembers,

    // Detection functions
    calculateRiskScore,
    isFirstMessageInServer,
    recordMemberActivity,
    extractUrls,

    // Auto-mod
    checkAutoModules,
    checkRaidDetection,

    // AI analysis
    buildModerationContext,
    parseAIResponse,
    analyzeWithPatterns,
    analyzeTextContent,
    analyzeImageContent,

    // Tracking
    shouldMonitorMember,
    startTracking,
    isActivelyTracking,
    pauseTracking,

    // Severity
    meetsMinSeverity
};
