# Guild-Specific Features

This folder contains features that are specific to certain Discord guilds.

## Current Features

### Anti-Scam & Alt Detection (`anti-scam.js`)
Detects and warns about suspicious new members:
- **New accounts**: Flags accounts created recently (same day, this week, this year)
- **Alt detection**: Identifies potential alt accounts (TODO)
- **Scam patterns**: Detects known scammer patterns (TODO)

#### Requirements
- `MESSAGE_CONTENT` privileged intent (not currently available)
- Additional API keys for enhanced detection

#### Enabled Guilds
- `858444090374881301` - Primary Guild

## Adding New Guild Features

1. Create a new feature file in this folder (e.g., `my-feature.js`)
2. Add the guild configuration to `guild-features.js`
3. Export the feature in `index.js`
4. Hook the feature into the appropriate Discord event handlers

## Configuration

Edit `guild-features.js` to add or modify guild configurations:

```javascript
'YOUR_GUILD_ID': {
    name: 'Your Guild Name',
    features: {
        antiScam: true,
        altDetection: true,
        newAccountWarnings: true
    },
    notifyRoles: ['ROLE_ID_1', 'ROLE_ID_2'],
    notifyUsers: ['USER_ID_1'],
    settings: {
        newAccountThresholdDays: 30,
        flagSameDayAccounts: true,
        flagThisYearAccounts: true
    }
}
```

## Status

🔴 **PLACEHOLDER** - Full functionality requires:
1. Discord `MESSAGE_CONTENT` privileged intent
2. API keys for scam detection services
3. Integration with Discord event handlers
