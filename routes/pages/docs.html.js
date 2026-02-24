'use strict';

const { getPublicConfig } = require('../../src/utils/public-config');
const { SHARED_STYLES, NAV_HTML, DISCORD_INVITE } = require('./shared-styles');
const API_BASE_URL = `${getPublicConfig().baseUrl}/api/v1`;

const DOCS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation | Jarvis API</title>
    <style>${SHARED_STYLES}
        .doc-section { margin-bottom: 3rem; }
        pre {
            background: rgba(0,0,0,0.3);
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
            line-height: 1.5;
        }
        .tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; }
        .tab {
            padding: 0.75rem 1.5rem;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: #888;
            cursor: pointer;
            transition: all 0.3s;
        }
        .tab:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .tab.active { background: rgba(0,212,255,0.2); border-color: #00d4ff; color: #00d4ff; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .endpoint {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .endpoint-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .method {
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            font-weight: 600;
            font-size: 0.8rem;
        }
        .method.get { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .method.post { background: rgba(0,255,136,0.2); color: #00ff88; }
        .endpoint-path { font-family: monospace; font-size: 1.1rem; }
        .endpoint-desc { color: #888; margin-bottom: 1rem; }
        .param-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .param-table th, .param-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .param-table th { color: #00d4ff; font-weight: 500; }
        .param-name { font-family: monospace; color: #dcdcaa; }
        .param-type { color: #4ec9b0; font-size: 0.85rem; }
        .param-required { color: #f14c4c; font-size: 0.75rem; }
        .code-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
        .code-tab {
            padding: 0.25rem 0.75rem;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            font-size: 0.8rem;
            color: #888;
            cursor: pointer;
        }
        .code-tab.active { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .response-example { margin-top: 1rem; }
        .copy-btn {
            float: right;
            padding: 0.25rem 0.5rem;
            background: rgba(255,255,255,0.1);
            border: none;
            border-radius: 4px;
            color: #888;
            cursor: pointer;
            font-size: 0.75rem;
        }
        .copy-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📖 Documentation</h1>
        <p style="color: #888; margin-bottom: 2rem;">User guide and API reference for Jarvis</p>
        
        <div class="tabs">
            <button class="tab active" onclick="showTab('api')">🔌 API Reference</button>
            <button class="tab" onclick="showTab('guide')">📚 User Guide</button>
        </div>

        <!-- API Documentation Tab -->
        <div id="api" class="tab-content active">
            <div style="background: rgba(255, 68, 68, 0.15); border: 2px solid #ff4444; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem;">
                <h3 style="color: #ff4444; margin-bottom: 0.5rem;">⚠️ API Temporarily Disabled</h3>
                <p style="color: #ff6666; margin: 0;">The public API has been disabled for an unspecified amount of time. Please use the Discord bot instead.</p>
            </div>
            <div class="doc-section">
                <h2>🔑 Authentication</h2>
                <div class="card">
                    <p>All API requests require authentication using an API key. Include your key in the Authorization header:</p>
                    <pre>Authorization: Bearer jv-your-api-key</pre>
                    <p style="margin-top: 1rem; color: #888;">Get your API key from the <a href="/me" style="color: #00d4ff;">User Dashboard</a>. Each account can have up to 5 API keys.</p>
                </div>
            </div>

            <div class="doc-section">
                <h2>📡 Base URL</h2>
                <div class="card">
                    <pre>${API_BASE_URL}</pre>
                </div>
            </div>

            <div class="doc-section">
                <h2>⚡ Rate Limits</h2>
                <div class="card">
                    <p>API requests are rate limited to <strong>60 requests per minute</strong> per API key.</p>
                    <p style="margin-top: 0.5rem; color: #888;">Rate limit headers are included in responses:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>X-RateLimit-Limit</code> - Max requests per window</li>
                        <li><code>X-RateLimit-Remaining</code> - Remaining requests</li>
                        <li><code>X-RateLimit-Reset</code> - Unix timestamp when limit resets</li>
                    </ul>
                </div>
            </div>

            <div class="doc-section">
                <h2>🔗 Endpoints</h2>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method post">POST</span>
                        <span class="endpoint-path">/chat/completions</span>
                    </div>
                    <p class="endpoint-desc">Create a chat completion using Jarvis AI. OpenAI-compatible format.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Request Body</h4>
                    <table class="param-table">
                        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
                        <tr>
                            <td><span class="param-name">messages</span> <span class="param-required">required</span></td>
                            <td><span class="param-type">array</span></td>
                            <td>Array of message objects with <code>role</code> and <code>content</code></td>
                        </tr>
                        <tr>
                            <td><span class="param-name">model</span></td>
                            <td><span class="param-type">string</span></td>
                            <td>Model to use (optional, defaults to auto-select)</td>
                        </tr>
                        <tr>
                            <td><span class="param-name">temperature</span></td>
                            <td><span class="param-type">number</span></td>
                            <td>Sampling temperature (0-2, default: 0.7)</td>
                        </tr>
                        <tr>
                            <td><span class="param-name">max_tokens</span></td>
                            <td><span class="param-type">integer</span></td>
                            <td>Maximum tokens in response (default: 1000)</td>
                        </tr>
                    </table>

                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Request</h4>
                    <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer jv-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7
  }'</pre>

                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1703001234,
  "model": "jarvis-default",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! I'm doing great, thank you for asking..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 42,
    "total_tokens": 67
  }
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/models</span>
                    </div>
                    <p class="endpoint-desc">List available AI models.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "object": "list",
  "data": [
    {"id": "jarvis-default", "object": "model", "owned_by": "jarvis"},
    {"id": "gpt-4", "object": "model", "owned_by": "jarvis"}
  ]
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/user</span>
                    </div>
                    <p class="endpoint-desc">Get information about the authenticated user.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "userId": "123456789",
  "keyId": "abc123",
  "keyName": "My App",
  "totalKeys": 2,
  "maxKeys": 5
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/usage</span>
                    </div>
                    <p class="endpoint-desc">Get API usage statistics for your account.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "userId": "123456789",
  "totalRequests": 1542,
  "keys": [
    {"id": "abc123", "name": "My App", "requestCount": 1200},
    {"id": "def456", "name": "Test Key", "requestCount": 342}
  ]
}</pre>
                </div>
            </div>

            <div class="doc-section">
                <h2>❌ Error Codes</h2>
                <div class="card">
                    <table class="param-table">
                        <tr><th>Code</th><th>Type</th><th>Description</th></tr>
                        <tr><td>401</td><td>authentication_error</td><td>Invalid or missing API key</td></tr>
                        <tr><td>429</td><td>rate_limit_error</td><td>Too many requests</td></tr>
                        <tr><td>400</td><td>invalid_request_error</td><td>Malformed request body</td></tr>
                        <tr><td>500</td><td>api_error</td><td>Internal server error</td></tr>
                        <tr><td>503</td><td>api_error</td><td>Service temporarily unavailable</td></tr>
                    </table>
                </div>
            </div>

            <div class="doc-section">
                <h2>💻 Code Examples</h2>
                
                <h3 style="color: #fff; margin: 1rem 0;">Python</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>import requests

response = requests.post(
    "${API_BASE_URL}/chat/completions",
    headers={
        "Authorization": "Bearer jv-your-api-key",
        "Content-Type": "application/json"
    },
    json={
        "messages": [{"role": "user", "content": "Hello!"}]
    }
)

print(response.json()["choices"][0]["message"]["content"])</pre>

                <h3 style="color: #fff; margin: 1rem 0;">JavaScript (Node.js)</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>const response = await fetch("${API_BASE_URL}/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer jv-your-api-key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello!" }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);</pre>

                <h3 style="color: #fff; margin: 1rem 0;">OpenAI SDK Compatible</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>from openai import OpenAI

client = OpenAI(
    api_key="jv-your-api-key",
    base_url="${API_BASE_URL}"
)

response = client.chat.completions.create(
    model="jarvis-default",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)</pre>
            </div>
        </div>

        <!-- User Guide Tab -->
        <div id="guide" class="tab-content">
            <div class="doc-section">
                <h2>🚀 Getting Started</h2>
                <div class="card">
                    <p>Jarvis uses two command styles:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><strong>Slash Commands</strong> - Type <code>/</code> and select from the menu</li>
                        <li><strong>Text Commands</strong> - Use the <code>*j</code> prefix</li>
                    </ul>
                    <p style="margin-top: 1rem;">Example: <code>*j help</code> or <code>/help</code></p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>💬 AI Chat</h2>
                <div class="card">
                    <p>Talk to Jarvis naturally:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><strong>@Jarvis</strong> - Mention the bot in any channel</li>
                        <li><strong>*j &lt;message&gt;</strong> - Use the text prefix</li>
                        <li><strong>DMs</strong> - Send a direct message to Jarvis</li>
                    </ul>
                    <p style="margin-top: 1rem;">Jarvis remembers context from your conversations. Use <code>*j reset</code> to clear your history.</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>💰 Economy System</h2>
                <div class="card">
                    <p>Earn and spend coins:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>/daily</code> - Claim daily rewards (streak bonuses!)</li>
                        <li><code>/work</code> - Work at Stark Industries</li>
                        <li><code>/hunt</code> <code>/fish</code> <code>/dig</code> - Minigames</li>
                        <li><code>/gamble</code> <code>/slots</code> <code>/coinflip</code> - Try your luck</li>
                        <li><code>/shop</code> - Buy items and boosters</li>
                        <li><code>/leaderboard</code> - See top earners</li>
                    </ul>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>☕ Starkbucks (SBX)</h2>
                <div class="card">
                    <p>Trade SBX - Jarvis's virtual currency:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>/sbx buy &lt;amount&gt;</code> - Buy SBX with coins</li>
                        <li><code>/sbx sell &lt;amount&gt;</code> - Sell SBX for coins</li>
                        <li><code>/sbx invest &lt;amount&gt;</code> - Lock SBX for bonus returns</li>
                        <li><code>/sbx portfolio</code> - View your holdings</li>
                    </ul>
                    <p style="margin-top: 1rem;">SBX price fluctuates - buy low, sell high!</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>🛡️ Moderation</h2>
                <div class="card">
                    <p>Server owners can enable moderation features:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li>AI-powered content filtering</li>
                        <li>Auto-moderation with custom blacklists</li>
                        <li>Member join/leave logging</li>
                        <li>Server statistics channels</li>
                    </ul>
                    <p style="margin-top: 1rem;">Access the <a href="/moderator" style="color: #00d4ff;">Moderator Dashboard</a> to configure.</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>🔗 Links</h2>
                <div class="card">
                    <p>
                        <a href="${DISCORD_INVITE}" style="color: #00d4ff;">Support Discord</a><br>
                        <a href="/tos" style="color: #00d4ff;">Terms of Service</a><br>
                        <a href="/policy" style="color: #00d4ff;">Privacy Policy</a>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <script>
        function showTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }

        function copyCode(btn) {
            const pre = btn.parentElement;
            const code = pre.textContent.replace('Copy', '').trim();
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 2000);
            });
        }
    </script>
</body>
</html>
`;

module.exports = DOCS_PAGE;
