# Jarvis Discord Bot

## Overview

Jarvis is an AI-powered Discord bot inspired by Marvel's J.A.R.V.I.S., designed to provide sophisticated, articulate assistance with a subtle wit and dry humor. The bot features an advanced memory system that allows it to remember past conversations, learn from interactions, and evolve its responses over time. It responds to natural language interactions without traditional commands and can engage through mentions, direct messages, or when addressed by name.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Bot Architecture
The application follows a single-file Node.js architecture with a class-based AI system for managing personality and memory. The main entry point (`index.js`) contains both the Discord client initialization and the core AI logic within the `JarvisAI` class.

**Key Design Decisions:**
- **Monolithic Structure**: All functionality is contained within a single file for simplicity and ease of deployment
- **Class-based AI Management**: The `JarvisAI` class encapsulates personality traits, memory management, and conversation logic
- **File-based Persistence**: Uses local JSON files in a `./data` directory for storing conversation memory and user interactions

### Discord Integration
The bot uses Discord.js v14 with comprehensive gateway intents to enable full interaction capabilities including:
- Guild and direct message monitoring
- Message content access for natural language processing
- Member information for personalized interactions
- Reaction handling for interactive features

### AI/LLM Integration
The system integrates with OpenRouter's API (OpenAI-compatible) for natural language processing and response generation. The integration supports:
- Sophisticated conversation flow with context awareness
- Personality-driven responses based on predefined traits
- Memory-enhanced interactions that reference past conversations

### Memory System
Implements a persistent memory system using local file storage:
- **Conversation History**: Stores past interactions for context-aware responses
- **User Preferences**: Learns and remembers individual user preferences
- **Autonomous Thoughts**: Maintains a system for the bot to generate unprompted insights
- **Activity Tracking**: Monitors interaction patterns for adaptive behavior

### Scheduled Operations
Uses node-cron for autonomous behavior scheduling, allowing the bot to:
- Generate periodic autonomous thoughts
- Perform maintenance operations on memory data
- Implement time-based personality evolution

## Recent Changes

### Latest Updates (Current Session)
- **Multi-Provider AI System**: Added 5 AI providers with intelligent failover (Google Gemini, Groq, HuggingFace, Mixtral, OpenRouter)
- **Enhanced Personality**: Refined authentic Marvel J.A.R.V.I.S. speech patterns with mandatory British wit and sarcasm
- **Long Message Protection**: Smart handling of spam/long messages with witty Jarvis responses
- **User Mood Tracking**: Analyzes user emotions and adapts responses accordingly
- **Utility Commands**: Added status, time, providers, health commands that work even when AI is down
- **Improved Error Handling**: Graceful degradation and authentic fallback responses

## External Dependencies

### Core AI Services (5 Providers)
- **Google AI Studio**: Gemini 1.5 Flash (Primary - free, fast, reliable)
- **Groq**: Llama3 8B (Secondary - ultra-fast inference, free)  
- **HuggingFace Router**: GPT-OSS 20B (Tertiary - large model via Fireworks)
- **Mixtral API**: Open Mixtral 8x7B (Quaternary - open source)
- **OpenRouter**: Gemma 2 9B (Backup - fallback option)

### Runtime Dependencies
- **discord.js**: Discord API wrapper for bot interactions and event handling
- **openai**: Official OpenAI client library (used with multiple providers)
- **@google/generative-ai**: Google AI Studio integration
- **mongodb**: Database for persistent memory and user profiles
- **node-cron**: Task scheduling for autonomous bot behaviors

### Environment Configuration
- **GOOGLE_AI_API_KEY**: Google AI Studio API key (primary provider)
- **GROQ_API_KEY**: Groq API key for fast inference
- **HF_TOKEN**: HuggingFace access token
- **MIXTRAL_API_KEY**: Mixtral API key
- **OPENROUTER_API_KEY**: OpenRouter API key
- **DISCORD_TOKEN**: Discord bot authentication
- **MONGO_PW**: MongoDB connection password

The architecture now features bulletproof reliability with 5 AI providers, authentic Marvel character personality, and sophisticated user interaction tracking.