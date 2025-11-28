# Self-host Web Agent

The `/agent` command provides headless browsing and file downloads from Discord.

Requirements:
- DEPLOY_TARGET=selfhost
- HEADLESS_BROWSER_ENABLED=1
- Install Puppeteer in your self-host: `npm install puppeteer`

Optional domain controls:
- `AGENT_ALLOWLIST_DOMAINS=example.com,foo.bar`
- `AGENT_DENYLIST_DOMAINS=evil.com`

Subcommands:
- `open url:<https://...> [wait:<load|domcontentloaded|networkidle0|networkidle2>]` — navigates to the URL and replies with a screenshot.
- `screenshot [full:true] [selector:<css>]` — captures the current page or a specific element by CSS selector.
- `download url:<https://...>` — downloads a file and uploads it if it is ≤ 8MB.
- `close` — closes your session.

Notes:
- The agent is disabled on Render by design. Use self-host mode.
- Large downloads (> ~8MB) are not uploaded to Discord.
