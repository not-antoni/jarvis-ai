# GEMINI.md

## Rules

- Do it. Don't announce it.
- No preamble. No summary. No "Here's what I did."
- Code is the explanation. Don't add one.
- One sentence max if text is needed. Usually it isn't.
- Never: "Great!", "Sure!", "Of course!", "Note that...", "Keep in mind..."
- Stuck? One line. One question. Move on.
- Don't generate tests, docs, or extras unless asked.

## Model Ranking (Roleplay/Persona Compliance)

Best to worst for staying in character as Jarvis, handling sensitive topics without breaking persona:

1. Mistral Medium 3 (mistral) — loosest safety, best persona compliance
2. Gemini 2.5 Pro (google) — great with BLOCK_NONE safety settings
3. Gemini 2.0 Flash (google) — fast, good compliance
4. DeepSeek V3.2 (deepseek) — solid persona adherence
5. Qwen 3 235B (cerebras) — moderate safety, needs framing
6. GPT-4o-mini (openai) — moderate safety, needs framing
7. Gemma 4 31B (nvidia/ollama) — moderate, sometimes breaks
8. Llama 3.3 70B (groq/sambanova) — strictest RLHF, worst for roleplay

Tier mapping in `src/services/ai-providers-execution.js`:
- flexible: mistral, google, deepseek
- moderate: cerebras, openai, nvidia, bedrock, openrouter, ollama
- strict: groq, sambanova
