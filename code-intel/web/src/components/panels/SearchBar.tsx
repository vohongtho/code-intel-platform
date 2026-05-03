import React, { useState } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';

export function SearchBar() {
  const { state, dispatch } = useAppState();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const client = new ApiClient(state.serverUrl);
      const { results } = await client.search(query);
      dispatch({ type: 'SET_SEARCH', query, results });
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        className="flex-1 bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition"
        placeholder="Search symbols…"
      />
      <button
        onClick={handleSearch}
        disabled={loading}
        className="bg-accent hover:opacity-90 disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm text-white font-medium transition"
      >
        {loading ? '…' : 'Search'}
      </button>
    </div>
  );
}
