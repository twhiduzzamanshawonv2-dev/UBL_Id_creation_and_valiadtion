/**
 * Generates js/config.js from environment variables at build time.
 * Run by Vercel's build command (see vercel.json) so the real
 * SUPABASE_URL / SUPABASE_ANON_KEY never need to be committed to git.
 *
 * For local dev, just copy js/config.example.js to js/config.js by hand
 * instead of running this script.
 */
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.');
  process.exit(1);
}

const content = `window.SUPABASE_URL = ${JSON.stringify(url)};\nwindow.SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};\n`;

fs.writeFileSync(path.join(__dirname, '..', 'js', 'config.js'), content);
console.log('js/config.js generated from environment variables.');
