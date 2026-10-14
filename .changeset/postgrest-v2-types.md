---
'@makerkit/data-loader-supabase-core': minor
'@makerkit/data-loader-supabase-nextjs': minor
'@makerkit/data-loader-supabase-remix': minor
---

Support `@supabase/postgrest-js` 2.x types.

The data loader types imported files from inside postgrest-js (`dist/module/...`) that no longer exist. With `skipLibCheck` enabled, query result types silently became `any`. Types now come from postgrest-js's public API, so selections are typed again:

- `select: 'id, name'` returns `{ id: number; name: string }[]` (previously `any`, and nested in an extra array).
- `where` functions receive a typed `DataLoader.QueryBuilder<Client, Table>`.
- Requires `@supabase/supabase-js` >= 2.74.0 and `@supabase/postgrest-js` >= 2.0.0.

Projects that relied on the `any` types may see new, correct type errors after upgrading.

The remix package no longer lists `next` as a peer dependency (it never used it).

Packages are now released under the MIT license.
