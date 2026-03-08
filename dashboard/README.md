# Dashboard

React/Vite frontend for the Jarvis Control Center, served by the main app at `/dashboard`.

## Commands

```bash
npm run dev
npm run build
npm run lint
```

## Notes

- The frontend talks to `/api/dashboard/*`.
- `dist/` is committed because the main Express app serves the built assets directly.
- Keep UI state aligned with the backend API; do not add mock data fallbacks here.
