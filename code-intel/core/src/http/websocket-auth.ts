/**
 * WebSocket handshake authentication.
 *
 * Validates the upgrade request by extracting credentials from either:
 *   1. `code_intel_session` cookie (browser session), OR
 *   2. `Authorization: Bearer <token>` header, OR
 *   3. `?token=<token>` query parameter (fallback for clients that cannot
 *      set Authorization headers in the handshake, e.g. some browsers).
 *
 * Returns the authenticated user identity, or `null` if the handshake
 * should be rejected. Servers should call this from `noServer` mode and
 * close the socket with status 4401 (custom) or HTTP 401 if it returns null.
 */

import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import { getSession, parseCookies } from '../auth/middleware.js';
import { getOrCreateUsersDB } from '../auth/users-db.js';
import type { Role } from '../auth/users-db.js';

export interface WebSocketUser {
  id: string;
  username: string;
  role: Role;
  authMethod: 'session' | 'token';
}

/**
 * Verify a WebSocket upgrade request.
 * Returns the authenticated user, or `null` if the handshake should be rejected.
 */
export function verifyWebSocketHandshake(req: IncomingMessage): WebSocketUser | null {
  // 1. Try session cookie
  const cookieHeader = (req.headers['cookie'] ?? '') as string;
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies['code_intel_session'];
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return {
        id: session.userId,
        username: session.username,
        role: session.role,
        authMethod: 'session',
      };
    }
  }

  // 2. Try Authorization Bearer header
  const authHeader = (req.headers['authorization'] ?? '') as string;
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const user = lookupTokenUser(token);
      if (user) return user;
    }
  }

  // 3. Try ?token=<token> query parameter
  const url = req.url ?? '';
  const queryStart = url.indexOf('?');
  if (queryStart !== -1) {
    const query = new URLSearchParams(url.slice(queryStart + 1));
    const queryToken = query.get('token');
    if (queryToken) {
      const user = lookupTokenUser(queryToken);
      if (user) return user;
    }
  }

  return null;
}

function lookupTokenUser(rawToken: string): WebSocketUser | null {
  try {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const db = getOrCreateUsersDB();
    const tokenRecord = db.findTokenByHash(hash);
    if (!tokenRecord) return null;
    return {
      id: tokenRecord.id,
      username: `token:${tokenRecord.name}`,
      role: tokenRecord.role,
      authMethod: 'token',
    };
  } catch {
    return null;
  }
}
