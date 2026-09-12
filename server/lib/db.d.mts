// See companiesHouse.d.mts for why this interop boundary is typed `any`.
export declare function isDatabaseConfigured(): boolean;
export declare function getPool(): any;
export declare function query(text: string, params?: any[]): Promise<any>;
export declare function ensureSchema(): Promise<void>;
