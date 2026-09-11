// See companiesHouse.d.mts for why this interop boundary is typed `any`.
declare const router: any;
export default router;
export declare function currentUser(req: any): Promise<any>;
export declare function requireAuth(req: any, res: any, next: any): Promise<void>;
export declare function resetLoginLimits(): void;
