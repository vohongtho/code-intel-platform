/**
 * workflow-routes.ts
 *
 * HTTP transport for change-workflow sessions and group system flows.
 *
 * Ownership model (the reason these endpoints were deferred at first): the
 * HTTP server is multi-user, while CLI/MCP are single-user local transports.
 * - A session started over HTTP records its creator as `owner`.
 * - Only the owner or an admin can read or advance a session; sessions
 *   without an owner (created via CLI/MCP) are admin-only over HTTP.
 * - Every repository in a session's scope must pass the same repo-access
 *   rule as `requireRepoAccess` (repo-scoped tokens must cover all of them),
 *   so a group session cannot be reached with a token scoped to one member.
 * - Mutations additionally require at least the `analyst` role, like other
 *   state-changing endpoints (group edits, graph diff).
 * - Lookups are strict: only the selected repository's store or the named
 *   group's store is searched — never every group root.
 */

import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { requireAuth, requireRole, requireToolScope } from '../auth/middleware.js';
import { ErrorCodes } from '../errors/codes.js';
import { isSafeGroupName, loadGroup } from '../multi-repo/group-registry.js';
import { getGroupSystemFlows, querySystemFlows } from '../multi-repo/system-flows/service.js';
import { loadRegistry } from '../storage/repo-registry.js';
import {
  locateSession,
  runChangeWorkflowAction,
  workflowErrorPayload,
  type ChangeWorkflowServiceDeps,
} from '../agents/workflows/session-service.js';
import { WorkflowSessionError, type WorkflowSessionErrorCode } from '../agents/workflows/session-store.js';
import type { ChangeWorkflowSession } from '../agents/workflows/session-types.js';

type AuthUser = NonNullable<Request['user']>;

export interface WorkflowRouteOptions {
  repoName: string;
  workspaceRoot?: string;
  deps?: ChangeWorkflowServiceDeps;
}

const STATUS_BY_CODE: Record<WorkflowSessionErrorCode, number> = {
  INVALID_ID: 400,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  INDEX_NOT_READY: 409,
  LOCKED: 409,
  CORRUPT: 422,
  OVERSIZE: 422,
  UNSUPPORTED_SCHEMA: 422,
  QUOTA_EXCEEDED: 429,
};

function sendError(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error: { code, message, ...extra } });
}

function sendWorkflowError(res: Response, err: unknown): void {
  const payload = workflowErrorPayload(err);
  if (err instanceof WorkflowSessionError) {
    const status = STATUS_BY_CODE[err.code];
    const code = status === 404 ? ErrorCodes.NOT_FOUND : status === 409 ? ErrorCodes.CONFLICT : status === 429 ? ErrorCodes.RATE_LIMIT_EXCEEDED : ErrorCodes.INVALID_REQUEST;
    sendError(res, status, code, payload.error, { workflowCode: err.code, ...(payload.details ? { details: payload.details } : {}) });
    return;
  }
  sendError(res, 500, ErrorCodes.INTERNAL_ERROR, payload.error);
}

/** Same rule as `requireRepoAccess`: admin/analyst see all repos; repo-scoped tokens only their repos. */
export function hasRepoAccess(user: AuthUser, repositoryId: string): boolean {
  if (user.role === 'admin' || user.role === 'analyst') return true;
  if (user.authMethod === 'token' && user.scopedRepos && user.scopedRepos.length > 0) return user.scopedRepos.includes(repositoryId);
  return true;
}

export function canAccessSession(user: AuthUser, session: ChangeWorkflowSession): { ok: true } | { ok: false; reason: string } {
  const repositories = session.baselines.map((baseline) => baseline.repositoryId);
  const denied = repositories.filter((id) => !hasRepoAccess(user, id));
  if (denied.length > 0) return { ok: false, reason: `no access to repository ${denied[0]}` };
  if (user.role === 'admin') return { ok: true };
  if (!session.owner) return { ok: false, reason: 'session was created by a local transport (CLI/MCP); only admins can access it over HTTP' };
  if (session.owner.userId !== user.id) return { ok: false, reason: 'session belongs to another user' };
  return { ok: true };
}

