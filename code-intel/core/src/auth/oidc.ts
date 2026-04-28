/**
 * OIDC / OAuth2 Integration — 1.3
 *
 * Supports: GitHub, GitLab, Google, Okta, Azure AD, and any standards-compliant
 * OpenID Connect provider via issuer URL discovery.
 *
 * Configuration is driven by environment variables:
 *   CODE_INTEL_OIDC_ISSUER        – issuer URL  (e.g. https://accounts.google.com)
 *   CODE_INTEL_OIDC_CLIENT_ID     – client_id
 *   CODE_INTEL_OIDC_CLIENT_SECRET – client_secret
 *   CODE_INTEL_OIDC_REDIRECT_URI  – callback URL (e.g. http://localhost:4747/auth/callback)
 *   CODE_INTEL_OIDC_SCOPES        – space-separated, default: "openid email profile"
 *   CODE_INTEL_OIDC_DEFAULT_ROLE  – role assigned on first login, default: "viewer"
 *   CODE_INTEL_BASE_URL           – base URL of this server  (used to build redirect_uri when REDIRECT_URI unset)
 */

import * as oidcClient from 'openid-client';
import crypto from 'node:crypto';
import type { Role } from './users-db.js';
import Logger from '../shared/logger.js';

// ── Known-provider helper configs ────────────────────────────────────────────

export type OIDCProvider =
  | 'github'
  | 'gitlab'
  | 'google'
  | 'okta'
  | 'azure'
  | 'custom';

const PROVIDER_ISSUERS: Record<string, string> = {
  github: 'https://token.actions.githubusercontent.com', // GitHub OIDC
  google: 'https://accounts.google.com',
  // gitlab & okta require a tenant URL — must be passed via CODE_INTEL_OIDC_ISSUER
};

// ── PKCE / state in-memory store (server-side, short-lived) ──────────────────
//
// Maps state → { codeVerifier, nonce, createdAt }
// Entries are cleaned up after 10 minutes (standard auth-flow timeout).

interface OIDCPendingFlow {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

export const oidcPendingFlows = new Map<string, OIDCPendingFlow>();

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function cleanExpiredFlows(): void {
  const now = Date.now();
  for (const [state, flow] of oidcPendingFlows.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      oidcPendingFlows.delete(state);
    }
  }
}

// Clean every 5 minutes
setInterval(cleanExpiredFlows, 5 * 60 * 1000).unref();

// ── OIDCConfig — parsed from env ──────────────────────────────────────────────

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  defaultRole: Role;
}

export function getOIDCConfig(): OIDCConfig | null {
  const issuer =
    process.env['CODE_INTEL_OIDC_ISSUER'] ?? '';
  const clientId =
    process.env['CODE_INTEL_OIDC_CLIENT_ID'] ?? '';
  const clientSecret =
    process.env['CODE_INTEL_OIDC_CLIENT_SECRET'] ?? '';

  if (!issuer || !clientId || !clientSecret) {
    return null; // OIDC not configured
  }

  const base =
    process.env['CODE_INTEL_BASE_URL'] ?? 'http://localhost:4747';
  const redirectUri =
    process.env['CODE_INTEL_OIDC_REDIRECT_URI'] ??
    `${base}/auth/callback`;

  const scopes =
    process.env['CODE_INTEL_OIDC_SCOPES'] ?? 'openid email profile';

  const rawRole =
    process.env['CODE_INTEL_OIDC_DEFAULT_ROLE'] ?? 'viewer';
  const validRoles: Role[] = ['admin', 'analyst', 'viewer', 'repo-owner'];
  const defaultRole: Role = validRoles.includes(rawRole as Role)
    ? (rawRole as Role)
    : 'viewer';

  return { issuer, clientId, clientSecret, redirectUri, scopes, defaultRole };
}

// ── Cached discovered configuration ──────────────────────────────────────────

let _cachedConfig: oidcClient.Configuration | null = null;
let _cachedIssuer = '';

