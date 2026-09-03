import React, { useEffect } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AppProvider, useAppState } from '../state/app-context';
import { GraphDiffPage } from './GraphDiffPage';
import type { CurrentUser } from '../state/types';
import type { GraphDiffOutcome, GraphDiffResponse, SemanticSnapshotDescriptor } from '../api/graph-diff-types';

const graphDiffMock = vi.fn<(req: unknown) => Promise<GraphDiffOutcome>>();
const vectorStatusMock = vi.fn().mockResolvedValue({ ready: false, building: false });

// GraphDiffPage renders the shared <Header>, which polls vectorStatus() on mount —
// stub it too so that unrelated fetch doesn't reject/warn during these tests.
vi.mock('../api/client', () => ({
  ApiClient: class {
    constructor(_: string) {}
    graphDiff = graphDiffMock;
    vectorStatus = vectorStatusMock;
  },
}));

const analystUser: CurrentUser = { id: 'u-analyst', username: 'analyst', role: 'analyst' };

function descriptor(commit: string): SemanticSnapshotDescriptor {
  return {
    snapshotId: `snap-${commit}`,
    repositoryIdentity: 'repo-1',
    gitTree: `tree-${commit}`,
    commit,
    parserFingerprint: 'p1',
    factSchemaFingerprint: 'f1',
    identityFingerprint: 'i1',
    resolverFingerprint: 'r1',
    graphSchemaFingerprint: 'g1',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function baseResponse(overrides: Partial<GraphDiffResponse> = {}): GraphDiffResponse {
  return {
    base: descriptor('base-sha'),
    head: descriptor('head-sha'),
    coverage: { complete: true, examinedCount: 10, incompleteReasons: [] },
    contracts: { findings: [], coverage: { baseRoutes: 0, headRoutes: 0, consumerCoverageComplete: true } },
    flows: { supported: false, reason: 'Flow node identity is not stable across independent analysis runs.' },
    clusters: { supported: false, reason: 'Cluster node identity is not stable across independent analysis runs.' },
    nodes: [],
    nodesTotal: 0,
    nodesOffset: 0,
    nodesLimit: 200,
    nodesHasMore: false,
    relationships: [],
    relationshipsTotal: 0,
    relationshipsOffset: 0,
    relationshipsLimit: 200,
    relationshipsHasMore: false,
    baseSnapshot: { status: 'built', fromCache: false, boundaries: [] },
    headSnapshot: { status: 'built', fromCache: false, boundaries: [] },
    ...overrides,
  };
}

function SeedState({ user = analystUser }: { user?: CurrentUser | null }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    dispatch({ type: 'SET_CURRENT_USER', user });
    dispatch({ type: 'SET_CONNECTED', connected: true });
    dispatch({ type: 'SET_SERVER_URL', url: 'http://localhost:4747' });
    dispatch({ type: 'SET_REPO', repoId: 'repo-demo', name: 'demo-repo' });
  }, [dispatch, user]);
  return null;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/diff']}>
      <AppProvider>
        <SeedState />
        <Routes>
          <Route path="/diff" element={<GraphDiffPage />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

async function runCompare() {
  fireEvent.click(screen.getByRole('button', { name: /compare/i }));
}

describe('GraphDiffPage', () => {
  beforeEach(() => {
    graphDiffMock.mockReset();
  });

  it('renders an empty/exact diff with complete coverage and no deltas', async () => {
    graphDiffMock.mockResolvedValue({ status: 'ok', diff: baseResponse() });
    renderPage();

    await runCompare();

    expect(await screen.findByRole('heading', { name: /^Nodes/ })).toBeInTheDocument();
    expect(screen.getByText('No node deltas.')).toBeInTheDocument();
    expect(screen.getByText('No relationship deltas.')).toBeInTheDocument();
    expect(screen.queryByText(/Partial coverage/i)).not.toBeInTheDocument();
  });

  it('shows a partial-coverage banner with incomplete reasons that stays visible', async () => {
    graphDiffMock.mockResolvedValue({
      status: 'ok',
      diff: baseResponse({
        coverage: { complete: false, examinedCount: 5, totalKnownCount: 10, incompleteReasons: ['analysis-limit exceeded for head snapshot'] },
      }),
    });
    renderPage();

    await runCompare();

    expect(await screen.findByText(/Partial coverage/i)).toBeInTheDocument();
    expect(screen.getByText('analysis-limit exceeded for head snapshot')).toBeInTheDocument();
  });

  it('renders the 422 cache/build error case as a clear failure state, not a crash', async () => {
    graphDiffMock.mockResolvedValue({
      status: 'unavailable',
      detail: {
        error: { code: 'ANALYSIS_FAILED', message: 'Semantic graph diff unavailable for one or both refs' },
        baseSnapshot: { status: 'built', boundaries: [] },
        headSnapshot: { status: 'failed', boundaries: [{ kind: 'analysis-failed', message: 'head ref could not be analyzed' }], error: 'parser crashed' },
      },
    });
    renderPage();

    await runCompare();

    expect(await screen.findByText(/Couldn't compare/i)).toBeInTheDocument();
    expect(screen.getByText(/head ref could not be analyzed/)).toBeInTheDocument();
    expect(screen.getByText('parser crashed')).toBeInTheDocument();
    // No crash: the compare button is still present and usable.
    expect(screen.getByRole('button', { name: /compare/i })).toBeInTheDocument();
  });

  it('paginates a large diff and exposes hasMore via a load-more control', async () => {
    const firstPage = baseResponse({
      nodes: [{ kind: 'added', nodeKind: 'function', headId: 'fn-1', headName: 'fn1', headFilePath: 'a.ts' }],
      nodesTotal: 2,
      nodesOffset: 0,
      nodesLimit: 1,
      nodesHasMore: true,
    });
    const secondPage = baseResponse({
      nodes: [{ kind: 'added', nodeKind: 'function', headId: 'fn-2', headName: 'fn2', headFilePath: 'b.ts' }],
      nodesTotal: 2,
      nodesOffset: 1,
      nodesLimit: 1,
      nodesHasMore: false,
    });
    graphDiffMock.mockResolvedValueOnce({ status: 'ok', diff: firstPage });
    graphDiffMock.mockResolvedValueOnce({ status: 'ok', diff: secondPage });

    renderPage();
    await runCompare();

    expect(await screen.findByText('fn1')).toBeInTheDocument();
    const loadMore = screen.getByRole('button', { name: /load more \(1 \/ 2\)/i });
    fireEvent.click(loadMore);

    expect(await screen.findByText('fn2')).toBeInTheDocument();
    expect(screen.getByText('fn1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(graphDiffMock).toHaveBeenCalledTimes(2);
  });

  it('flags relationship certainty degradation distinctly', async () => {
    graphDiffMock.mockResolvedValue({
      status: 'ok',
      diff: baseResponse({
        relationships: [{
          kind: 'changed',
          edgeKind: 'calls',
          sourceId: 'fn-a',
          targetId: 'fn-b',
          base: { certainty: 'exact', strategy: 'static-call' },
          head: { certainty: 'heuristic', strategy: 'name-match' },
          changedFields: ['certainty', 'strategy'],
        }],
        relationshipsTotal: 1,
      }),
    });
    renderPage();
    await runCompare();

    expect(await screen.findByText(/certainty degraded/i)).toBeInTheDocument();
  });

  it('renders unsupported flow/cluster sections with an explicit reason, not empty', async () => {
    graphDiffMock.mockResolvedValue({ status: 'ok', diff: baseResponse() });
    renderPage();
    await runCompare();

    const flowsHeading = await screen.findByRole('heading', { name: 'Flows' });
    const flowsSection = flowsHeading.closest('section');
    expect(flowsSection).not.toBeNull();
    expect(within(flowsSection as HTMLElement).getByText(/Not supported yet/i)).toBeInTheDocument();

    const clustersHeading = screen.getByRole('heading', { name: 'Clusters' });
    const clustersSection = clustersHeading.closest('section');
    expect(clustersSection).not.toBeNull();
    expect(within(clustersSection as HTMLElement).getByText(/Not supported yet/i)).toBeInTheDocument();
  });
});
