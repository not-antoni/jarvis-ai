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
- Jarvis declines queries that trip explicit-language heuristics before they reach Brave.
- Returned results are screened again, and anything that violates the safety filter is withheld with a polite notice to the user.
- Jarvis displays the top three results and links back to the original sources.
- When the API key is missing or the request fails, Jarvis will let the user know that the web search is temporarily unavailable.
- Link-style buttons are limited to the first five results to stay within Discord component limits.
