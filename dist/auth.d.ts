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
export interface DeviceAuthorizationFlow {
    deviceAuthId: string;
    userCode: string;
    intervalMs: number;
    url: string;
    instructions: string;
}
export declare function createAuthorizationFlow(): Promise<AuthorizationFlow>;
export declare function createDeviceAuthorizationFlow(): Promise<DeviceAuthorizationFlow>;
export declare function loginAccount(flow?: AuthorizationFlow): Promise<AccountCredentials>;
export declare function loginAccountHeadless(flow: DeviceAuthorizationFlow): Promise<AccountCredentials>;
export declare function refreshToken(index: number): Promise<AccountCredentials | null>;
export declare function ensureValidToken(index: number): Promise<string | null>;
//# sourceMappingURL=auth.d.ts.map