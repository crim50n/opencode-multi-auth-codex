# opencode-multi-auth-codex

Multi-account OAuth rotation for OpenAI Codex. Auto-rotates between your ChatGPT Plus/Pro accounts.

> **Based on [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) by [@nummanali](https://x.com/nummanali)**. Forked and modified to add multi-account rotation support.

## Patched Build (Codex Backend Compatible)

This fork patches the plugin to talk to **ChatGPT Codex backend** (`chatgpt.com/backend-api`) with the same headers and request shape as the official Codex OAuth plugin.

**Install from GitHub (recommended for this fork):**

```bash
bun add github:guard22/opencode-multi-auth-codex --cwd ~/.config/opencode
```

Then set the plugin entry in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["github:guard22/opencode-multi-auth-codex"]
}
```

If you already installed an older build, re-run the GitHub install command above to override it.

## Installation

### Via GitHub (Recommended)

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["github:guard22/opencode-multi-auth-codex"]
}
```

OpenCode will auto-install on first run.

### Manual Install

If auto-install fails, install manually:

```bash
bun add github:guard22/opencode-multi-auth-codex --cwd ~/.config/opencode
```

### From Source

```bash
git clone https://github.com/guard22/opencode-multi-auth-codex.git
cd opencode-multi-auth-codex
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

## Configure OpenCode

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["github:guard22/opencode-multi-auth-codex"]
}
```

Or with other plugins:

```json
{
  "plugin": [
    "oh-my-opencode",
    "github:guard22/opencode-multi-auth-codex"
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
