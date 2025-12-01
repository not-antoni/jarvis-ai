# Lavalink Setup for Jarvis

Lavalink provides reliable, high-quality music playback for selfhost deployments.

## Quick Start

### 1. Start Lavalink Server

```bash
cd docker
docker-compose -f docker-compose.lavalink.yml up -d
```

### 2. Configure Environment

Add to your `.env`:

```env
# Lavalink connection
LAVALINK_HOST=localhost:2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_ENABLED=true
```

### 3. Start the Bot

```bash
npm start
```

## Usage

Use the `/lavalink` command:

- `/lavalink play <query>` - Search with live autocomplete and play
- `/lavalink skip` - Skip current track
- `/lavalink pause` - Pause playback
- `/lavalink resume` - Resume playback
- `/lavalink stop` - Stop and clear queue
- `/lavalink queue` - Show current queue
- `/lavalink nowplaying` - Show current track

## Live Search

When you type in the query field, Lavalink searches YouTube in real-time and shows suggestions as you type!

## Custom Password

To change the default password:

1. Edit `docker/lavalink/application.yml`:
   ```yaml
   lavalink:
     server:
       password: "your-secure-password"
   ```

2. Update your `.env`:
   ```env
   LAVALINK_PASSWORD=your-secure-password
   ```

3. Restart both Lavalink and the bot.

## Troubleshooting

### Lavalink not connecting
- Check if Lavalink is running: `docker ps`
- Check Lavalink logs: `docker logs jarvis-lavalink`
- Verify `LAVALINK_HOST` matches your setup

### No search results
- Lavalink YouTube plugin should auto-download on first start
- Check `docker/lavalink/plugins/` for the plugin JAR

### Audio quality issues
- Edit `application.yml` and set `opusEncodingQuality: 10`
- Increase `bufferDurationMs` for more stability