export async function getDiscoveredConfig(): Promise<oidcClient.Configuration | null> {
  const cfg = getOIDCConfig();
  if (!cfg) return null;

  // Re-discover if issuer changed (e.g. config hot-reload)
  if (_cachedConfig && _cachedIssuer === cfg.issuer) {
    return _cachedConfig;
  }

  try {
    Logger.info(`[oidc] Discovering OIDC config from: ${cfg.issuer}`);
    const config = await oidcClient.discovery(
      new URL(cfg.issuer),
      cfg.clientId,
      cfg.clientSecret,
    );
    _cachedConfig = config;
    _cachedIssuer = cfg.issuer;
    Logger.info('[oidc] Discovery succeeded');
    return config;
  } catch (err) {
    Logger.warn(
      '[oidc] Discovery failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// Force a fresh discovery (useful in tests / config changes)
export function resetOIDCConfig(): void {
  _cachedConfig = null;
  _cachedIssuer = '';
}

// ── Step 1: Build authorization redirect URL (server-side) ───────────────────

export interface OIDCLoginInit {
  redirectUrl: string;
  state: string;
}

export async function buildOIDCLoginUrl(): Promise<OIDCLoginInit | null> {
  const cfg = getOIDCConfig();
  if (!cfg) return null;

  const config = await getDiscoveredConfig();
  if (!config) return null;

  const codeVerifier = oidcClient.randomPKCECodeVerifier();
  const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
  const state = oidcClient.randomState();
  const nonce = oidcClient.randomNonce();

  const params: Record<string, string> = {
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };

  const redirectUrl = oidcClient.buildAuthorizationUrl(config, params);

  oidcPendingFlows.set(state, {
    codeVerifier,
    nonce,
    createdAt: Date.now(),
  });

  return { redirectUrl: redirectUrl.href, state };
}

// ── Step 2: Handle callback — exchange code for tokens + get user info ────────

export interface OIDCUserInfo {
  sub: string;              // Provider user ID
  email?: string;
  name?: string;
  preferred_username?: string;
}

export interface OIDCCallbackResult {
  userInfo: OIDCUserInfo;
  accessToken: string;
  refreshToken?: string;
  idTokenClaims: Record<string, unknown>;
}

export async function handleOIDCCallback(
  currentUrl: URL,
  state: string,
): Promise<OIDCCallbackResult> {
  const cfg = getOIDCConfig();
  if (!cfg) throw new Error('OIDC is not configured');

  // Validate state FIRST — before any network calls so the error is deterministic
  const flow = oidcPendingFlows.get(state);
  if (!flow) {
    throw new Error('Invalid or expired OIDC state. Please start the login again.');
  }

  // Check TTL expiry before consuming the entry
  if (Date.now() - flow.createdAt > FLOW_TTL_MS) {
    oidcPendingFlows.delete(state);
    throw new Error('OIDC flow expired. Please start the login again.');
  }

  // Consume the state entry
  oidcPendingFlows.delete(state);

  // Now attempt discovery — only after state has been validated
  const config = await getDiscoveredConfig();
  if (!config) throw new Error('OIDC provider unreachable');

  // Exchange authorization code for tokens
  const tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: state,
    expectedNonce: flow.nonce,
  });

  // Extract ID token claims — cast to indexable map
  const idTokenClaims: Record<string, unknown> =
    (tokens.claims() as Record<string, unknown> | undefined) ?? {};

  // Fetch userinfo
  let userInfo: OIDCUserInfo;
  try {
    const raw = (await oidcClient.fetchUserInfo(
      config,
      tokens.access_token,
      idTokenClaims['sub'] as string,
    )) as Record<string, unknown>;
    userInfo = {
      sub: (raw['sub'] as string | undefined) ?? (idTokenClaims['sub'] as string),
      email:
        (raw['email'] as string | undefined) ??
        (idTokenClaims['email'] as string | undefined),
      name:
        (raw['name'] as string | undefined) ??
        (idTokenClaims['name'] as string | undefined),
      preferred_username:
        (raw['preferred_username'] as string | undefined) ??
        (idTokenClaims['preferred_username'] as string | undefined),
    };
  } catch {
    // Fallback: use claims from the ID token directly
    userInfo = {
      sub: idTokenClaims['sub'] as string,
      email: idTokenClaims['email'] as string | undefined,
      name: idTokenClaims['name'] as string | undefined,
      preferred_username: idTokenClaims['preferred_username'] as string | undefined,
    };
  }

  return {
    userInfo,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idTokenClaims,
  };
}

// ── Device Authorization Flow (CLI: `code-intel auth login`) ─────────────────
//
// Used when the CLI needs to authenticate without a browser redirect URI
// pointing back to localhost.

export interface DeviceFlowInit {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
}

export async function initiateDeviceFlow(): Promise<{
  deviceResponse: oidcClient.DeviceAuthorizationResponse & { device_code: string };
  config: oidcClient.Configuration;
} | null> {
  const cfg = getOIDCConfig();
  if (!cfg) return null;

  const config = await getDiscoveredConfig();
  if (!config) return null;

  const deviceResponse = await oidcClient.initiateDeviceAuthorization(config, {
    scope: cfg.scopes,
  });

  return { deviceResponse: deviceResponse as typeof deviceResponse & { device_code: string }, config };
}

export async function pollDeviceFlow(
  config: oidcClient.Configuration,
  deviceResponse: oidcClient.DeviceAuthorizationResponse,
): Promise<OIDCCallbackResult> {
  const tokens = await oidcClient.pollDeviceAuthorizationGrant(
    config,
    deviceResponse,
  );

  const idTokenClaims: Record<string, unknown> =
    (tokens.claims() as Record<string, unknown> | undefined) ?? {};

  const userInfo: OIDCUserInfo = {
    sub: idTokenClaims['sub'] as string,
    email: idTokenClaims['email'] as string | undefined,
    name: idTokenClaims['name'] as string | undefined,
    preferred_username: idTokenClaims['preferred_username'] as string | undefined,
  };

  return {
    userInfo,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idTokenClaims,
  };
}

// ── Refresh token rotation ────────────────────────────────────────────────────

export async function refreshOIDCToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const config = await getDiscoveredConfig();
  if (!config) return null;

  try {
    const tokens = await oidcClient.refreshTokenGrant(config, refreshToken);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  } catch (err) {
    Logger.warn('[oidc] Refresh token rotation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Derive a local username from OIDC user info ───────────────────────────────

export function deriveUsername(userInfo: OIDCUserInfo): string {
  // Prefer preferred_username → email prefix → sub hash
  if (userInfo.preferred_username) return userInfo.preferred_username;
  if (userInfo.email) {
    const [prefix] = userInfo.email.split('@');
    if (prefix && prefix.length > 0) return prefix;
  }
  // Fallback: first 12 chars of SHA-256(sub)
  return 'oidc_' + crypto.createHash('sha256').update(userInfo.sub).digest('hex').slice(0, 12);
}

// ── OIDC availability check ───────────────────────────────────────────────────

export function isOIDCConfigured(): boolean {
  return getOIDCConfig() !== null;
}
