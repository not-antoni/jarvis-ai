# YouTube Playback Refactor References

## YouTube API
- https://developers.google.com/youtube/v3
- https://developers.google.com/youtube/v3/docs
- https://console.cloud.google.com/apis/library/youtube.googleapis.com

## Discord Audio
- https://discordjs.guide/voice/audio-resources
- https://discordjs.guide/creating-your-bot/slash-commands

## yt-dlp Reference
- https://github.com/yt-dlp/yt-dlp
- Jarvis expects an EditThisCookie JSON export stored in `YTDLP_COOKIES_JSON` (or `YT_COOKIES_JSON`) when YouTube requires authentication.
- The bot boots a local ffmpeg binary automatically from the latest BtbN auto-builds; no manual install required.

## Guild Whitelist
- Music commands are limited to guild IDs in `MUSIC_GUILD_WHITELIST` (defaults include `1403664986089324606` and `858444090374881301`).
