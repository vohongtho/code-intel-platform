import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithApp } from '../../test/utils';
import { NodeDetail } from './NodeDetail';
import type { CodeNode } from 'code-intel-shared';
import type { ApiContractResult, NodeInspectInfo } from '../../api/client';

const inspectNodeMock = vi.fn<(id: string, repoId?: string) => Promise<NodeInspectInfo>>();
const apiContractMock = vi.fn<(selector: unknown, repoId?: string) => Promise<ApiContractResult[]>>();

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ApiClient: class {
      constructor(_: string) {}
      inspectNode = inspectNodeMock;
      apiContract = apiContractMock;
    },
  };
});

const EMPTY_INSPECT: NodeInspectInfo = {
  node: {} as CodeNode,
  callers: [],
  callees: [],
  imports: [],
  importedBy: [],
  extends: [],
  implementsEdges: [],
  members: [],
};

const ROUTE_NODE: CodeNode = {
  id: 'route-1',
  name: 'GET /users/{}',
  kind: 'route',
  filePath: 'src/app.ts',
};

function contractResult(overrides: Partial<ApiContractResult['route']> = {}, consumers: ApiContractResult['consumers'] = [], consumerCoverageComplete = true): ApiContractResult[] {
  return [
    {
      route: {
        factId: 'express:http-route:src/app.ts:getUser',
        method: 'GET',
        path: '/users/:id',
        normalizedPath: '/users/{}',
        filePath: 'src/app.ts',
        startLine: 3,
        framework: 'express',
        handlerName: 'getUser',
        middlewareRefs: [],
        responses: [],
        coverage: { complete: true, boundaryReasons: [] },
        ...overrides,
      },
      consumers,
      consumerCoverageComplete,
    },
  ];
}

describe('NodeDetail — contract tab', () => {
  beforeEach(() => {
    inspectNodeMock.mockReset();
    apiContractMock.mockReset();
    inspectNodeMock.mockResolvedValue(EMPTY_INSPECT);
  });

  it('does not show a Contract tab for a non-route node', async () => {
    renderWithApp(<NodeDetail node={{ id: 'fn1', name: 'doThing', kind: 'function', filePath: 'a.ts' }} onClose={() => {}} />, '/explore');
    await waitFor(() => expect(inspectNodeMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^contract$/i })).not.toBeInTheDocument();
  });

  it('shows a loading state while the contract is being fetched', async () => {
    let resolveFn: (value: ApiContractResult[]) => void = () => {};
    apiContractMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));

    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    await waitFor(() => expect(inspectNodeMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));

    expect(await screen.findByText(/loading api contract/i)).toBeInTheDocument();
    resolveFn(contractResult());
    await waitFor(() => expect(screen.queryByText(/loading api contract/i)).not.toBeInTheDocument());
  });

  it('shows an error state when the fetch fails', async () => {
    apiContractMock.mockRejectedValue(new Error('Api contract failed: Internal Server Error'));

    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));

    expect(await screen.findByText('Api contract failed: Internal Server Error')).toBeInTheDocument();
  });

  it('shows an empty state when the route has no recoverable API contract', async () => {
    apiContractMock.mockResolvedValue([]);

    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));

    expect(await screen.findByText(/no statically recoverable api contract/i)).toBeInTheDocument();
  });

  it('renders method/path/framework/handler and a partial-coverage badge', async () => {
    apiContractMock.mockResolvedValue(contractResult({ coverage: { complete: false, boundaryReasons: ['unresolved-response-shape'] } }));

    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));

    expect(await screen.findByText('/users/{}')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('express')).toBeInTheDocument();
    expect(screen.getByText('getUser')).toBeInTheDocument();
    expect(screen.getByText(/partial/)).toBeInTheDocument();
  });

  it('distinguishes "proven no consumer" from "no known consumer" (unknown coverage)', async () => {
    apiContractMock.mockResolvedValue(contractResult({}, [], true));
    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));
    expect(await screen.findByText(/no consumers found \(proven/i)).toBeInTheDocument();

    apiContractMock.mockResolvedValue(contractResult({}, [], false));
    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getAllByRole('button', { name: /^contract$/i })[1]!);
    expect(await screen.findByText(/no known consumer/i)).toBeInTheDocument();
  });

  it('renders a known consumer with its match certainty', async () => {
    apiContractMock.mockResolvedValue(
      contractResult({}, [
        {
          consumerFactId: 'fetch:consumer:src/client.ts:2',
          filePath: 'src/client.ts',
          startLine: 2,
          clientLibrary: 'fetch',
          consumedKeys: ['id', 'name'],
          match: {
            referenceId: 'fetch:consumer:src/client.ts:2',
            certainty: 'exact',
            candidates: [{ targetId: 'express:http-route:src/app.ts:getUser', confidence: 1, strategy: 'exact-method-path', evidenceRefs: [] }],
            coverage: { complete: true, emittedCandidates: 1, incompleteReasons: [] },
            resolverVersion: 'api-contract-matcher-v1',
          },
        },
      ]),
    );

    renderWithApp(<NodeDetail node={ROUTE_NODE} onClose={() => {}} />, '/explore');
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));

    expect(await screen.findByText(/src\/client\.ts:2/)).toBeInTheDocument();
    expect(screen.getByText('exact')).toBeInTheDocument();
  });
});
