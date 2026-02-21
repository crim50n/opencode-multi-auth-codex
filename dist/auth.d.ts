import type { AccountCredentials } from './types.js';
export interface AuthorizationFlow {
    pkce: {
        verifier: string;
        challenge: string;
    };
    state: string;
    url: string;
    redirectUri: string;
    redirectPort: number;
}
export declare function createAuthorizationFlow(): Promise<AuthorizationFlow>;
/**
 * Login a new account via OAuth. No alias required — accounts are identified by email.
 * Deduplicates by email automatically (if same email logs in again, updates existing).
 */
export declare function loginAccount(flow?: AuthorizationFlow): Promise<AccountCredentials>;
export declare function refreshToken(index: number): Promise<AccountCredentials | null>;
export declare function ensureValidToken(index: number): Promise<string | null>;
//# sourceMappingURL=auth.d.ts.map