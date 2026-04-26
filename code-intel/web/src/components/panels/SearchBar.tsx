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
        className="flex-1 bg-gray-700 rounded-lg px-3 py-1.5 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
        placeholder="Search symbols..."
      />
      <button
        onClick={handleSearch}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm text-white"
      >
        {loading ? '...' : 'Search'}
      </button>
    </div>
  );
}
