/**
 * Interactive Games Service
 * Adds engaging games and interactive features to JARVIS
 */

class InteractiveGamesService {
    constructor() {
        this.activeGames = new Map(); // Track active games per user
        this.gameStats = new Map(); // Track user game statistics
        this.gameCooldowns = new Map(); // Prevent spam
    }

    // Rock Paper Scissors Game
    async playRockPaperScissors(userId, choice) {
        if (this.isOnCooldown(userId, 'rps')) {
            return { error: 'Please wait 5 seconds before playing again, sir.' };
        }

        const choices = ['rock', 'paper', 'scissors'];
        const validChoice = choices.find(c => c.startsWith(choice.toLowerCase()));
        
        if (!validChoice) {
            return { error: 'Invalid choice, sir. Use rock, paper, or scissors.' };
        }

        const botChoice = choices[Math.floor(Math.random() * choices.length)];
        const result = this.getRPSResult(validChoice, botChoice);

        this.setCooldown(userId, 'rps', 5000);
        this.updateGameStats(userId, 'rps', result.win);

        return {
            userChoice: validChoice,
            botChoice: botChoice,
            result: result.result,
            win: result.win,
            emoji: {
                user: this.getRPSEmoji(validChoice),
                bot: this.getRPSEmoji(botChoice)
            }
        };
    }

    getRPSResult(userChoice, botChoice) {
        if (userChoice === botChoice) {
            return { result: 'tie', win: false };
        }
        
        const winConditions = {
            rock: 'scissors',
            paper: 'rock',
            scissors: 'paper'
        };

        return {
            result: winConditions[userChoice] === botChoice ? 'win' : 'lose',
            win: winConditions[userChoice] === botChoice
        };
    }

    getRPSEmoji(choice) {
        const emojis = {
            rock: '🪨',
            paper: '📄',
            scissors: '✂️'
        };
        return emojis[choice] || '❓';
    }

    // Number Guessing Game
    async startNumberGuess(userId, max = 100) {
        if (this.isOnCooldown(userId, 'guess')) {
            return { error: 'Please wait 10 seconds before starting a new game, sir.' };
        }

        const game = {
            type: 'numberGuess',
            number: Math.floor(Math.random() * max) + 1,
            max: max,
            attempts: 0,
            maxAttempts: Math.ceil(Math.log2(max)) + 2,
            startTime: Date.now()
        };

        this.activeGames.set(userId, game);
        this.setCooldown(userId, 'guess', 10000);

        return {
            message: `I'm thinking of a number between 1 and ${max}. You have ${game.maxAttempts} attempts to guess it, sir.`,
            max: max,
            maxAttempts: game.maxAttempts
        };
    }

    async guessNumber(userId, guess) {
        const game = this.activeGames.get(userId);
        if (!game || game.type !== 'numberGuess') {
            return { error: 'No active guessing game, sir. Start one with !guess [max].' };
        }

        const numGuess = parseInt(guess);
        if (isNaN(numGuess)) {
            return { error: 'Please enter a valid number, sir.' };
        }

        game.attempts++;

        if (numGuess === game.number) {
            const timeTaken = Math.floor((Date.now() - game.startTime) / 1000);
            this.activeGames.delete(userId);
            this.updateGameStats(userId, 'guess', true);
            
            return {
                result: 'win',
                message: `Excellent, sir! You guessed it in ${game.attempts} attempts (${timeTaken}s).`,
                attempts: game.attempts,
                timeTaken: timeTaken
            };
        }

        if (game.attempts >= game.maxAttempts) {
            this.activeGames.delete(userId);
            this.updateGameStats(userId, 'guess', false);
            
            return {
                result: 'lose',
                message: `Game over, sir. The number was ${game.number}. Better luck next time!`,
                attempts: game.attempts,
                correctNumber: game.number
            };
        }

        const hint = numGuess < game.number ? 'higher' : 'lower';
        const attemptsLeft = game.maxAttempts - game.attempts;
        
        return {
            result: 'continue',
            message: `Too ${hint}, sir. ${attemptsLeft} attempts remaining.`,
            attempts: game.attempts,
            attemptsLeft: attemptsLeft,
            hint: hint
        };
    }

