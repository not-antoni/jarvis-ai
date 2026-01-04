# TERF Wiki Bot

Discord bot that answers questions about the TERF Minecraft datapack.

## Quick Start

```bash
source venv/bin/activate
python bot.py
```

## Setup

1. Edit `config.json` - add your Discord token and Groq API key
2. Enable **MESSAGE CONTENT INTENT** in Discord Developer Portal
3. Run `source venv/bin/activate && python bot.py`

## Commands

```
!terf What is the Arc Furnace?
!terf How does STFR work?
```

## Update Wiki Data

```bash
source venv/bin/activate
python update.py
```

## Config Options

| Option | Description |
|--------|-------------|
| `discord_token` | Your Discord bot token |
| `groq_api_key` | Groq API key for LLM |
| `use_groq_api` | `true` = Groq API, `false` = local Gemma3 |
| `use_function_model` | `false` to disable FunctionGemma (saves ~550MB RAM) |
