import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '../../test/utils';
import { QueryPanel } from './QueryPanel';
import type { GQLResult } from 'code-intel-shared';
import { InvalidGQLResultError, normalizeGQLResult } from '../../api/client';

const queryGQLMock = vi.fn<(_: string) => Promise<GQLResult>>();

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ApiClient: class {
      constructor(_: string) {}
      queryGQL = queryGQLMock;
    },
  };
});

describe('normalizeGQLResult', () => {
  it('accepts legacy aggregate responses without nodes', () => {
    const result = normalizeGQLResult({
      groups: [{ key: 'auth', count: 2 }],
      executionTimeMs: 1,
      truncated: false,
      totalCount: 2,
    });

    expect(result.kind).toBe('aggregate');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.path).toBeNull();
    expect(result.groups).toEqual([{ key: 'auth', count: 2 }]);
  });

  it('rejects unknown kinds', () => {
    expect(() => normalizeGQLResult({
      kind: 'weird',
      nodes: [],
      edges: [],
      groups: [],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 0,
    })).toThrow(InvalidGQLResultError);
  });

  it('rejects invalid scalars', () => {
    expect(() => normalizeGQLResult({
      kind: 'aggregate',
      nodes: [],
      edges: [],
      groups: [],
      path: null,
      executionTimeMs: -1,
      truncated: false,
      totalCount: 0,
    })).toThrow('executionTimeMs');
  });

  it('rejects malformed groups', () => {
    expect(() => normalizeGQLResult({
      kind: 'aggregate',
      nodes: [],
      edges: [],
      groups: [{ key: 'auth', count: '2' }],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 2,
    })).toThrow(InvalidGQLResultError);
  });

  it('normalizes missing collections for explicit nodes result', () => {
    const result = normalizeGQLResult({
      kind: 'nodes',
      executionTimeMs: 1,
      truncated: false,
      totalCount: 0,
    });

    expect(result.kind).toBe('nodes');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.path).toBeNull();
  });

  it('rejects invalid path primitive', () => {
    expect(() => normalizeGQLResult({
      kind: 'path',
      nodes: [],
      edges: [],
      groups: [],
      path: 'bad',
      executionTimeMs: 1,
      truncated: false,
      totalCount: 0,
    })).toThrow('path');
  });
});

describe('QueryPanel', () => {
  beforeEach(() => {
    queryGQLMock.mockReset();
  });

  it('renders grouped COUNT results in GroupTable without NodeTable', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'aggregate',
      nodes: [],
      edges: [],
      groups: [{ key: 'auth', count: 2 }, { key: '(none)', count: 1 }],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 3,
    });

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'COUNT function GROUP BY cluster' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('auth')).toBeInTheDocument();
    expect(screen.getByText('(none)')).toBeInTheDocument();
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
  });

  it('shows API errors as panel errors', async () => {
    queryGQLMock.mockRejectedValue(new Error('GQL parse error: expected identifier'));

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'COUNT function GROUP BY' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('GQL parse error: expected identifier')).toBeInTheDocument();
  });

  it('shows empty aggregate state', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'aggregate',
      nodes: [],
      edges: [],
      groups: [],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 0,
    });

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'COUNT function WHERE name CONTAINS "zzz"' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('No groups matched.')).toBeInTheDocument();
  });

  it('renders plain node results', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'nodes',
      nodes: [{ id: 'fn1', name: 'handleLogin', kind: 'function', filePath: 'auth/login.ts' }],
      edges: [],
      groups: [],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 1,
    });

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'FIND function' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('handleLogin')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('renders empty path state', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'path',
      nodes: [],
      edges: [],
      groups: [],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 0,
    });

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'PATH FROM "a" TO "b"' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('No path found.')).toBeInTheDocument();
  });

  it('renders traversal results with edge metadata', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'traversal',
      nodes: [
        { id: 'fn1', name: 'handleLogin', kind: 'function', filePath: 'auth/login.ts' },
        { id: 'fn2', name: 'handleLogout', kind: 'function', filePath: 'auth/logout.ts' },
      ],
      edges: [{ id: 'e1', source: 'fn1', target: 'fn2', kind: 'calls' }],
      groups: [],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 2,
    });

    renderWithApp(<QueryPanel />, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'TRAVERSE CALLS FROM "handleLogin" DEPTH 1' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('handleLogout')).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('edge') && text.includes('in result'))).toBeInTheDocument();
  });

  it('contains render failures locally', async () => {
    queryGQLMock.mockResolvedValue({
      kind: 'aggregate',
      nodes: [],
      edges: [],
      groups: [{ get key() { throw new Error('boom'); }, count: 1 } as unknown as { key: string; count: number }],
      path: null,
      executionTimeMs: 1,
      truncated: false,
      totalCount: 1,
    });

    renderWithApp(<>
      <div>Shell alive</div>
      <QueryPanel />
    </>, '/explore');
    fireEvent.change(screen.getByPlaceholderText('FIND function WHERE name CONTAINS "auth"'), { target: { value: 'COUNT function GROUP BY cluster' } });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    expect(await screen.findByText('Result rendering failed. Retry the query.')).toBeInTheDocument();
    expect(screen.getByText('Shell alive')).toBeInTheDocument();
  });
});