    // Hangman Game
    async startHangman(userId, word = null) {
        if (this.isOnCooldown(userId, 'hangman')) {
            return { error: 'Please wait 10 seconds before starting a new game, sir.' };
        }

        const words = word ? [word.toLowerCase()] : [
            'ironman', 'jarvis', 'stark', 'avengers', 'marvel', 'arc', 'reactor',
            'technology', 'innovation', 'genius', 'billionaire', 'playboy', 'philanthropist',
            'repulsor', 'armor', 'suit', 'mark', 'malibu', 'mansion', 'laboratory'
        ];

        const secretWord = words[Math.floor(Math.random() * words.length)];
        const game = {
            type: 'hangman',
            word: secretWord,
            guessed: new Set(),
            wrongGuesses: 0,
            maxWrong: 6,
            startTime: Date.now()
        };

        this.activeGames.set(userId, game);
        this.setCooldown(userId, 'hangman', 10000);

        return {
            message: `Hangman started, sir. Word: ${this.getHangmanDisplay(game)}`,
            display: this.getHangmanDisplay(game),
            wrongGuesses: 0,
            maxWrong: 6
        };
    }

    async guessHangman(userId, letter) {
        const game = this.activeGames.get(userId);
        if (!game || game.type !== 'hangman') {
            return { error: 'No active hangman game, sir. Start one with !hangman [word].' };
        }

        const guess = letter.toLowerCase().charAt(0);
        if (!/[a-z]/.test(guess)) {
            return { error: 'Please enter a valid letter, sir.' };
        }

        if (game.guessed.has(guess)) {
            return { error: 'You already guessed that letter, sir.' };
        }

        game.guessed.add(guess);

        if (game.word.includes(guess)) {
            // Correct guess
            const display = this.getHangmanDisplay(game);
            
            if (display.indexOf('_') === -1) {
                // Word completed
                const timeTaken = Math.floor((Date.now() - game.startTime) / 1000);
                this.activeGames.delete(userId);
                this.updateGameStats(userId, 'hangman', true);
                
                return {
                    result: 'win',
                    message: `Brilliant, sir! You solved it: "${game.word.toUpperCase()}" (${timeTaken}s)`,
                    word: game.word.toUpperCase(),
                    timeTaken: timeTaken
                };
            }
            
            return {
                result: 'continue',
                message: `Correct, sir! Word: ${display}`,
                display: display,
                wrongGuesses: game.wrongGuesses
            };
        } else {
            // Wrong guess
            game.wrongGuesses++;
            
            if (game.wrongGuesses >= game.maxWrong) {
                this.activeGames.delete(userId);
                this.updateGameStats(userId, 'hangman', false);
                
                return {
                    result: 'lose',
                    message: `Game over, sir. The word was "${game.word.toUpperCase()}". Better luck next time!`,
                    word: game.word.toUpperCase(),
                    hangman: this.getHangmanArt(game.wrongGuesses)
                };
            }
            
            return {
                result: 'continue',
                message: `Wrong, sir. Word: ${this.getHangmanDisplay(game)}`,
                display: this.getHangmanDisplay(game),
                wrongGuesses: game.wrongGuesses,
                hangman: this.getHangmanArt(game.wrongGuesses)
            };
        }
    }

    getHangmanDisplay(game) {
        return game.word.split('').map(letter => 
            game.guessed.has(letter) ? letter.toUpperCase() : '_'
        ).join(' ');
    }

    getHangmanArt(wrongGuesses) {
        const stages = [
            '', // 0 wrong
            '  |\n  |\n  |\n  |\n__|__', // 1 wrong
            '  +---+\n  |\n  |\n  |\n  |\n__|__', // 2 wrong
            '  +---+\n  |   |\n  |\n  |\n  |\n__|__', // 3 wrong
            '  +---+\n  |   |\n  |   O\n  |\n  |\n__|__', // 4 wrong
            '  +---+\n  |   |\n  |   O\n  |   |\n  |\n__|__', // 5 wrong
            '  +---+\n  |   |\n  |   O\n  |  /|\\\n  |  / \\\n__|__' // 6 wrong (game over)
        ];
        
        return '```\n' + stages[wrongGuesses] + '\n```';
    }

    // Word Association Game
    async startWordAssociation(userId) {
        if (this.isOnCooldown(userId, 'wordchain')) {
            return { error: 'Please wait 5 seconds before starting a new game, sir.' };
        }

        const starterWords = [
            'iron', 'man', 'stark', 'jarvis', 'technology', 'innovation',
            'marvel', 'avengers', 'arc', 'reactor', 'suit', 'armor'
        ];

        const game = {
            type: 'wordAssociation',
            currentWord: starterWords[Math.floor(Math.random() * starterWords.length)],
            chain: [],
            startTime: Date.now()
        };

        this.activeGames.set(userId, game);
        this.setCooldown(userId, 'wordchain', 5000);

        return {
            message: `Word association started, sir. First word: **${game.currentWord.toUpperCase()}**`,
            currentWord: game.currentWord.toUpperCase(),
            chain: game.chain
        };
    }

