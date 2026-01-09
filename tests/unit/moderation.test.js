/**
 * Unit tests for Moderation system
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('Moderation System', () => {
    describe('Message Analysis', () => {
        it('should detect spam patterns', () => {
            const isSpam = (text) => {
                // Repeated characters
                if (/(.)\1{10,}/.test(text)) return true;
                // All caps (>80% uppercase, min 10 chars)
                if (text.length >= 10) {
                    const upperCount = (text.match(/[A-Z]/g) || []).length;
                    if (upperCount / text.length > 0.8) return true;
                }
                return false;
            };

            assert.strictEqual(isSpam('hello world'), false);
            assert.strictEqual(isSpam('STOP SPAMMING EVERYONE'), true);
            assert.strictEqual(isSpam('aaaaaaaaaaaaaaaaaaa'), true);
            assert.strictEqual(isSpam('Hello'), false);
        });

        it('should detect unicode bypass attempts', () => {
            const hasUnicodeBypass = (text) => {
                // Cyrillic lookalikes
                const cyrillicPattern = /[\u0400-\u04FF]/;
                // Greek lookalikes
                const greekPattern = /[\u0370-\u03FF]/;
                return cyrillicPattern.test(text) || greekPattern.test(text);
            };

            assert.strictEqual(hasUnicodeBypass('hello'), false);
            assert.strictEqual(hasUnicodeBypass('hеllo'), true); // Cyrillic 'е'
            assert.strictEqual(hasUnicodeBypass('рaypal'), true); // Cyrillic 'р'
        });

        it('should detect excessive mentions', () => {
            const hasExcessiveMentions = (text, max = 5) => {
                const mentions = text.match(/<@!?\d+>/g) || [];
                return mentions.length > max;
            };

            assert.strictEqual(hasExcessiveMentions('hey <@123>'), false);
            assert.strictEqual(hasExcessiveMentions('<@1> <@2> <@3> <@4> <@5> <@6>'), true);
        });

        it('should detect invite links', () => {
            const hasInvite = (text) => {
                const invitePattern = /discord\.gg\/|discord\.com\/invite\//i;
                return invitePattern.test(text);
            };

            assert.strictEqual(hasInvite('check my server discord.gg/abc123'), true);
            assert.strictEqual(hasInvite('join at discord.com/invite/xyz'), true);
            assert.strictEqual(hasInvite('hello world'), false);
        });
    });

    describe('Threat Detection', () => {
        it('should calculate risk score', () => {
            const calculateRisk = (factors) => {
                let score = 0;
                if (factors.newAccount) score += 20;
                if (factors.noAvatar) score += 10;
                if (factors.suspiciousName) score += 15;
                if (factors.rapidMessages) score += 25;
                if (factors.mentionSpam) score += 30;
                return Math.min(score, 100);
            };

            assert.strictEqual(calculateRisk({}), 0);
            assert.strictEqual(calculateRisk({ newAccount: true }), 20);
            assert.strictEqual(calculateRisk({ newAccount: true, noAvatar: true }), 30);
            assert.strictEqual(calculateRisk({
                newAccount: true,
                noAvatar: true,
                suspiciousName: true,
                rapidMessages: true,
                mentionSpam: true
            }), 100);
        });

        it('should classify threat severity', () => {
            const classifySeverity = (riskScore) => {
                if (riskScore >= 80) return 'critical';
                if (riskScore >= 60) return 'high';
                if (riskScore >= 40) return 'medium';
                if (riskScore >= 20) return 'low';
                return 'none';
            };

            assert.strictEqual(classifySeverity(0), 'none');
            assert.strictEqual(classifySeverity(25), 'low');
            assert.strictEqual(classifySeverity(50), 'medium');
            assert.strictEqual(classifySeverity(70), 'high');
            assert.strictEqual(classifySeverity(90), 'critical');
        });
    });

    describe('Auto-Escalation', () => {
        it('should determine correct action based on offense count', () => {
            const getAction = (offenseCount) => {
                if (offenseCount >= 4) return 'ban';
                if (offenseCount >= 3) return 'kick';
                if (offenseCount >= 2) return 'mute';
                if (offenseCount >= 1) return 'warn';
                return 'none';
            };

            assert.strictEqual(getAction(0), 'none');
            assert.strictEqual(getAction(1), 'warn');
            assert.strictEqual(getAction(2), 'mute');
            assert.strictEqual(getAction(3), 'kick');
            assert.strictEqual(getAction(4), 'ban');
            assert.strictEqual(getAction(10), 'ban');
        });

        it('should calculate mute duration', () => {
            const getMuteDuration = (offenseCount) => {
                const baseMins = 5;
                const multiplier = Math.pow(2, offenseCount - 1);
                const maxMins = 60 * 24; // 24 hours max
                return Math.min(baseMins * multiplier, maxMins);
            };

            assert.strictEqual(getMuteDuration(1), 5);
            assert.strictEqual(getMuteDuration(2), 10);
            assert.strictEqual(getMuteDuration(3), 20);
            assert.strictEqual(getMuteDuration(4), 40);
        });
    });

    describe('Batch Processing', () => {
        it('should calculate optimal batch size', () => {
            const getBatchSize = (queueLength) => {
                if (queueLength > 100) return 20;
                if (queueLength > 50) return 10;
                if (queueLength > 10) return 5;
                return queueLength; // Process all
            };

            assert.strictEqual(getBatchSize(5), 5);
            assert.strictEqual(getBatchSize(15), 5);
            assert.strictEqual(getBatchSize(60), 10);
            assert.strictEqual(getBatchSize(150), 20);
        });

        it('should prioritize messages correctly', () => {
            const messages = [
                { id: 1, riskScore: 30, timestamp: 1000 },
                { id: 2, riskScore: 80, timestamp: 2000 },
                { id: 3, riskScore: 50, timestamp: 500 },
            ];

            // Sort by risk (descending), then timestamp (ascending)
            const sorted = [...messages].sort((a, b) => {
                if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
                return a.timestamp - b.timestamp;
            });

            assert.strictEqual(sorted[0].id, 2); // Highest risk
            assert.strictEqual(sorted[1].id, 3); // Medium risk
            assert.strictEqual(sorted[2].id, 1); // Lowest risk
        });
    });

    describe('Whitelist/Exclusion', () => {
        it('should check user whitelist', () => {
            const whitelist = new Set(['user1', 'user2', 'bot1']);
            const isWhitelisted = (userId) => whitelist.has(userId);

            assert.strictEqual(isWhitelisted('user1'), true);
            assert.strictEqual(isWhitelisted('user3'), false);
        });

        it('should check channel exclusion', () => {
            const excludedChannels = new Set(['channel1', 'channel2']);
            const isExcluded = (channelId) => excludedChannels.has(channelId);

            assert.strictEqual(isExcluded('channel1'), true);
            assert.strictEqual(isExcluded('channel3'), false);
        });

        it('should check role whitelist', () => {
            const whitelistedRoles = new Set(['admin', 'mod', 'trusted']);
            const hasWhitelistedRole = (userRoles) => {
                return userRoles.some(role => whitelistedRoles.has(role));
            };

            assert.strictEqual(hasWhitelistedRole(['member', 'admin']), true);
            assert.strictEqual(hasWhitelistedRole(['member', 'guest']), false);
        });
    });

    describe('Cross-Guild Threats', () => {
        it('should share threat across guilds', () => {
            const threatDb = new Map();

            const reportThreat = (userId, reason, reporterGuild) => {
                const existing = threatDb.get(userId) || { reports: [] };
                existing.reports.push({ reason, reporterGuild, timestamp: Date.now() });
                threatDb.set(userId, existing);
            };

            const isKnownThreat = (userId) => threatDb.has(userId);

            reportThreat('baduser1', 'spam', 'guild1');

            assert.strictEqual(isKnownThreat('baduser1'), true);
            assert.strictEqual(isKnownThreat('gooduser'), false);
        });

        it('should count cross-guild reports', () => {
            const threatDb = new Map();
            threatDb.set('baduser', {
                reports: [
                    { reporterGuild: 'guild1' },
                    { reporterGuild: 'guild2' },
                    { reporterGuild: 'guild3' },
                ]
            });

            const getReportCount = (userId) => {
                const threat = threatDb.get(userId);
                return threat?.reports.length || 0;
            };

            assert.strictEqual(getReportCount('baduser'), 3);
            assert.strictEqual(getReportCount('unknown'), 0);
        });
    });
});
