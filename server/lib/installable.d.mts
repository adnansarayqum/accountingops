import type { RequestHandler, Response } from 'express';
export declare function noCacheForAppShell(res: Response, filePath: string): void;
export declare const shareTargetFallback: RequestHandler;
