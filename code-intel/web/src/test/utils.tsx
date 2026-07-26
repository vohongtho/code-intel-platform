import React from 'react';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import { AppProvider } from '../state/app-context';

export function renderWithApp(ui: React.ReactElement, route = '/login') {
  window.history.replaceState({}, '', route);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProvider>{ui}</AppProvider>
    </MemoryRouter>,
  );
}
