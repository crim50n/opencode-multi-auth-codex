export interface CodexAuthTokens {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id?: string;
}
export interface CodexAuthFile {
    OPENAI_API_KEY: string | null;
    tokens: CodexAuthTokens;
    last_refresh?: string;
}
export declare function getCodexAuthPath(): string;
export declare function loadCodexAuthFile(): CodexAuthFile | null;
export declare function writeCodexAuthFile(auth: CodexAuthFile): void;
export declare function syncCodexAuthFile(): {
    alias: string | null;
    added: boolean;
    updated: boolean;
};
export declare function writeCodexAuthForAlias(alias: string): void;
//# sourceMappingURL=codex-auth.d.ts.map