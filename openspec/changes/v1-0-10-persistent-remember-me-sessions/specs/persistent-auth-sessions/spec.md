# Capability: Persistent authentication sessions

## ADDED Requirements

### Requirement: Remembered sessions survive server restart

The system SHALL persist remembered sessions so an unexpired authenticated browser remains logged in after `code-intel serve` restarts.

#### Scenario: Restart before expiration

GIVEN a user logs in successfully with `rememberMe: true`
AND the browser retains the issued session cookie
WHEN the serve process stops and a new process starts with the same authentication database
AND the cookie has not expired or been revoked
THEN `/auth/status` returns the authenticated user
AND the user is not required to log in again.

### Requirement: Raw session credentials are not stored

The system SHALL persist only a cryptographic hash of the opaque session token.

#### Scenario: Session record is created

GIVEN a successful login
WHEN the server creates a session
THEN the browser receives a cryptographically random raw token in an HttpOnly cookie
AND persistent storage contains only its hash
AND logs and metrics contain neither value.

### Requirement: Persistent expiration matches cookie lifetime

The server-side expiration and browser cookie lifetime SHALL be derived from the same TTL.

#### Scenario: Remember-me TTL

GIVEN `rememberMe: true`
WHEN a session is created
THEN the persistent row records the remembered TTL and expiration
AND the cookie `Max-Age` represents the same TTL.

#### Scenario: Sliding renewal

GIVEN a valid session enters its renewal window
WHEN an authenticated request resolves it
THEN expiration is extended atomically using its original TTL
AND a revoked or expired record cannot be renewed.

### Requirement: Logout and revocation persist

A revoked session SHALL remain invalid across process restart.

#### Scenario: Logout then restart

GIVEN a user logs out
WHEN the server revokes the persistent session and clears the cookie
AND serve restarts
THEN the old cookie does not authenticate.

#### Scenario: User is disabled

GIVEN a session exists for a user
WHEN that user is disabled or deleted
THEN the session no longer authenticates
AND stale role data in the session cannot override current user state.

### Requirement: Storage failure fails closed

The system SHALL not authenticate a session when persistent session authority cannot be verified.

#### Scenario: Session database unavailable

GIVEN the browser sends a session cookie
WHEN the persistent session store cannot be read
THEN the request is not authenticated from that cookie
AND a sanitized operational error is recorded
AND the raw token is not logged.
