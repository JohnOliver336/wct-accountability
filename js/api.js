import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Add ?demo to the address to try the site with made-up data, even once it's connected.
export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY || new URLSearchParams(location.search).has('demo');

export const api = DEMO
  ? (await import('./api-demo.js')).createDemoApi()
  : (await import('./api-supabase.js')).createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY);
