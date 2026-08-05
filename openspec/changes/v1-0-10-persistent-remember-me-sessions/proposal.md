# v1.0.10: Persist remembered login sessions across `code-intel serve` restarts

## Change ID

`v1-0-10-persistent-remember-me-sessions`

## Release

`1.0.10`

## Priority

`P0 — Authentication correctness and user trust`

## Owner area

`authentication-and-session-lifecycle`

## One-liner

Make “Remember me” survive a server stop/start by replacing process-local session state with a persistent, revocable, expiration-aware session store.

---

## 1. Summary

The login endpoint accepts `rememberMe`, creates a longer-lived cookie, and records a longer TTL. However, the server-side session record is stored only in:

```ts
export const sessionStore = new Map<string, SessionEntry>();
```

When `code-intel serve` stops, the process exits and the `Map` is lost. The browser still sends the cookie after restart, but the new process cannot resolve its session ID. The user is therefore redirected to login even though “Remember me” was selected and the cookie is still within its TTL.

Version 1.0.10 will persist sessions in the existing local authentication database or a dedicated session database under `~/.code-intel`, store only a cryptographic hash of the bearer session token, and restore authentication across clean and unclean server restarts until the session expires or is revoked.

---

## 2. Current behavior

Current flow:

```text
POST /auth/login { rememberMe: true }
  -> create random UUID session ID
  -> save session in process Map
  -> send cookie with Max-Age

stop serve
  -> process Map disappears

start serve
  -> browser sends still-valid cookie
  -> session lookup misses
  -> unauthenticated
```

The current cookie is persistent, but the server-side authority is not. Cookie lifetime and session lifetime therefore disagree.

The current implementation also slides the server expiration in memory and refreshes the cookie, which cannot be maintained consistently after a process restart.

---

## 3. User-visible problem

Given:

1. a user logs in with “Remember me” checked;
2. `code-intel serve` is stopped;
3. the same server is started again before the remembered TTL expires;
4. the browser opens the Web UI with the existing cookie;

Expected:

```text
The user remains authenticated.
```

Current result:

```text
The user must log in again.
```

This violates the product meaning of “Remember me” and makes routine local server restarts disruptive.

---

## 4. Required behavior

### 4.1 Persistent server-side sessions

The server MUST persist session records outside process memory.

The persistent record MUST include at least:

```ts
interface PersistentSessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ttlMs: number;
  rememberMe: boolean;
  revokedAt?: string;
}
```

The raw cookie token MUST NOT be written to disk.

### 4.2 Strong opaque token

New sessions MUST use an opaque cryptographically random token with at least 256 bits of entropy. UUID-only session IDs SHOULD be replaced.

The browser receives the raw token in the HttpOnly cookie. The server stores:

```text
SHA-256(raw session token)
```

A database compromise therefore does not immediately expose reusable raw cookies.

### 4.3 Restart continuity

After restart, `authMiddleware` MUST resolve a still-valid cookie from persistent storage and attach the same user identity and role.

Restart continuity MUST work for:

- clean process shutdown;
- process termination without graceful cleanup;
- restart on the same user profile and session database;
- multiple sequential restarts before expiration.

### 4.4 Remembered and normal TTLs

The change MUST preserve configured session semantics:

- normal session TTL remains controlled by `CODE_INTEL_SESSION_TTL_HOURS`;
- remembered session TTL remains explicitly defined and documented;
- cookie `Max-Age` and server `expiresAt` originate from the same TTL value;
- sliding renewal updates persistent `lastSeenAt` and `expiresAt` atomically.

The proposal does not require changing the current remembered duration, but the duration MUST no longer be described as “remembered” while being shorter than documented product expectations. Documentation and UI wording must state the actual duration.

### 4.5 Session lookup and cache

An optional bounded in-memory cache MAY reduce database reads, but persistent storage remains authoritative.

Cache rules:

- cache entries cannot outlive database expiration;
- logout/revoke invalidates cache immediately;
- a cache miss queries persistent storage;
- a database miss cannot be converted into an authenticated cache entry;
- restart with an empty cache still authenticates persisted sessions.

### 4.6 Logout and revocation

`POST /auth/logout` MUST revoke/delete the persistent session before clearing the cookie.

The system MUST support revoking:

- the current session;
- all sessions for a user, for password reset/admin security actions;
- expired sessions during cleanup.

A revoked record MUST never authenticate even if its cookie remains in the browser.

### 4.7 User and role consistency

Session authentication MUST not trust a stale role snapshot indefinitely.

Preferred behavior:

- persistent session stores `userId` as authority;
- each authentication resolves the current active user record or validates a cached user version;
- deleted/disabled users immediately lose access;
- role changes take effect without waiting for session expiration.

If role snapshot fields are retained for diagnostics, they MUST NOT override current user state.

### 4.8 Startup migration

No existing in-memory sessions can be migrated after upgrade because they were never persisted. Existing cookies created by older versions may be unresolvable and may require one login after upgrade.

