// Express's Router type is not structurally assignable to Vite's Connect
// middleware type (Request narrows IncomingMessage), even though it works
// correctly at runtime — Express request objects satisfy everything Connect
// needs. Typed as `any` at this one interop boundary only; every other
// import of application code stays fully typed.
declare const router: any;
export default router;
