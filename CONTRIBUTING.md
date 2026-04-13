# Contributing

Thanks for wanting to help out with Jarvis. Here's what you need to know.

## Setup

1. **Node.js 22.12.0+** is required (Discord DAVE protocol needs it)
2. Fork the repo, clone it, run `npm install`
3. Copy `.env.example` to `.env` and fill in at least the required fields
4. `npm start` to run, or use PM2 if you want process management

## Before you code

- Check existing issues first — someone might already be on it
- For anything bigger than a typo fix, open an issue or ping me so we don't duplicate work
- This is a self-hosted Discord bot, not a SaaS product. Keep that in mind when suggesting features

## Code style

- We use ESLint and Prettier. Run `npm run lint` and `npm run format:check` before pushing
- `npm run lint:fix` and `npm run format` will auto-fix most things
- No TypeScript — this is a JS project and it's staying that way
- Keep it simple. If your PR adds a util file for something used once, it's getting sent back

## Pull requests

- One feature/fix per PR. Don't bundle unrelated changes
- Write a clear description of what and why. "Fixed stuff" tells me nothing
- Make sure the bot actually starts and your feature works. `npm start` is your friend
- If you're touching AI prompts or the system prompt, test with actual conversations — vibes matter more than unit tests there

## What gets merged

- Bug fixes — always welcome
- Features that make sense for a self-hosted Discord bot
- Performance improvements with actual benchmarks
- Security fixes — please report these privately first (see SECURITY.md)

## What probably won't get merged

- "Improvements" that add complexity for no real benefit
- Features that only make sense for your specific server setup
- Massive refactors without prior discussion
- Anything that breaks existing users' setups without a migration path

## Legal stuff

By submitting a PR, you agree that:

- **You own the code** — it's yours to give and not stolen
- **I can use it** — you grant a permanent, free license to use, modify, and re-license this project (including your work) if needed
- **It stays merged** — contributions are permanent so the project doesn't break later

Questions? Open an issue or reach out directly.
