export declare function healthPayload(): Promise<{ status: 'ok' | 'degraded'; database: boolean; databaseReachable: boolean | null }>;
