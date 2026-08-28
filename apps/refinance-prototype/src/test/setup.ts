// Vitest setup — registers @testing-library/jest-dom matchers (toBeInTheDocument,
// etc.) and auto-cleans the DOM between React tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