After the first 1.0.10 login, restart continuity MUST work.

### 4.9 Cleanup

Expired or revoked session records MUST be cleaned:

- opportunistically during lookup/create;
- on startup;
- periodically while serve is running;
- without blocking normal requests for a long full-table operation.

Cleanup must be covered by an index on expiration/revocation fields.

### 4.10 Storage availability

If persistent session storage is unavailable:

- authentication MUST fail closed;
- the server MUST not accept a cookie based only on its presence;
- the response/log MUST distinguish session-store failure from invalid credentials;
- raw tokens MUST never be logged;
- health/diagnostics SHOULD expose degraded authentication storage state without secret data.

---

## 5. Proposed storage

Use the existing local SQLite authentication database where practical, because users and access-control state already live there.

Suggested table:

```sql
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ttl_ms INTEGER NOT NULL,
  remember_me INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions(expires_at);

CREATE INDEX idx_auth_sessions_user_id
  ON auth_sessions(user_id);
```

If the existing database wrapper cannot safely host the table, a dedicated `~/.code-intel/sessions.db` is acceptable, provided the lifecycle and backup behavior are documented.

---

## 6. Proposed module boundary

Create:

```text
code-intel/core/src/auth/session-store.ts
```

Suggested interface:

```ts
export interface SessionStore {
  create(userId: string, options: SessionCreateOptions): SessionToken;
  findByToken(rawToken: string): SessionWithUser | null;
  touch(id: string, nextExpiry: Date): void;
  revokeByToken(rawToken: string): void;
  revokeAllForUser(userId: string): number;
  deleteExpired(now: Date): number;
  countActive(now: Date): number;
}
```

`middleware.ts` should depend on the interface rather than export a mutable `Map` as the source of truth.

---

## 7. Cookie contract

The session cookie remains:

```text
HttpOnly
Path=/
SameSite=Lax in local development
SameSite=Strict + Secure in production
```

The cookie value is the raw random token. `Max-Age` is calculated from the same TTL used for the persisted record.

The server SHOULD rotate the raw session token after successful login and MAY rotate on sliding renewal when implemented safely. Token rotation is not required for the minimum fix, but session fixation must remain impossible.

---

## 8. In scope

- persistent session storage;
- cryptographically strong opaque tokens;
- token hashing at rest;
- restart-safe cookie authentication;
- persistent sliding expiration;
- logout and user-wide revocation;
- expiration cleanup;
- current-user/role validation;
- metrics based on persistent active sessions;
- core, HTTP, restart, and browser tests;
- Remember-me duration documentation.

---

## 9. Non-goals

This change will not:

- synchronize sessions across unrelated machines;
- add cloud identity/session infrastructure;
- persist CSRF tokens independently of the established double-submit flow;
- make cookies valid after their TTL;
- restore pre-1.0.10 in-memory sessions;
- store passwords or raw session tokens in the session table;
- change OIDC refresh-token behavior unless it shares the same local session cookie;
- introduce browser localStorage authentication tokens.

---

## 10. Compatibility

- Login/logout endpoints remain unchanged for clients.
- Cookie name remains `code_intel_session` unless a security migration requires versioning.
- API clients continue using `credentials: 'include'`.
- One login may be required after upgrading from an older process-local session implementation.
- Existing users and API tokens are unaffected.

---

## 11. Failure semantics

### Expired session

Delete or mark expired, clear cookie where possible, and return unauthenticated.

### Revoked session

Return unauthenticated and never slide expiration.

### Missing user

Revoke session and return unauthenticated.

### Disabled user

Revoke or deny all sessions according to user-state policy.

### Database unavailable

Fail closed, log a sanitized error, and avoid deleting the browser cookie unless invalidity is confirmed.

### Concurrent requests

Sliding updates MUST be idempotent and safe under concurrent requests. They must not shorten a later expiration or resurrect a revoked session.

---

## 12. Observability

Add counters/gauges for:

- active persistent sessions;
- session lookup success/miss/error;
- remembered vs normal session creation;
- expiration cleanup count;
- revocation count;
- restart-continuity integration result in release readiness.

Metrics and logs MUST never contain raw tokens or token hashes.

---

## 13. Acceptance criteria

1. Logging in with `rememberMe: true`, stopping serve, and restarting before expiration preserves authentication.
2. The raw session token is never stored on disk.
3. Cookie TTL and persistent expiration use the same source TTL.
4. Logout remains effective across restart.
5. Expired and revoked sessions cannot authenticate.
6. Deleted/disabled users cannot remain authenticated through stale session snapshots.
7. Sliding expiration persists across restart.
8. Concurrent requests cannot resurrect revoked sessions.
9. Existing API-token authentication remains unchanged.
10. Unit, HTTP, restart-process, browser, package, and security tests pass on one release candidate commit.

---

## 14. Final decision

“Remember me” in 1.0.10 will mean a server-verifiable persistent session, not merely a long-lived browser cookie pointing to process-local memory.
