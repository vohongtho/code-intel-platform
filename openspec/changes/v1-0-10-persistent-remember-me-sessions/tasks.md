# Tasks: Persistent remembered sessions

## 1. Session schema and migration

- [ ] Extend the auth/users SQLite schema with `auth_sessions` and indexes for token hash, user ID, and expiration.
- [ ] Make the migration transactional, idempotent, and compatible with existing user/token databases.
- [ ] Add schema tests for clean creation, upgrade from the current schema, and repeated startup.

## 2. Persistent session store

- [ ] Create `code-intel/core/src/auth/session-store.ts` with create, resolve, touch, revoke, revoke-all, cleanup, and active-count operations.
- [ ] Generate at least 256-bit opaque raw tokens and persist only SHA-256 hashes.
- [ ] Ensure session-store logs and errors never include raw tokens or hashes.
- [ ] Add unit tests for valid, expired, revoked, missing-user, disabled-user, and malformed-token cases.

## 3. Sliding expiration and concurrency

- [ ] Persist `ttlMs`, `lastSeenAt`, and `expiresAt` from one source TTL.
- [ ] Implement conditional sliding-expiration updates that cannot resurrect revoked or expired rows.
- [ ] Refresh the cookie only from a successfully resolved/renewed record.
- [ ] Add concurrency tests for simultaneous lookup, touch, logout, and revoke-all operations.

## 4. Authentication middleware

- [ ] Replace the module-level session `Map` as authentication authority in `code-intel/core/src/auth/middleware.ts`.
- [ ] Resolve current user status and role from persistent user data.
- [ ] Fail closed when persistent session storage is unavailable.
- [ ] Preserve bearer-token and development auto-login behavior.
- [ ] Replace active-session metrics based on `Map.size` with persistent active-session metrics.

## 5. Login, logout, and user lifecycle

- [ ] Update `/auth/login` to create a persistent session before issuing a cookie.
- [ ] Keep remembered and normal TTLs explicit and aligned with cookie `Max-Age`.
- [ ] Update `/auth/logout` to revoke the persistent session idempotently before clearing the cookie.
- [ ] Revoke all user sessions on password reset/change and user disable/delete flows.
- [ ] Add an internal/admin session-revocation service usable by future UI.

## 6. Cleanup and startup

- [ ] Purge expired/revoked sessions in bounded batches on startup and periodically while serving.
- [ ] Ensure cleanup does not block request handling or vacuum synchronously.
- [ ] Add cleanup count/error observability without identity/token labels.

## 7. Restart regression coverage

- [ ] Add a process-level integration test using two `code-intel serve` processes sharing one temporary home/auth database.
- [ ] Assert a remembered cookie authenticates after stopping process A and starting process B before expiration.
- [ ] Assert logout remains effective after another restart.
- [ ] Assert an expired remembered cookie is rejected after restart.
- [ ] Add browser coverage that remains on an authenticated route across a controlled server restart.

## 8. Documentation and release validation

- [ ] Document the exact normal and Remember-me durations and restart behavior.
- [ ] Document one-time re-login behavior for cookies created before persistent-session support.
- [ ] Update changelog and 1.0.10 release notes.
- [ ] Add release-readiness smoke coverage for login, restart, `/auth/status`, logout, restart, and rejection.
- [ ] Run auth tests, HTTP tests, process tests, browser tests, typecheck, build, package validation, and security gate on one final commit.
