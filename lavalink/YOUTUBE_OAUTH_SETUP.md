# YouTube OAuth Setup for Lavalink

## Why OAuth is Needed

YouTube has been cracking down on unauthenticated requests. If you're getting `400` errors when searching YouTube, you likely need to enable OAuth authentication.

## Setup Instructions

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **YouTube Data API v3**

### 2. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - Choose **External** (unless you have a Google Workspace)
   - Fill in required fields (App name, User support email, Developer contact)
   - Add scopes: `https://www.googleapis.com/auth/youtube.readonly`
   - Add test users if needed
4. Create OAuth client:
   - Application type: **Desktop app** or **Other**
   - Name it (e.g., "Lavalink YouTube")
   - Click **Create**
5. Copy the **Client ID** and **Client Secret**

### 3. Configure Lavalink

Edit `application.yml`:

```yaml
plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - MUSIC
      - WEB
      - ANDROID_TESTSUITE
    oauth:
      enabled: true
      clientId: "YOUR_CLIENT_ID_HERE"
      clientSecret: "YOUR_CLIENT_SECRET_HERE"
```

### 4. Restart Lavalink

After updating the configuration, restart your Lavalink server. The plugin will use OAuth for authenticated requests.

### 5. Complete Device Authorization

When Lavalink starts with OAuth enabled, it will print a device authorization code in the logs. You need to:

1. **Look for this message in the Lavalink logs:**
   ```
   OAUTH INTEGRATION: To give youtube-source access to your account, go to https://www.google.com/device and enter code XXXX-XXXX-XXXX
   ```

2. **Visit the URL** (usually `https://www.google.com/device`)

3. **Enter the code** shown in the logs (format: `XXXX-XXXX-XXXX`)

4. **Sign in with a Google account** (preferably a burner/secondary account, not your main account)

5. **Grant permissions** when prompted

6. **Wait for confirmation** - Lavalink will automatically detect the authorization and stop showing "authorization_pending" errors

7. **Save the Refresh Token** - After successful authorization, Lavalink will log a refresh token. Copy it and add it to your `application.yml`:
   ```yaml
   plugins:
     youtube:
       oauth:
         enabled: true
         clientId: "your-client-id"
         clientSecret: "your-client-secret"
         refreshToken: "1//03eVKeKb7SFhQCgYIARAAGAMSNwF-L9Irh6MGMPsf1j2e3bCbNSylWBF1ku9V2imTf0YNhfFgNvgZ7N3Dvv5wDkfAWP2j6-gQXRg"
   ```
   
   The refresh token allows Lavalink to automatically get new access tokens without re-authorization.

**Important:** Use a burner/secondary Google account, not your main account!

### 6. Revoke Access (If Needed)

If you accidentally authorized with your main account or want to remove access:

1. Go to [Google Account - Third-party apps & services](https://myaccount.google.com/permissions)
2. Find the app (it might be listed as your OAuth app name or "Lavalink YouTube")
3. Click on it and select **Remove Access** or **Revoke Access**
4. Confirm the removal

After revoking:
- Restart Lavalink to get a new authorization code
- Use a burner account when authorizing again

## Troubleshooting

### Plugin Not Loading

1. Check that the plugin JAR exists in `plugins/` directory
2. Check Lavalink startup logs for plugin loading messages
3. Verify the plugin version in `application.yml` matches the downloaded JAR

### Still Getting 400 Errors

1. Verify OAuth credentials are correct
2. Check that YouTube Data API v3 is enabled in Google Cloud
3. Ensure OAuth consent screen is configured
4. Check Lavalink logs for more detailed error messages

### OAuth Token Issues

- **Access tokens** expire after ~1 hour, but the plugin automatically refreshes them using the refresh token
- **Refresh tokens** can expire if:
  - The account password is changed
  - Access is revoked in Google Account settings
  - The token hasn't been used for 6 months
- **If refresh token expires:**
  - You'll see errors in Lavalink logs about token refresh failures
  - Remove the `refreshToken` line from `application.yml` (or set it to empty)
  - Restart Lavalink to get a new authorization code
  - Complete the device authorization flow again
  - Save the new refresh token to the config

### Token Expiration Notifications

The plugin will log warnings/errors when:
- Access token refresh fails
- Refresh token is invalid or expired
- Re-authorization is required

Check your Lavalink logs for messages like:
- `Failed to refresh access token`
- `Refresh token expired, re-authorization required`
- `OAUTH INTEGRATION: Token retrieved successfully` (when working)

## Alternative: Use Direct Video URLs

If OAuth setup is too complex, you can:
- Use direct YouTube video URLs instead of search
- Use the regular `/play` command which uses yt-dlp (slower but doesn't require OAuth)

