import { test } from 'vitest';
import { fetchDataFromSupabase } from './data-loader';

test(`Data Loader`, () => {
  expect(fetchDataFromSupabase).toBeDefined();
});
