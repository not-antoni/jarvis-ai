# YouTube Playback Refactor References

## YouTube API
- https://developers.google.com/youtube/v3
- https://developers.google.com/youtube/v3/docs
- https://console.cloud.google.com/apis/library/youtube.googleapis.com

## Discord Audio
- https://discordjs.guide/voice/audio-resources
- https://discordjs.guide/creating-your-bot/slash-commands
- Deploy with Node.js `22.12.0` and set `NPM_CONFIG_OPTIONAL=false` so the voice stack installs cleanly without compiling native modules.
- `@snazzah/davey`, `libsodium-wrappers`, and `opusscript` are bundled to enable the latest Discord voice encryption modes.

## yt-dlp Reference
- https://github.com/yt-dlp/yt-dlp
- Jarvis expects an EditThisCookie JSON export stored in `YTDLP_COOKIES_JSON` (or `YT_COOKIES_JSON`) when YouTube requires authentication.
- `ffmpeg-static` is used by default; when unavailable the bot falls back to the latest prebuilt archives (ffmpeg + ffprobe).
- You can tweak extractor behaviour with `YTDLP_EXTRACTOR_ARGS`; the default prefers Android/embedded clients to avoid `nsig` warnings.
- The bundled binary auto-updates every 12 hours; override with `YTDLP_UPDATE_INTERVAL_MS` or disable the built-in GitHub check noise via `YTDL_NO_UPDATE=1`.
- Use `scripts/minify_cookies.py` to compact either the `YTDLP_COOKIES_JSON` env value or a browser export into a single-line string for deployment.

## Guild Whitelist
- Music commands are limited to guild IDs in `MUSIC_GUILD_WHITELIST` (defaults include `1403664986089324606` and `858444090374881301`).
