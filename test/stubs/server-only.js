// Stub for the `server-only` import guard.
//
// That package exists to fail a build when server code is pulled into a client bundle. These suites run the
// server modules directly in Node, which is exactly the context the guard is meant to allow, so it is
// aliased to this empty module rather than resolved.
export {};
