/**
 * Supabase client bootstrap.
 * Requires the Supabase JS SDK (loaded via CDN in index.html, see the
 * `<script src=".../@supabase/supabase-js...">` tag) and js/config.js
 * (copied from js/config.example.js) to already be loaded.
 */
(function () {
  function isConfigured() {
    return !!(
      window.SUPABASE_URL &&
      window.SUPABASE_ANON_KEY &&
      window.SUPABASE_URL.indexOf('PASTE_YOUR_') !== 0 &&
      window.SUPABASE_ANON_KEY.indexOf('PASTE_YOUR_') !== 0
    );
  }

  window.supabaseConfigured = isConfigured();

  if (window.supabaseConfigured && window.supabase && window.supabase.createClient) {
    window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      // Admin Dashboard / System Settings require a logged-in Supabase Auth session
      // (see js/app.js initAuth()) - persist it across page reloads/tabs.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  } else {
    window.sb = null;
  }
})();
