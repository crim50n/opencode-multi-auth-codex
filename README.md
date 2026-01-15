# opencode-multi-auth

Multi-account OAuth rotation for OpenAI Codex. Auto-rotates between your ChatGPT Plus/Pro accounts.

[![npm version](https://img.shields.io/npm/v/@a3fckx/opencode-multi-auth.svg)](https://www.npmjs.com/package/@a3fckx/opencode-multi-auth)

> **Based on [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) by [@nummanali](https://x.com/nummanali)**. Forked and modified to add multi-account rotation support.

## Patched Build (Codex Backend Compatible)

This fork patches the plugin to talk to **ChatGPT Codex backend** (`chatgpt.com/backend-api`) with the same headers and request shape as the official Codex OAuth plugin.

**Install from GitHub (recommended for this fork):**

```bash
bun add github:guard22/opencode-multi-auth-codex --cwd ~/.config/opencode
```

Then keep the plugin entry as-is in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@a3fckx/opencode-multi-auth"]
}
```

If you already installed the npm version, re-run the GitHub install command above to override it.

## Installation

### Via npm (Recommended)

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@a3fckx/opencode-multi-auth"]
}
```

OpenCode will auto-install on first run.

### Manual Install

If auto-install fails, install manually:

```bash
bun add @a3fckx/opencode-multi-auth --cwd ~/.config/opencode
```

### From Source

```bash
git clone https://github.com/a3fckx/opencode-multi-auth.git
cd opencode-multi-auth
bun install
bun run build
bun link
```

## Add Your Accounts

```bash
# Add each account (opens browser for OAuth)
opencode-multi-auth add personal
opencode-multi-auth add work  
opencode-multi-auth add backup

# Each command opens your browser - log in with a different ChatGPT account each time
```

## Verify Setup

```bash
opencode-multi-auth status
```

Output:
```
[multi-auth] Account Status

Strategy: round-robin
Accounts: 3
Active: personal

  personal (active)
    Email: you@personal.com
    Uses: 12
    Token expires: 12/25/2025, 3:00:00 PM

  work
    Email: you@work.com
    Uses: 10
    Token expires: 12/25/2025, 3:00:00 PM

  backup
    Email: you@backup.com
    Uses: 8
    Token expires: 12/25/2025, 3:00:00 PM
```

## Web Dashboard (Local Only)

Launch the local dashboard:

```bash
opencode-multi-auth web --port 3434 --host 127.0.0.1
```

Or from the repo:

```bash
npm run web
```

Open `http://127.0.0.1:3434` to manage Codex CLI tokens from `~/.codex/auth.json`:
- Sync current auth.json token into your local list
- See which token is active on the device
- Switch auth.json to a stored token
- Refresh 5-hour and weekly limits manually (probe-run per alias)

The dashboard watches `~/.codex/auth.json` and will add new tokens as you log in via Codex CLI.

Limit refresh runs `codex exec` in a per-alias sandbox (`~/.codex-multi/<alias>`) so you can
update limits for any stored token without switching the active device token.

## Configure OpenCode

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@a3fckx/opencode-multi-auth"]
}
```

Or with other plugins:

```json
{
  "plugin": [
    "oh-my-opencode",
    "@a3fckx/opencode-multi-auth"
  ]
}
```

## How It Works

| Feature | Behavior |
|---------|----------|
| **Rotation** | Round-robin across all accounts per API call |
| **Rate Limits** | Auto-skips rate-limited account for 5 min, uses next |
| **Token Refresh** | Auto-refreshes tokens before expiry |
| **Models** | Auto-discovers GPT-5.x models from OpenAI API |
| **Storage** | `~/.config/opencode-multi-auth/accounts.json` |

## CLI Commands

| Command | Description |
|---------|-------------|
| `add <alias>` | Add new account via OAuth (opens browser) |
| `remove <alias>` | Remove an account |
| `list` | List all configured accounts |
| `status` | Detailed status with usage counts |
| `path` | Show config file location |
| `help` | Show help message |

## Requirements

- ChatGPT Plus/Pro subscription(s)
- OpenCode CLI

## Credits

- Original OAuth implementation: [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth)
- Multi-account rotation: [@a3fckx](https://github.com/a3fckx)

## License

MIT
