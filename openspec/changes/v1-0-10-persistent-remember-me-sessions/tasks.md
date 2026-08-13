# Tasks: Persistent remembered sessions

## 1. Session schema and migration

- [x] Extend the auth/users SQLite schema with `auth_sessions` and indexes for token hash, user ID, and expiration.
- [x] Make the migration transactional, idempotent, and compatible with existing user/token databases.
- [x] Add schema tests for clean creation, upgrade from the current schema, and repeated startup.

## 2. Persistent session store

- [x] Create `code-intel/core/src/auth/session-store.ts` with create, resolve, touch, revoke, revoke-all, cleanup, and active-count operations.
- [x] Generate at least 256-bit opaque raw tokens and persist only SHA-256 hashes.
- [x] Ensure session-store logs and errors never include raw tokens or hashes.
- [x] Add unit tests for valid, expired, revoked, missing-user, disabled-user, and malformed-token cases.

## 3. Sliding expiration and concurrency

- [x] Persist `ttlMs`, `lastSeenAt`, and `expiresAt` from one source TTL.
- [x] Implement conditional sliding-expiration updates that cannot resurrect revoked or expired rows.
- [x] Refresh the cookie only from a successfully resolved/renewed record.
- [x] Add concurrency tests for simultaneous lookup, touch, logout, and revoke-all operations.

## 4. Authentication middleware

- [x] Replace the module-level session `Map` as authentication authority in `code-intel/core/src/auth/middleware.ts`.
- [x] Resolve current user status and role from persistent user data.
- [x] Fail closed when persistent session storage is unavailable.
- [x] Preserve bearer-token and development auto-login behavior.
- [x] Replace active-session metrics based on `Map.size` with persistent active-session metrics.

## 5. Login, logout, and user lifecycle

- [x] Update `/auth/login` to create a persistent session before issuing a cookie.
- [x] Keep remembered and normal TTLs explicit and aligned with cookie `Max-Age`.
- [x] Update `/auth/logout` to revoke the persistent session idempotently before clearing the cookie.
- [x] Revoke all user sessions on password reset/change and user disable/delete flows.
- [x] Add an internal/admin session-revocation service usable by future UI.

## 6. Cleanup and startup

- [x] Purge expired/revoked sessions in bounded batches on startup and periodically while serving.
- [x] Ensure cleanup does not block request handling or vacuum synchronously.
- [ ] Add cleanup count/error observability without identity/token labels.

## 7. Restart regression coverage

- [ ] Add a process-level integration test using two `code-intel serve` processes sharing one temporary home/auth database.
- [x] Assert a remembered cookie authenticates after stopping process A and starting process B before expiration.
- [x] Assert logout remains effective after another restart.
- [x] Assert an expired remembered cookie is rejected after restart.
- [ ] Add browser coverage that remains on an authenticated route across a controlled server restart.

## 8. Documentation and release validation

- [x] Document the exact normal and Remember-me durations and restart behavior.
- [x] Document one-time re-login behavior for cookies created before persistent-session support.
- [x] Update changelog and 1.0.10 release notes.
- [ ] Add release-readiness smoke coverage for login, restart, `/auth/status`, logout, restart, and rejection.
- [ ] Run auth tests, HTTP tests, process tests, browser tests, typecheck, build, package validation, and security gate on one final commit.