interface ResolvedScope {
  scope: 'repo' | 'group';
  repoDir?: string;
  groupName?: string;
  repositoryIds: string[];
}

function resolveScope(req: Request, options: WorkflowRouteOptions): ResolvedScope | { error: { status: number; code: string; message: string } } {
  const source = (req.method === 'GET' ? req.query : req.body ?? {}) as Record<string, unknown>;
  const group = typeof source['group'] === 'string' ? source['group'] : undefined;
  if (group || source['scope'] === 'group') {
    if (!group) return { error: { status: 400, code: ErrorCodes.INVALID_REQUEST, message: 'group scope requires `group`' } };
    if (!isSafeGroupName(group)) return { error: { status: 400, code: ErrorCodes.INVALID_REQUEST, message: 'Invalid group name' } };
    const loaded = loadGroup(group);
    if (!loaded) return { error: { status: 404, code: ErrorCodes.NOT_FOUND, message: `Group "${group}" not found` } };
    return { scope: 'group', groupName: group, repositoryIds: loaded.members.map((member) => member.repoId ?? member.registryName) };
  }
  const repoId = typeof source['repoId'] === 'string' ? source['repoId'] : undefined;
  const registry = loadRegistry();
  if (repoId) {
    const entry = registry.find((repo) => repo.id === repoId);
    if (!entry) return { error: { status: 404, code: ErrorCodes.NOT_FOUND, message: `Repo "${repoId}" not found` } };
    return { scope: 'repo', repoDir: entry.path, repositoryIds: [entry.id] };
  }
  if (!options.workspaceRoot) return { error: { status: 400, code: ErrorCodes.INVALID_REQUEST, message: 'repoId is required (the server has no default repository)' } };
  const root = path.resolve(options.workspaceRoot);
  const entry = registry.find((repo) => path.resolve(repo.path) === root);
  return { scope: 'repo', repoDir: root, repositoryIds: [entry?.id ?? options.repoName] };
}

function scopeOrFail(req: Request, res: Response, options: WorkflowRouteOptions): ResolvedScope | null {
  const resolved = resolveScope(req, options);
  if ('error' in resolved) {
    sendError(res, resolved.error.status, resolved.error.code, resolved.error.message);
    return null;
  }
  const denied = resolved.repositoryIds.filter((id) => !hasRepoAccess(req.user!, id));
  if (denied.length > 0) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, `Token does not have access to repository ${denied[0]}`);
    return null;
  }
  return resolved;
}

