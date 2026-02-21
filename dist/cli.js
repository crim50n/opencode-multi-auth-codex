#!/usr/bin/env node
import { createDeviceAuthorizationFlow, loginAccount, loginAccountHeadless } from './auth.js';
import { findIndexByEmail, getStorePath, listAccounts, loadStore, removeAccount, setActiveIndex } from './store.js';
function usage() {
    console.log(`
opencode-multi-auth-codex - antigravity-style multi-account for Codex

Commands:
  add                Add account with browser OAuth
  add --headless     Add account with device-code OAuth
  list               List all accounts
  status             Show active account
  use <index>        Set active account index
  remove <idx|email> Remove account
  path               Show store file path
`);
}
async function run() {
    const [, , command, ...args] = process.argv;
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        usage();
        return;
    }
    if (command === 'add' || command === 'login') {
        const headless = args.includes('--headless');
        if (headless) {
            const flow = await createDeviceAuthorizationFlow();
            console.log(`Open: ${flow.url}`);
            console.log(flow.instructions);
            const account = await loginAccountHeadless(flow);
            console.log(`Added: ${account.email || account.alias}`);
            return;
        }
        const account = await loginAccount();
        console.log(`Added: ${account.email || account.alias}`);
        return;
    }
    if (command === 'list') {
        const store = loadStore();
        const accounts = listAccounts();
        if (accounts.length === 0) {
            console.log('No accounts configured.');
            return;
        }
        accounts.forEach((account, index) => {
            const active = index === store.activeIndex ? ' (active)' : '';
            const status = account.enabled === false ? 'disabled' : account.authInvalid ? 'invalid' : 'ok';
            console.log(`#${index} ${account.email || account.alias} (${status}) ${active}`);
        });
        return;
    }
    if (command === 'status') {
        const store = loadStore();
        const accounts = listAccounts();
        if (accounts.length === 0) {
            console.log('No accounts configured.');
            return;
        }
        const active = accounts[Math.max(0, store.activeIndex)];
        console.log(`Accounts: ${accounts.length}`);
        console.log(`Active: ${active.email || active.alias}`);
        return;
    }
    if (command === 'use') {
        const index = Number.parseInt(args[0] || '', 10);
        if (!Number.isFinite(index)) {
            console.error('Usage: use <index>');
            process.exit(1);
        }
        setActiveIndex(index);
        console.log(`Active account set to #${index}`);
        return;
    }
    if (command === 'remove') {
        const target = (args[0] || '').trim();
        if (!target) {
            console.error('Usage: remove <idx|email>');
            process.exit(1);
        }
        const asIndex = Number.parseInt(target, 10);
        if (Number.isFinite(asIndex) && String(asIndex) === target) {
            removeAccount(asIndex);
            console.log(`Removed #${asIndex}`);
            return;
        }
        const index = findIndexByEmail(target);
        if (index < 0) {
            console.error(`Account not found: ${target}`);
            process.exit(1);
        }
        removeAccount(index);
        console.log(`Removed ${target}`);
        return;
    }
    if (command === 'path') {
        console.log(getStorePath());
        return;
    }
    usage();
}
run().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map