'use strict';

/**
 * Economy Games - gambling, slots, coinflip, blackjack, rob
 * Factory module: receives dependencies from stark-economy.js
 */

module.exports = function createGames({
    loadUser,
    saveUser,
    modifyBalance,
    getActiveEffects,
    getArcReactorPerks,
    getCombinedPerks,
    checkCooldown,
    isBotOwner,
    ensureNumber,
    isMultiplierActive,
    ECONOMY_CONFIG,
    SLOT_SYMBOLS
}) {
    /**
     * Gamble (double or nothing)
     */
    async function gamble(userId, amount) {
        const user = await loadUser(userId);
        const arcPerks = await getArcReactorPerks(userId);

        if (amount < 1) {return { success: false, error: 'Minimum bet is 1 Stark Buck' };}
        if (amount > user.balance) {return { success: false, error: 'Insufficient funds' };}

        // Check for lucky charm
        const effects = await getActiveEffects(userId);
        let winRate = ECONOMY_CONFIG.gamblingWinRate;
        effects.forEach(e => {
            if (e.effect?.gamblingBonus) {
                winRate += e.effect.gamblingBonus;
            }
        });

        // Arc Reactor gambling bonus (+5%)
        winRate += arcPerks.gamblingBonus;

        // Cap win rate at 60% max for regular users (bot owner bypasses)
        const MAX_WIN_RATE = 0.60;
        winRate = Math.min(winRate, MAX_WIN_RATE);

        // Bot owner always wins
        const won = isBotOwner(userId) ? true : Math.random() < winRate;
        const change = won ? amount : -amount;

        user.balance += change;
        user.totalGambled = (user.totalGambled || 0) + amount;
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        if (won) {user.gamesWon = (user.gamesWon || 0) + 1;}
        if (change > 0) {user.totalEarned = (user.totalEarned || 0) + change;}
        else {user.totalLost = (user.totalLost || 0) + Math.abs(change);}

        await saveUser(userId, user);

        return {
            success: true,
            won,
            amount,
            change,
            newBalance: user.balance,
            winRate: Math.round(winRate * 100)
        };
    }

    /**
     * Slot machine
     */
    async function playSlots(userId, bet) {
        const user = await loadUser(userId);

        const normalizedBet = Number(bet);
        if (!Number.isFinite(normalizedBet) || normalizedBet <= 0) {
            return { success: false, error: 'Invalid bet amount' };
        }

        if (normalizedBet < 10) {return { success: false, error: 'Minimum bet is 10 Stark Bucks' };}
        if (normalizedBet > user.balance) {return { success: false, error: 'Insufficient funds' };}

        // Spin the slots - 50% base win rate for regular users
        // Bot owner always gets jackpot
        let results;
        let multiplier = 0;
        let resultType = 'loss';

        const slotsMultipliers =
            ECONOMY_CONFIG && ECONOMY_CONFIG.slotsMultipliers
                ? ECONOMY_CONFIG.slotsMultipliers
                : { double: 2, triple: 3, jackpot: 10 };

        if (isBotOwner(userId)) {
            results = ['💎', '💎', '💎']; // Guaranteed jackpot
            multiplier = slotsMultipliers.jackpot;
            resultType = 'jackpot';
        } else {
            // 50% chance to win something
            const winRoll = Math.random();

            if (winRoll < 0.50) {
                // Won! Determine tier
                const tierRoll = Math.random();

                if (tierRoll < 0.02) {
                    // 2% jackpot (1% overall)
                    const symbol = '💎';
                    results = [symbol, symbol, symbol];
                    multiplier = slotsMultipliers.jackpot;
                    resultType = 'jackpot';
                } else if (tierRoll < 0.18) {
                    // 16% triple (8% overall)
                    const symbol = SLOT_SYMBOLS[Math.floor(Math.random() * (SLOT_SYMBOLS.length - 1))]; // Exclude 💎
                    results = [symbol, symbol, symbol];
                    multiplier = slotsMultipliers.triple;
                    resultType = 'triple';
                } else {
                    // 82% double (41% overall)
                    const symbol = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
                    const other = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
                    // Two matching, one different
                    results = [symbol, symbol, other === symbol ? SLOT_SYMBOLS[(SLOT_SYMBOLS.indexOf(other) + 1) % SLOT_SYMBOLS.length] : other];
                    // Shuffle
                    results.sort(() => Math.random() - 0.5);
                    multiplier = slotsMultipliers.double;
                    resultType = 'double';
                }
            } else {
                // Lost - generate random non-matching results
                results = [
                    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
                    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
                    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
                ];
                // Make sure no two match
                while (results[0] === results[1] || results[1] === results[2] || results[0] === results[2]) {
                    results[2] = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
                    if (results[0] === results[1]) {results[1] = SLOT_SYMBOLS[(SLOT_SYMBOLS.indexOf(results[1]) + 1) % SLOT_SYMBOLS.length];}
                }
            }
        }

        if (!Number.isFinite(multiplier) || multiplier < 0) {
            multiplier = 0;
            resultType = 'loss';
        }

        const winnings = normalizedBet * multiplier;
        const change = winnings - normalizedBet;

        user.balance += change;
        user.totalGambled = (user.totalGambled || 0) + normalizedBet;
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        if (change > 0) {
            user.gamesWon = (user.gamesWon || 0) + 1;
            user.totalEarned = (user.totalEarned || 0) + change;
        } else {
            user.totalLost = (user.totalLost || 0) + Math.abs(change);
        }

        await saveUser(userId, user);

        return {
            success: true,
            results,
            resultType,
            multiplier,
            bet: normalizedBet,
            winnings,
            change,
            newBalance: user.balance
        };
    }

    /**
     * Coinflip
     */
    async function coinflip(userId, bet, choice) {
        const user = await loadUser(userId);

        if (bet < 1) {return { success: false, error: 'Minimum bet is 1 Stark Buck' };}
        if (bet > user.balance) {return { success: false, error: 'Insufficient funds' };}

        // Bot owner always wins (result matches their choice)
        const result = isBotOwner(userId) ? choice.toLowerCase() : (Math.random() < 0.5 ? 'heads' : 'tails');
        const won = choice.toLowerCase() === result;
        const change = won ? bet : -bet;

        user.balance += change;
        user.totalGambled = (user.totalGambled || 0) + bet;
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        if (won) {user.gamesWon = (user.gamesWon || 0) + 1;}
        if (change > 0) {user.totalEarned = (user.totalEarned || 0) + change;}
        else {user.totalLost = (user.totalLost || 0) + Math.abs(change);}

        await saveUser(userId, user);

        return {
            success: true,
            choice,
            result,
            won,
            change,
            newBalance: user.balance
        };
    }

    /**
     * Play blackjack
     */
    async function playBlackjack(userId, bet) {
        const user = await loadUser(userId);
        if (user.balance < bet) {
            return { success: false, error: 'Insufficient funds' };
        }

        // Simple blackjack - draw cards
        const cards = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suits = ['♠', '♥', '♦', '♣'];

        const drawCard = () => {
            const card = cards[Math.floor(Math.random() * cards.length)];
            const suit = suits[Math.floor(Math.random() * suits.length)];
            return { card, suit, display: `${card}${suit}` };
        };

        const getValue = (hand) => {
            let value = 0;
            let aces = 0;
            for (const c of hand) {
                if (c.card === 'A') { aces++; value += 11; }
                else if (['K', 'Q', 'J'].includes(c.card)) {value += 10;}
                else {value += parseInt(c.card);}
            }
            while (value > 21 && aces > 0) { value -= 10; aces--; }
            return value;
        };

        // Draw initial hands
        const playerHand = [drawCard(), drawCard()];
        const dealerHand = [drawCard(), drawCard()];

        // Simple AI: dealer draws until 17+
        while (getValue(dealerHand) < 17) {
            dealerHand.push(drawCard());
        }

        // Player also auto-draws if under 17 (simplified)
        while (getValue(playerHand) < 17) {
            playerHand.push(drawCard());
        }

        const playerValue = getValue(playerHand);
        const dealerValue = getValue(dealerHand);

        let result, winnings, won;

        if (playerValue > 21) {
            result = 'BUST! You lose.';
            winnings = -bet;
            won = false;
        } else if (dealerValue > 21) {
            result = 'Dealer busts! You win!';
            winnings = bet;
            won = true;
        } else if (playerValue > dealerValue) {
            result = 'You win!';
            winnings = bet;
            won = true;
        } else if (playerValue < dealerValue) {
            result = 'Dealer wins!';
            winnings = -bet;
            won = false;
        } else {
            result = 'Push! Tie game.';
            winnings = 0;
            won = false;
        }

        // Update balance
        user.balance += winnings;
        user.totalGambled = (user.totalGambled || 0) + bet;

        if (winnings > 0) {
            user.totalEarned = (user.totalEarned || 0) + winnings;
            user.gamesWon = (user.gamesWon || 0) + 1;
        } else if (winnings < 0) {
            user.totalLost = (user.totalLost || 0) + Math.abs(winnings);
        }
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;

        await saveUser(userId, user);

        return {
            success: true,
            playerHand,
            dealerHand,
            playerValue,
            dealerValue,
            result,
            winnings,
            newBalance: user.balance
        };
    }

    /**
     * Rob another user
     */
    async function rob(userId, targetId, username) {
        if (userId === targetId) {return { success: false, error: 'Cannot rob yourself' };}

        const cooldown = checkCooldown(userId, 'rob', ECONOMY_CONFIG.robCooldown);
        if (cooldown.onCooldown) {
            return { success: false, error: 'On cooldown', cooldown: cooldown.remaining };
        }

        const user = await loadUser(userId, username);
        const target = await loadUser(targetId);

        // Get combined perks (handles immunity/defense from all sources)
        const targetPerks = await getCombinedPerks(targetId);

        if (targetPerks.robberyImmunity) {
            return { success: false, error: 'Target is immune to robbery! (Shield/Armor active)' };
        }

        // Defense logic
        if (targetPerks.robberyDefense > 0 && Math.random() < targetPerks.robberyDefense) {
            const fine = Math.floor(user.balance * 0.15); // 15% fine
            user.balance -= fine;
            user.totalLost = (user.totalLost || 0) + fine;
            await saveUser(userId, user);

            return {
                success: true,
                succeeded: false,
                caught: true,
                message: `**SYSTEM DEFENSE!** Target's defense systems repelled you. You paid a fine of **${fine}** Stark Bucks.`,
                fine,
                newBalance: user.balance
            };
        }

        if (target.balance < 50) {
            return { success: false, error: 'Target is too poor to rob' };
        }

        // Bot owner always succeeds
        const baseChance = ECONOMY_CONFIG.robChance || 0.4;
        const succeeded = isBotOwner(userId) ? true : Math.random() < baseChance;

        if (succeeded) {
            const maxSteal = Math.floor(target.balance * (ECONOMY_CONFIG.robMaxPercent || 0.5));
            const stolen = Math.floor(Math.random() * maxSteal) + 1;

            user.balance += stolen;
            target.balance -= stolen;
            user.totalEarned = (user.totalEarned || 0) + stolen;
            target.totalLost = (target.totalLost || 0) + stolen;

            await saveUser(userId, user);
            await saveUser(targetId, target);

            return {
                success: true,
                succeeded: true,
                stolen,
                newBalance: user.balance,
                message: `You stole **${stolen}** Stark Bucks from ${targetPerks.hasReactor ? 'Arc Reactor user' : 'target'}!`
            };
        } 
        // Failed - pay fine
        const fine = Math.floor(user.balance * 0.1);
        user.balance -= fine;
        user.totalLost = (user.totalLost || 0) + fine;
        await saveUser(userId, user);

        return {
            success: true,
            succeeded: false,
            fine,
            message: `**BUSTED!** Police caught you. You paid a fine of **${fine}** Stark Bucks.`,
            newBalance: user.balance
        };
        
    }

    return { gamble, playSlots, coinflip, playBlackjack, rob };
};