/** Locates the session strictly within the resolved scope and enforces ownership. */
function authorizedSession(req: Request, res: Response, scope: ResolvedScope, deps: ChangeWorkflowServiceDeps): ChangeWorkflowSession | null {
  try {
    const { session } = locateSession({ sessionId: req.params['id'] as string, repoDir: scope.repoDir, groupName: scope.groupName, strict: true }, deps);
    const access = canAccessSession(req.user!, session);
    if (!access.ok) {
      // Do not reveal another user's session details; existence is already implied by the ID.
      sendError(res, 403, ErrorCodes.FORBIDDEN, access.reason);
      return null;
    }
    return session;
  } catch (err) {
    sendWorkflowError(res, err);
    return null;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : undefined;
}

export function registerWorkflowRoutes(app: Express, options: WorkflowRouteOptions): void {
  const deps = options.deps ?? {};
  const view = requireToolScope('change_workflow');
  const mutate = [requireAuth, requireRole('analyst'), view];

  app.post('/api/v1/workflows', ...mutate, async (req: Request, res: Response) => {
    const scope = scopeOrFail(req, res, options);
    if (!scope) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await runChangeWorkflowAction({
        action: 'start',
        task: str(body['task']),
        scope: scope.scope,
        repoDir: scope.repoDir,
        groupName: scope.groupName,
        targets: strList(body['targets']),
        taskRetention: body['task_retention'] === 'fingerprint-only' ? 'fingerprint-only' : 'summary',
        owner: { userId: req.user!.id, username: req.user!.username },
      }, deps, { strict: true });
      res.status(201).json(result);
    } catch (err) {
      sendWorkflowError(res, err);
    }
  });

  app.get('/api/v1/workflows', requireAuth, view, async (req: Request, res: Response) => {
    const scope = scopeOrFail(req, res, options);
    if (!scope) return;
    try {
      const listed = await runChangeWorkflowAction({ action: 'list', scope: scope.scope, repoDir: scope.repoDir, groupName: scope.groupName }, deps, { strict: true }) as { sessions: Array<{ id: string }> };
      // Only sessions this user may access (admins see all).
      const visible = listed.sessions.filter((summary) => {
        try {
          const { session } = locateSession({ sessionId: summary.id, repoDir: scope.repoDir, groupName: scope.groupName, strict: true }, deps);
          return canAccessSession(req.user!, session).ok;
        } catch {
          return false;
        }
      });
      res.json({ sessions: visible });
    } catch (err) {
      sendWorkflowError(res, err);
    }
  });

  app.get('/api/v1/workflows/:id', requireAuth, view, async (req: Request, res: Response) => {
    const scope = scopeOrFail(req, res, options);
    if (!scope) return;
    if (!authorizedSession(req, res, scope, deps)) return;
    try {
      res.json(await runChangeWorkflowAction({ action: 'status', sessionId: req.params['id'] as string, scope: scope.scope, repoDir: scope.repoDir, groupName: scope.groupName }, deps, { strict: true }));
    } catch (err) {
      sendWorkflowError(res, err);
    }
  });

  for (const action of ['checkpoint', 'verify', 'complete'] as const) {
    app.post(`/api/v1/workflows/:id/${action}`, ...mutate, async (req: Request, res: Response) => {
      const scope = scopeOrFail(req, res, options);
      if (!scope) return;
      if (!authorizedSession(req, res, scope, deps)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        res.json(await runChangeWorkflowAction({
          action,
          sessionId: req.params['id'] as string,
          scope: scope.scope,
          repoDir: scope.repoDir,
          groupName: scope.groupName,
          expectedRevision: typeof body['expected_revision'] === 'number' ? body['expected_revision'] : undefined,
          note: str(body['note']),
          conditions: Array.isArray(body['conditions']) ? body['conditions'] as Array<Record<string, unknown>> : undefined,
          removeConditionIds: strList(body['remove_condition_ids']),
          stepId: str(body['step_id']),
          lenses: strList(body['lenses']),
          edited: body['edited'] === true,
        }, deps, { strict: true }));
      } catch (err) {
        sendWorkflowError(res, err);
      }
    });
  }

  app.get('/api/v1/groups/:name/system-flows', requireAuth, requireToolScope('system_flows'), async (req: Request, res: Response) => {
    const name = req.params['name'] as string;
    if (!isSafeGroupName(name)) {
      sendError(res, 400, ErrorCodes.INVALID_REQUEST, 'Invalid group name');
      return;
    }
    const group = loadGroup(name);
    if (!group) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Group not found');
      return;
    }
    const denied = group.members.map((member) => member.repoId ?? member.registryName).filter((id) => !hasRepoAccess(req.user!, id));
    if (denied.length > 0) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, `Token does not have access to repository ${denied[0]}`);
      return;
    }
    try {
      const { result, cache } = await getGroupSystemFlows(group.name, { allowCache: true });
      const num = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? Number.parseInt(value, 10) : undefined);
      res.json({
        groupName: group.name,
        ...querySystemFlows(result, {
          symbolId: str(req.query['symbol_id']),
          contractId: str(req.query['contract_id']),
          repositoryId: str(req.query['repository_id']),
          limit: num(req.query['limit']),
          offset: num(req.query['offset']),
        }),
        cacheHit: cache.hit,
      });
    } catch (err) {
      sendError(res, 409, ErrorCodes.CONFLICT, err instanceof Error ? err.message : String(err));
    }
  });
}
