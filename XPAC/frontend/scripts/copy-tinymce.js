// Copies the self-hosted TinyMCE build into public/ so the editor is served
// from our own domain instead of Tiny Cloud (which requires an API key
// registered per domain). Runs on postinstall and before start/build.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'tinymce');
const dest = path.join(__dirname, '..', 'public', 'tinymce');

if (!fs.existsSync(src)) {
  console.warn('[copy-tinymce] node_modules/tinymce not found; skipping.');
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('[copy-tinymce] Copied TinyMCE to public/tinymce');
