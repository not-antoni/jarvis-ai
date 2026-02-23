'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const LEADERBOARD_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Leaderboard | Jarvis</title>
    <style>${SHARED_STYLES}
        .tabs {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .tab {
            padding: 0.75rem 1.5rem;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: #888;
            cursor: pointer;
            transition: all 0.3s;
            border: none;
            font-size: 1rem;
        }
        .tab:hover { background: rgba(255,255,255,0.1); }
        .tab.active {
            background: rgba(0,212,255,0.2);
            border-color: #00d4ff;
            color: #00d4ff;
        }
        .rank-1 { color: #ffd700; }
        .rank-2 { color: #c0c0c0; }
        .rank-3 { color: #cd7f32; }
        .loading { text-align: center; color: #888; padding: 2rem; }
        .user-cell {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(255,255,255,0.1);
            object-fit: cover;
        }
        .user-name { font-weight: 500; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>🏆 Leaderboard</h1>

        <div class="tabs">
            <button class="tab active" id="tabBalance" onclick="loadLeaderboard('balance', this)">💰 Stark Bucks</button>
            <button class="tab" id="tabSbx" onclick="loadLeaderboard('sbx', this)">☕ SBX Holdings</button>
        </div>

        <div class="card">
            <table>
                <thead>
                    <tr>
                        <th style="width: 80px;">Rank</th>
                        <th>User</th>
                        <th style="text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody id="leaderboardBody">
                    <tr><td colspan="3" class="loading">Select a category above</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <script>
        let currentType = 'balance';

        function getDefaultAvatar(userId) {
            const index = (parseInt(userId) || 0) % 5;
            return 'https://cdn.discordapp.com/embed/avatars/' + index + '.png';
        }

        async function loadLeaderboard(type, btn) {
            currentType = type;

            // Update tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            if (btn) btn.classList.add('active');

            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '<tr><td colspan="3" class="loading">Loading...</td></tr>';

            try {
                const res = await fetch('/api/leaderboard/' + type + '?limit=25&resolve=true');
                const data = await res.json();

                if (!data.success || !data.leaderboard?.length) {
                    tbody.innerHTML = '<tr><td colspan="3" class="loading">No data yet</td></tr>';
                    return;
                }

                tbody.innerHTML = data.leaderboard.map((entry, i) => {
                    const rank = i + 1;
                    const rankClass = rank <= 3 ? 'rank-' + rank : '';
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                    const amount = type === 'sbx'
                        ? (entry.balance || 0).toFixed(2) + ' SBX'
                        : (entry.balance || 0).toLocaleString() + ' SB';
                    const avatar = entry.avatar || getDefaultAvatar(entry.userId);
                    const name = entry.displayName || entry.username || 'User ' + (entry.userId || '').slice(-4);
                    return \`
                        <tr>
                            <td class="rank \${rankClass}">\${medal}</td>
                            <td>
                                <div class="user-cell">
                                    <img src="\${avatar}" class="user-avatar" alt="" onerror="this.src=getDefaultAvatar('\${entry.userId}')">
                                    <span class="user-name">\${name}</span>
                                </div>
                            </td>
                            <td class="amount" style="text-align: right;">\${amount}</td>
                        </tr>
                    \`;
                }).join('');
            } catch (e) {
                console.error('Leaderboard error:', e);
                tbody.innerHTML = '<tr><td colspan="3" class="loading">Error loading data</td></tr>';
            }
        }

        // Load balance leaderboard by default
        document.addEventListener('DOMContentLoaded', () => {
            loadLeaderboard('balance', document.getElementById('tabBalance'));
        });
    </script>
</body>
</html>
`;

module.exports = LEADERBOARD_PAGE;
