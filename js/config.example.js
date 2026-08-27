/**
 * Supabase Frontend Configuration - TEMPLATE
 * -----------------------------------------------------------------------
 * Copy this file to `js/config.js` (which is gitignored - never commit real
 * credentials) and fill in your project's values from:
 *   Supabase Dashboard -> Project Settings -> API
 *
 * Only the PROJECT URL and the ANON (public) KEY belong here. The anon key is
 * safe to ship to the browser by design - it can only do what the Row Level
 * Security policies in supabase/schema.sql allow. NEVER put the service_role
 * key in this file or anywhere under js/ - it must only ever live in
 * migration/.env (used by the one-off Node migration script, never shipped
 * to a browser).
 */
window.SUPABASE_URL = 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE';
window.SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE';
