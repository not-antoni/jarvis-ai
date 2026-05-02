# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |
| < 1.0   | No        |

Only the latest release gets security updates. If you're running an old version, update.

## Reporting a Vulnerability

**Don't open a public issue.** Email **dev@jorvis.org** or use [GitHub's private vulnerability reporting](https://github.com/not-antoni/jarvis-ai/security/advisories/new).

Include:
- What you found
- Steps to reproduce
- Impact (what an attacker could do)
- Your suggested fix, if you have one

## What to expect

- Acknowledgment within 48 hours
- A fix or mitigation plan within a week for confirmed issues
- Credit in the changelog unless you prefer to stay anonymous

## Scope

Things I care about:
- Remote code execution
- Privilege escalation (users gaining admin/owner abilities)
- Data leaks (memory contents, API keys, user data)
- Prompt injection that bypasses security controls
- Authentication/authorization bypasses on the dashboard

Out of scope:
- Self-hosted misconfiguration (that's on you)
- Rate limiting - it's a Discord bot, Discord handles that
- Vulnerabilities in dependencies that don't actually affect this project's usage
- Social engineering the bot through normal conversation (it's an AI, it'll get tricked sometimes)

## Disclosure

I'll coordinate disclosure with you. If you want to publish a writeup, just give me reasonable time to ship a fix first.
