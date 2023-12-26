import { Database } from 'database.types';
import * as process from 'process';
import { createClient } from '@supabase/supabase-js';

// we provide defaults for testing in isolation
const API_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_TEST_EMAIL =
  process.env['SUPABASE_TEST_EMAIL'] ?? 'test-sdk@makerkit.dev';
const SUPABASE_TEST_PASSWORD =
  process.env['SUPABASE_TEST_PASSWORD'] ?? 'testing';

type Client = ReturnType<typeof createClient<Database>>;

export async function createSupabaseClient(params: { auth: boolean }) {
  const client = createClient<Database>(SUPABASE_URL, API_KEY, {
    auth: {
      persistSession: false,
    },
  });

  if (params.auth) {
    await withAuth(client);
  }

  return client;
}

function withAuth(client: Client) {
  return client.auth.signInWithPassword({
    email: SUPABASE_TEST_EMAIL,
    password: SUPABASE_TEST_PASSWORD,
  });
}
