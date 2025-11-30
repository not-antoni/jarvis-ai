# Brave Search Integration

Jarvis can perform web searches powered by Brave Search. Use the wake phrase `jarvis search` followed by your query, for example:

```
jarvis search best pizza dough recipe
```

Jarvis will respond with an embedded summary of the top Brave Search results, featuring:

- A highlighted top result with snippet, source domain, and optional thumbnail
- Quick-link buttons to open the top results in your browser
- Additional snippets for the next two results so users can scan quickly

## Environment Variables

Set the Brave Search API key before starting Jarvis:

```bash
export BRAVE_API_KEY="your_brave_subscription_token"
```

The token is available from the Brave Search developer dashboard. The bot uses the free "AI" tier endpoint (`https://api.search.brave.com/res/v1/web/search`).

## Notes

- Safe search is set to `strict` by default.
- Queries are rejected when they match Jarvis' explicit-language heuristics, including leetspeak, spacing tricks, suspicious domains, and NSFW subreddit or social URLs. Educational phrases such as "sex education" and "sexual harassment training" are whitelisted so legitimate safety queries still work.
- Additional flexible regular expressions and an expanded explicit-term wordlist catch obfuscated wake-phrase attempts (e.g. `p.o.r.n`, `pr0nhub`, `s e x cam`) before an API request is ever issued.
- Discord's message handler runs the explicit-query guard the instant the wake phrase is spotted, so unsafe requests are rejected before any Brave call is scheduled.
- Confusable Unicode letters, zero-width characters, and punycode hostnames are normalised before filtering, so obfuscated requests like `pоrn`, `p‎orn`, `xn--porn-abc.com`, or `ѕех` are blocked as reliably as their plain-text equivalents.
- Returned results are screened again with the same heuristics, plus domain and URL path blocklists. Any explicit hits are discarded and users receive a polite notice instead of unsafe links.
- Jarvis displays the top three results and links back to the original sources.
- When the API key is missing or the request fails, Jarvis will let the user know that the web search is temporarily unavailable.
- Link-style buttons are limited to the first five results to stay within Discord component limits.

## News Briefings

With `BRAVE_API_KEY` configured you can also use the `/news` slash command to retrieve the latest headlines for topics such as technology, AI, gaming, crypto, science, or world news. Jarvis caches the digest for three hours to minimise API calls; pass `fresh:true` if you want to bypass the cache.
