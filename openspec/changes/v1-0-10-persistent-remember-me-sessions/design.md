# Design: Persistent remembered sessions

## 1. Context

The browser cookie already has a persistent `Max-Age`, but the authoritative server record is held in a module-level `Map`. Restarting the Node.js process therefore invalidates every cookie even when its TTL has not elapsed.

## 2. Invariants

1. Authentication requires a valid server-side record, never cookie presence alone.
2. The raw cookie token is never persisted or logged.
3. Restarting serve does not invalidate an unexpired remembered session.
4. Revocation and expiration override cache state.
5. Current user status/role remains authoritative.
6. Cookie lifetime and server expiration are derived from one TTL.
7. Session-store failure fails closed.

## 3. Session token format

Generate 32 random bytes:

```ts
const rawToken = randomBytes(32).toString('base64url');
const tokenHash = sha256(rawToken);
```

The browser receives `rawToken`; SQLite stores only `tokenHash`.

The database row has a separate random `id` for administration and audit references. Do not use the row ID as the cookie credential.

## 4. Storage integration

Preferred implementation: extend the existing users/auth SQLite database with `auth_sessions` and schema migration.

The migration MUST be transactional and idempotent. Existing users/token tables remain untouched.

Suggested columns:

```text
id
user_id
token_hash
created_at
last_seen_at
expires_at
ttl_ms
remember_me
revoked_at
```

Use UTC ISO timestamps or integer epoch milliseconds consistently with the database wrapper. Index `token_hash`, `user_id`, and `expires_at`.

## 5. SessionStore service

Create a class/service with prepared statements and no Express dependency.

```ts
class PersistentSessionStore {
  create(userId, rememberMe): { rawToken, expiresAt, ttlMs }
  resolve(rawToken, now): SessionUser | null
  touch(sessionId, now): SessionRecord
  revoke(rawToken, now): boolean
  revokeAllForUser(userId, now): number
  purgeExpired(now, batchSize?): number
  countActive(now): number
}
```

`resolve()` performs:

1. hash raw token;
2. query non-revoked row by hash;
3. reject expired row;
4. load current user by `user_id`;
5. reject missing/disabled user;
6. slide expiration only when renewal threshold is reached;
7. return current user identity/role.

## 6. Sliding expiration

Preserve the current 25%-elapsed threshold semantics:

```text
remaining < ttlMs * 0.75
```

Use one conditional update:

```sql
UPDATE auth_sessions
SET last_seen_at = ?, expires_at = ?
WHERE id = ?
  AND revoked_at IS NULL
  AND expires_at > ?
  AND expires_at < ?
```

This prevents a late request from resurrecting a revoked/expired row. The new expiration is based on the row's original `ttl_ms`.

The response cookie is refreshed only when renewal succeeds or when the current valid record requires the browser Max-Age to be aligned.

## 7. Middleware changes

Replace direct `sessionStore.get()` with dependency on `PersistentSessionStore`.

```text
authMiddleware
  -> parse cookie
  -> sessionStore.resolve(raw token)
  -> attach current user
  -> optionally refresh cookie
  -> otherwise continue to bearer token auth
```

A session-store operational error must be logged and treated as unauthenticated/degraded, not as a successful fallback.

## 8. Login/logout

### Login

After password verification:

1. create persistent session transactionally;
2. set cookie using returned TTL;
3. return user.

If session persistence fails, return 503/500 and do not issue a usable cookie.

### Logout

1. parse current raw token;
2. revoke/delete its row;
3. invalidate cache;
4. clear cookie;
5. return success idempotently.

## 9. User lifecycle

Add a user-session revocation call to:

- password change/reset;
- user disable/delete;
- admin “revoke sessions” action when available.

Role changes do not require revocation if `resolve()` reads the current user row. They take effect on the next request.

## 10. Cache

A small optional LRU cache can store `{sessionId, userId, expiresAt, ttlMs}` keyed by token hash. The cache is an optimization only.

Rules:

- max size and TTL are bounded;
- database remains authoritative for revocation;
- cache entries are invalidated on logout/revoke;
- periodic database checks or short cache TTL prevent stale role/user status;
- tests must pass with cache disabled.

Initial implementation may omit the cache for correctness.

## 11. Cleanup

Run `purgeExpired()`:

- at store initialization;
- after every N session creations/lookups, rate-limited;
- on an interval while serve runs;
- in bounded batches.

Do not vacuum synchronously in an HTTP request.

## 12. Metrics

Replace `sessionStore.size` with `countActive(now)` or a cached gauge refreshed safely. Add lookup/create/revoke/error counters without labels that expose identities.

## 13. Tests

### Unit

- token generation entropy/format;
- only hash stored;
- valid/expired/revoked resolution;
- sliding update;
- concurrent revoke vs touch;
- cleanup batching;
- current role resolution.

### HTTP

- login sets cookie and row;
- remember flag selects expected TTL;
- logout revokes row;
- auth status succeeds with persisted cookie;
- store failure does not authenticate.

### Restart process

Use two server processes sharing one temporary home/database:

1. start process A;
2. login with remember me;
3. capture cookie;
4. stop A;
5. start process B;
6. call `/auth/status` with cookie;
7. assert authenticated user;
8. logout, restart again, assert unauthenticated.

### Browser

A browser test logs in with Remember me, reloads after server restart, and remains on authenticated routes.

## 14. Alternatives rejected

### Serialize the Map on shutdown

Rejected because crashes/kill signals lose data, raw IDs risk unsafe persistence, and concurrent integrity is weak.

### Store login state in localStorage

Rejected because client-side state is not authentication and increases token exposure.

### Signed stateless cookie only

Rejected for this release because immediate revocation, user disable, role changes, and logout-all become more complex.

### Increase cookie Max-Age only

Rejected because it does not repair missing server authority.

## 15. Rollout

The schema migration runs on startup. Older cookies fail once after upgrade because no matching row exists. New logins persist correctly. Rollback ignores the extra table but returns to restart-invalidating behavior; no user/password data is lost.