    async continueWordAssociation(userId, word) {
        const game = this.activeGames.get(userId);
        if (!game || game.type !== 'wordAssociation') {
            return { error: 'No active word association game, sir. Start one with !wordchain.' };
        }

        const newWord = word.toLowerCase().trim();
        
        // Check if word is related to current word (simple association)
        if (this.isWordRelated(game.currentWord, newWord)) {
            game.chain.push(game.currentWord);
            game.currentWord = newWord;
            
            return {
                result: 'continue',
                message: `Good association, sir! Next word: **${game.currentWord.toUpperCase()}**`,
                currentWord: game.currentWord.toUpperCase(),
                chain: game.chain.map(w => w.toUpperCase()),
                chainLength: game.chain.length + 1
            };
        } else {
            return {
                result: 'invalid',
                message: `That doesn't seem related to "${game.currentWord}", sir. Try again.`,
                currentWord: game.currentWord.toUpperCase()
            };
        }
    }

    isWordRelated(word1, word2) {
        // Simple word association logic
        const associations = {
            'iron': ['man', 'suit', 'metal', 'steel', 'armor'],
            'man': ['iron', 'super', 'hero', 'human', 'person'],
            'stark': ['tony', 'industries', 'jarvis', 'iron', 'man'],
            'jarvis': ['stark', 'ai', 'assistant', 'computer', 'voice'],
            'technology': ['innovation', 'future', 'advanced', 'smart', 'digital'],
            'innovation': ['technology', 'creative', 'new', 'breakthrough', 'invention']
        };

        const word1Associations = associations[word1] || [];
        const word2Associations = associations[word2] || [];

        return word1Associations.includes(word2) || 
               word2Associations.includes(word1) ||
               word1 === word2; // Allow same word for simplicity
    }

    // Game Statistics
    getGameStats(userId) {
        const stats = this.gameStats.get(userId) || {
            rps: { wins: 0, losses: 0, ties: 0 },
            guess: { wins: 0, losses: 0, bestTime: null },
            hangman: { wins: 0, losses: 0, bestTime: null }
        };

        const totalGames = Object.values(stats).reduce((sum, game) => 
            sum + game.wins + game.losses, 0
        );

        const totalWins = Object.values(stats).reduce((sum, game) => sum + game.wins, 0);

        return {
            ...stats,
            totalGames: totalGames,
            totalWins: totalWins,
            winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0
        };
    }

    updateGameStats(userId, gameType, won) {
        if (!this.gameStats.has(userId)) {
            this.gameStats.set(userId, {
                rps: { wins: 0, losses: 0, ties: 0 },
                guess: { wins: 0, losses: 0, bestTime: null },
                hangman: { wins: 0, losses: 0, bestTime: null }
            });
        }

        const stats = this.gameStats.get(userId);
        if (stats[gameType]) {
            if (won) {
                stats[gameType].wins++;
            } else {
                stats[gameType].losses++;
            }
        }
    }

    // Cooldown Management
    isOnCooldown(userId, gameType) {
        const cooldownKey = `${userId}_${gameType}`;
        const cooldown = this.gameCooldowns.get(cooldownKey);
        
        if (!cooldown) return false;
        
        if (Date.now() > cooldown) {
            this.gameCooldowns.delete(cooldownKey);
            return false;
        }
        
        return true;
    }

    setCooldown(userId, gameType, duration) {
        const cooldownKey = `${userId}_${gameType}`;
        this.gameCooldowns.set(cooldownKey, Date.now() + duration);
    }

    // Cleanup inactive games
    cleanup() {
        const now = Date.now();
        const maxGameTime = 30 * 60 * 1000; // 30 minutes

        for (const [userId, game] of this.activeGames.entries()) {
            if (now - game.startTime > maxGameTime) {
                this.activeGames.delete(userId);
                console.log(`Cleaned up inactive game for user ${userId}`);
            }
        }

        // Clean up old cooldowns
        for (const [key, cooldown] of this.gameCooldowns.entries()) {
            if (now > cooldown) {
                this.gameCooldowns.delete(key);
            }
        }

        console.log('Interactive games cleanup completed');
    }
}

module.exports = new InteractiveGamesService();
