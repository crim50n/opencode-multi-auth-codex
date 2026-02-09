export const DEFAULT_CONFIG = {
    rotationStrategy: 'round-robin',
    autoRefreshTokens: true,
    rateLimitCooldownMs: 5 * 60 * 1000, // 5 minutes
    modelUnsupportedCooldownMs: 30 * 60 * 1000, // 30 minutes
    workspaceDeactivatedCooldownMs: 30 * 60 * 1000, // 30 minutes
    modelFilter: /^gpt-5/
};
//# sourceMappingURL=types.js.map