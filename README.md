# opencode-multi-auth

Multi-account OAuth rotation for OpenAI Codex. Auto-rotates between your 3 ChatGPT Plus/Pro accounts.

## Setup

```bash
cd ~/Desktop/opencode-multi-auth
npm install
npm run build
npm link
```

## Add Your Accounts

```bash
opencode-multi-auth add personal
opencode-multi-auth add work  
opencode-multi-auth add backup
```

Each command opens your browser for OAuth. Log in with a different ChatGPT account each time.

## Check Status

```bash
opencode-multi-auth status
```

## Configure OpenCode

Copy `config/opencode.json` to `~/.config/opencode/opencode.json`

Or add to your existing config:

```json
{
  "plugin": ["file:///Users/a3fckx/Desktop/opencode-multi-auth"]
}
```

## How It Works

- Round-robin rotation between accounts on each API call
- Auto-refreshes tokens before they expire
- Skips rate-limited accounts for 5 minutes
- Auto-discovers GPT-5.x models from OpenAI API

## Commands

| Command | Description |
|---------|-------------|
| `add <alias>` | Add new account via OAuth |
| `remove <alias>` | Remove an account |
| `list` | List all accounts |
| `status` | Detailed status with usage counts |
| `path` | Show config file location |
