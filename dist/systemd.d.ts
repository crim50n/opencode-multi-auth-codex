export interface ServiceOptions {
    cliPath: string;
    host?: string;
    port?: number;
}
export declare function getServiceFilePath(): string;
export declare function installService(options: ServiceOptions): string;
export declare function disableService(): void;
export declare function serviceStatus(): void;
//# sourceMappingURL=systemd.d.ts.map