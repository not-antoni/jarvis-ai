/**
 * Entertainment and Games Service
 * Handles trivia, story generation, memes, polls, and other entertainment features
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const aiManager = require('./ai-providers');

class EntertainmentGamesService {
    constructor() {
        this.activeGames = new Map();
        this.activePolls = new Map();
        this.triviaQuestions = [];
        this.storyChapters = new Map();
        this.memeTemplates = new Map();
        
        this.initializeTriviaQuestions();
        this.initializeMemeTemplates();
    }

    // Trivia Games
    initializeTriviaQuestions() {
        this.triviaQuestions = [
            {
                id: 1,
                question: "What is the capital of France?",
                options: ["London", "Berlin", "Paris", "Madrid"],
                correct: 2,
                category: "Geography",
                difficulty: "easy"
            },
            {
                id: 2,
                question: "Which programming language was created by Brendan Eich?",
                options: ["Python", "Java", "JavaScript", "C++"],
                correct: 2,
                category: "Programming",
                difficulty: "medium"
            },
            {
                id: 3,
                question: "What does AI stand for?",
                options: ["Artificial Intelligence", "Advanced Internet", "Automated Interface", "Algorithmic Integration"],
                correct: 0,
                category: "Technology",
                difficulty: "easy"
            },
            {
                id: 4,
                question: "Which company developed the React framework?",
                options: ["Google", "Microsoft", "Facebook", "Twitter"],
                correct: 2,
                category: "Technology",
                difficulty: "medium"
            },
            {
                id: 5,
                question: "What is the largest planet in our solar system?",
                options: ["Earth", "Saturn", "Jupiter", "Neptune"],
                correct: 2,
                category: "Science",
                difficulty: "easy"
            }
        ];
    }

    startTriviaGame(guildId, channelId, options = {}) {
        const gameId = uuidv4();
        const game = {
            id: gameId,
            guildId: guildId,
            channelId: channelId,
            status: 'active',
            currentQuestion: 0,
            questions: this.selectTriviaQuestions(options),
            scores: new Map(),
            startTime: Date.now(),
            options: options
        };

        this.activeGames.set(gameId, game);
        return game;
    }

    selectTriviaQuestions(options) {
        let questions = [...this.triviaQuestions];
        
        // Filter by category
        if (options.category) {
            questions = questions.filter(q => q.category.toLowerCase() === options.category.toLowerCase());
        }
        
        // Filter by difficulty
        if (options.difficulty) {
            questions = questions.filter(q => q.difficulty === options.difficulty);
        }
        
        // Shuffle and limit
        questions = this.shuffleArray(questions);
        return questions.slice(0, options.questionCount || 10);
    }

    getCurrentQuestion(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game || game.status !== 'active') return null;
        
        if (game.currentQuestion >= game.questions.length) {
            return this.endTriviaGame(gameId);
        }
        
        const question = game.questions[game.currentQuestion];
        return {
            ...question,
            gameId: gameId,
            questionNumber: game.currentQuestion + 1,
            totalQuestions: game.questions.length
        };
    }

    submitTriviaAnswer(gameId, userId, answerIndex) {
        const game = this.activeGames.get(gameId);
        if (!game || game.status !== 'active') return null;
        
        const question = game.questions[game.currentQuestion];
        const isCorrect = answerIndex === question.correct;
        
        // Update score
        const currentScore = game.scores.get(userId) || 0;
        game.scores.set(userId, currentScore + (isCorrect ? 1 : 0));
        
        // Move to next question
        game.currentQuestion++;
        
        return {
            isCorrect: isCorrect,
            correctAnswer: question.correct,
            correctAnswerText: question.options[question.correct],
            currentScore: game.scores.get(userId),
            nextQuestion: this.getCurrentQuestion(gameId)
        };
    }

    endTriviaGame(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game) return null;
        
        game.status = 'finished';
        game.endTime = Date.now();
        game.duration = game.endTime - game.startTime;
        
        // Calculate final scores
        const sortedScores = Array.from(game.scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Top 10
        
        const results = {
            gameId: gameId,
            totalQuestions: game.questions.length,
            duration: game.duration,
            participants: game.scores.size,
            leaderboard: sortedScores.map(([userId, score]) => ({
                userId: userId,
                score: score,
                percentage: Math.round((score / game.questions.length) * 100)
            }))
        };
        
        return results;
    }

    // Story Generation
    startStoryGeneration(guildId, channelId, prompt, options = {}) {
        const storyId = uuidv4();
        const story = {
            id: storyId,
            guildId: guildId,
            channelId: channelId,
            title: prompt,
            chapters: [],
            contributors: new Set(),
            currentChapter: 0,
            status: 'active',
            options: options,
            createdAt: Date.now()
        };

        this.storyChapters.set(storyId, story);
        return story;
    }

    async generateStoryChapter(storyId, userId, userPrompt) {
        const story = this.storyChapters.get(storyId);
        if (!story || story.status !== 'active') return null;
        
        try {
            // Get previous chapters for context
            const previousChapters = story.chapters.slice(-2); // Last 2 chapters
            const context = previousChapters.map(ch => ch.content).join('\n\n');
            
            const prompt = `Continue this collaborative story. Previous chapters: ${context}\n\nNew chapter prompt: ${userPrompt}\n\nWrite a compelling chapter that continues the story naturally. Keep it engaging and around 200-300 words.`;
            
            const response = await aiManager.generateResponse(
                "You are a creative storyteller. Write engaging, well-structured story chapters that maintain narrative flow and character development.",
                prompt,
                400
            );
            
            const chapter = {
                id: story.chapters.length + 1,
                content: response.content,
                author: userId,
                timestamp: Date.now(),
                wordCount: response.content.split(' ').length
            };
            
            story.chapters.push(chapter);
            story.contributors.add(userId);
            story.currentChapter++;
            
            return {
                storyId: storyId,
                chapter: chapter,
                totalChapters: story.chapters.length,
                contributors: story.contributors.size
            };
        } catch (error) {
            console.error('Story generation error:', error);
            return { error: 'Failed to generate chapter' };
        }
    }

    getStorySummary(storyId) {
        const story = this.storyChapters.get(storyId);
        if (!story) return null;
        
        return {
            id: storyId,
            title: story.title,
            totalChapters: story.chapters.length,
            contributors: Array.from(story.contributors),
            totalWords: story.chapters.reduce((sum, ch) => sum + ch.wordCount, 0),
            lastUpdated: story.chapters.length > 0 ? 
                story.chapters[story.chapters.length - 1].timestamp : story.createdAt,
            status: story.status
        };
    }

    // Meme Generation
    initializeMemeTemplates() {
        this.memeTemplates.set('distracted-boyfriend', {
            name: 'Distracted Boyfriend',
            template: 'distracted-boyfriend',
            textFields: ['boyfriend', 'girlfriend', 'distraction'],
            description: 'Boyfriend looking at another woman while girlfriend looks upset'
        });
        
        this.memeTemplates.set('drake-pointing', {
            name: 'Drake Pointing',
            template: 'drake-pointing',
            textFields: ['reject', 'accept'],
            description: 'Drake rejecting one thing and accepting another'
        });
        
        this.memeTemplates.set('two-buttons', {
            name: 'Two Buttons',
            template: 'two-buttons',
            textFields: ['button1', 'button2'],
            description: 'Person struggling to choose between two buttons'
        });
        
        this.memeTemplates.set('expanding-brain', {
            name: 'Expanding Brain',
            template: 'expanding-brain',
            textFields: ['level1', 'level2', 'level3', 'level4'],
            description: 'Four levels of increasing intelligence/creativity'
        });
    }

    async generateMeme(templateId, textFields, options = {}) {
        try {
            const template = this.memeTemplates.get(templateId);
            if (!template) {
                throw new Error('Meme template not found');
            }
            
            // Use a free meme generation API
            const memeData = {
                template_id: template.template,
                username: options.username || 'Jarvis',
                password: options.password || 'jarvis-meme',
                text0: textFields[0] || '',
                text1: textFields[1] || '',
                text2: textFields[2] || '',
                text3: textFields[3] || ''
            };
            
            const response = await axios.post(
                'https://api.imgflip.com/caption_image',
                memeData,
                { timeout: 10000 }
            );
            
            if (response.data.success) {
                return {
                    success: true,
                    imageUrl: response.data.data.url,
                    template: template.name,
                    textFields: textFields
                };
            } else {
                throw new Error(response.data.error_message || 'Meme generation failed');
            }
        } catch (error) {
            console.error('Meme generation error:', error);
            return {
                success: false,
                error: error.message,
                fallback: await this.generateFallbackMeme(templateId, textFields)
            };
        }
    }

    async generateFallbackMeme(templateId, textFields) {
        // Generate a simple text-based meme as fallback
        const { createCanvas } = require('canvas');
        
        const canvas = createCanvas(500, 500);
        const ctx = canvas.getContext('2d');
        
        // Background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 500, 500);
        
        // Title
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('MEME GENERATOR', 250, 50);
        
        // Template info
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.fillText(`Template: ${templateId}`, 250, 100);
        
        // Text fields
        ctx.font = '14px Arial';
        textFields.forEach((text, index) => {
            if (text) {
                ctx.fillText(`${index + 1}. ${text}`, 250, 150 + (index * 30));
            }
        });
        
        // Jarvis signature
        ctx.fillStyle = '#666666';
        ctx.font = '12px Arial';
        ctx.fillText('Generated by Jarvis AI', 250, 450);
        
        return {
            success: true,
            imageBuffer: canvas.toBuffer('image/png'),
            format: 'png',
            fallback: true
        };
    }

    getMemeTemplates() {
        return Array.from(this.memeTemplates.values()).map(template => ({
            id: template.template,
            name: template.name,
            description: template.description,
            textFields: template.textFields.length
        }));
    }

    // Polling System
    createPoll(guildId, channelId, question, options, settings = {}) {
        const pollId = uuidv4();
        const poll = {
            id: pollId,
            guildId: guildId,
            channelId: channelId,
            question: question,
            options: options.map((option, index) => ({
                id: index,
                text: option,
                votes: 0,
                voters: []
            })),
            voters: new Set(),
            status: 'active',
            settings: {
                allowMultipleVotes: settings.allowMultipleVotes || false,
                anonymous: settings.anonymous || false,
                duration: settings.duration || null, // in minutes
                ...settings
            },
            createdAt: Date.now(),
            results: null
        };
        
        // Set auto-close timer if duration is specified
        if (poll.settings.duration) {
            setTimeout(() => {
                this.closePoll(pollId);
            }, poll.settings.duration * 60 * 1000);
        }
        
        this.activePolls.set(pollId, poll);
        return poll;
    }

    voteOnPoll(pollId, userId, optionIds) {
        const poll = this.activePolls.get(pollId);
        if (!poll || poll.status !== 'active') return null;
        
        // Check if user already voted
        if (!poll.settings.allowMultipleVotes && poll.voters.has(userId)) {
            return { error: 'You have already voted on this poll' };
        }
        
        // Validate option IDs
        const validOptions = optionIds.filter(id => 
            poll.options.some(option => option.id === id)
        );
        
        if (validOptions.length === 0) {
            return { error: 'Invalid option selected' };
        }
        
        // Cast votes
        validOptions.forEach(optionId => {
            const option = poll.options.find(opt => opt.id === optionId);
            if (option) {
                option.votes++;
                if (!poll.settings.anonymous) {
                    option.voters.push(userId);
                }
            }
        });
        
        poll.voters.add(userId);
        
        return {
            pollId: pollId,
            totalVotes: poll.voters.size,
            results: this.getPollResults(pollId)
        };
    }

    getPollResults(pollId) {
        const poll = this.activePolls.get(pollId);
        if (!poll) return null;
        
        const totalVotes = poll.voters.size;
        
        return {
            question: poll.question,
            options: poll.options.map(option => ({
                id: option.id,
                text: option.text,
                votes: option.votes,
                percentage: totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0,
                voters: poll.settings.anonymous ? [] : option.voters
            })),
            totalVotes: totalVotes,
            status: poll.status
        };
    }

    closePoll(pollId) {
        const poll = this.activePolls.get(pollId);
        if (!poll) return null;
        
        poll.status = 'closed';
        poll.closedAt = Date.now();
        poll.results = this.getPollResults(pollId);
        
        return poll.results;
    }

    // Utility Functions
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Cleanup inactive games and polls
    cleanup() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        // Clean up old games
        for (const [gameId, game] of this.activeGames.entries()) {
            if (game.status === 'finished' && (now - game.endTime) > maxAge) {
                this.activeGames.delete(gameId);
            }
        }
        
        // Clean up old polls
        for (const [pollId, poll] of this.activePolls.entries()) {
            if (poll.status === 'closed' && (now - poll.closedAt) > maxAge) {
                this.activePolls.delete(pollId);
            }
        }
        
        // Clean up old stories
        for (const [storyId, story] of this.storyChapters.entries()) {
            if (story.status === 'active' && (now - story.createdAt) > (7 * 24 * 60 * 60 * 1000)) {
                story.status = 'archived';
            }
        }
        
        console.log('Entertainment games cleanup completed');
    }

    // Get statistics
    getStatistics() {
        return {
            activeGames: this.activeGames.size,
            activePolls: this.activePolls.size,
            activeStories: Array.from(this.storyChapters.values()).filter(s => s.status === 'active').length,
            totalTriviaQuestions: this.triviaQuestions.length,
            memeTemplates: this.memeTemplates.size
        };
    }
}

module.exports = new EntertainmentGamesService();
