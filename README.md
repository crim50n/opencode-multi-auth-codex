# opencode-multi-auth

Multi-account OAuth rotation for OpenAI Codex. Auto-rotates between your ChatGPT Plus/Pro accounts.

## Installation

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

## Configure OpenCode

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "file:///path/to/opencode-multi-auth"
  ]
}
```

Or if using alongside other plugins:

```json
{
  "plugin": [
    "oh-my-opencode",
    "file:///path/to/opencode-multi-auth"
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

- Bun runtime
- ChatGPT Plus/Pro subscription(s)
- OpenCode CLI

## License

MIT
