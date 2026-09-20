/**
 * Post-build cache-busting script for Capacitor mobile apps.
 *
 * Problem this solves:
 *   When an APK is installed on phone A, then shared via Bluetooth/ShareIt to phone B,
 *   Android WebView on phone B may still serve stale cached assets from a previous
 *   install (because Android caches WebView data per-app-id and Bluetooth transfer
 *   preserves the data folder in some scenarios). The user then sees a white screen
 *   or "Application files are invalid" error.
 *
 * Solution:
 *   1. Inject a <meta name="app-version" content="<hash>"> tag into dist/index.html
 *      so we can detect version mismatches at runtime.
 *   2. Inject a small inline script at the TOP of <head> that:
 *      a. Reads the cached version from localStorage.
 *      b. Compares it to the meta-tag version.
 *      c. If they differ → clears ALL caches, unregisters ALL service workers, and
 *         forces a hard reload (window.location.reload(true)).
 *   3. This runs BEFORE any other JS, so it cleans up stale state before the app
 *      tries to load its assets.
 *
 * This is the most reliable cross-device solution because it doesn't depend on the
 * Service Worker cooperating — it actively destroys any stale SW + cache.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distIndexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(distIndexPath)) {
  console.error('❌ dist/index.html not found. Run "vite build" first.');
  process.exit(1);
}

// Generate a unique version hash for this build
const versionHash = crypto.randomBytes(8).toString('hex');
const buildDate = new Date().toISOString();

let html = fs.readFileSync(distIndexPath, 'utf8');

// Remove any existing app-version meta tag
html = html.replace(/<meta\s+name=["']app-version["'][^>]*>\s*/gi, '');
// Remove any existing cache-buster inline script (idempotent re-runs)
html = html.replace(/<!--CACHE-BUSTER-START-->[\s\S]*?<!--CACHE-BUSTER-END-->\s*/gi, '');

// The inline script runs BEFORE the app's main JS, so it can clean up stale state.
// It uses no external dependencies — pure browser APIs.
const cacheBusterScript = `<!--CACHE-BUSTER-START-->
<meta name="app-version" content="${versionHash}" />
<meta name="app-build-date" content="${buildDate}" />
<script>
(function() {
  'use strict';
  // === Cache-Buster for Capacitor Mobile ===
  // Detects APK version change (e.g. when APK is shared via Bluetooth to another phone)
  // and forcefully clears all stale caches + service workers before the app loads.
  try {
    var currentVersion = "${versionHash}";
    var storedVersion = localStorage.getItem('__app_version__') || '';
    var isCapacitor = (typeof window.Capacitor !== 'undefined') ||
                      window.location.protocol === 'file:' ||
                      window.location.protocol === 'capacitor:';
    var isStale = storedVersion && storedVersion !== currentVersion;

    if (isStale) {
      console.log('[CacheBuster] Version mismatch detected: stored=' + storedVersion + ' current=' + currentVersion);
      console.log('[CacheBuster] Clearing all caches and service workers...');

      // 1. Clear all Cache API entries (Service Worker caches)
      if ('caches' in window) {
        caches.keys().then(function(names) {
          names.forEach(function(name) {
            console.log('[CacheBuster] Deleting cache:', name);
            caches.delete(name);
          });
        }).catch(function() {});
      }

      // 2. Unregister all Service Workers
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          registrations.forEach(function(reg) {
            console.log('[CacheBuster] Unregistering SW:', reg.scope);
            reg.unregister();
          });
        }).catch(function() {});
      }

      // 3. Clear localStorage and sessionStorage (except the version we're about to set)
      // Preserve API_BASE_URL so the user doesn't have to re-enter it.
      var preservedApiUrl = localStorage.getItem('API_BASE_URL') || '';
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
      if (preservedApiUrl) {
        try { localStorage.setItem('API_BASE_URL', preservedApiUrl); } catch (e) {}
      }

      // 4. Store the new version
      try { localStorage.setItem('__app_version__', currentVersion); } catch (e) {}

      // 5. Force hard reload (bypass cache)
      setTimeout(function() {
        // Force a reload that bypasses the cache.
        // The 'true' argument is deprecated in modern browsers but still works in WebView.
        window.location.reload(true);
      }, 300);
      return; // Stop execution — wait for reload
    }

    // First install or same version: just store the version
    if (!storedVersion) {
      try { localStorage.setItem('__app_version__', currentVersion); } catch (e) {}
    }
  } catch (err) {
    // Never let cache-buster break the app — log and continue
    console.warn('[CacheBuster] Error:', err);
  }
})();
</script>
<!--CACHE-BUSTER-END-->`;

// Inject the cache-buster right after <head>
if (html.includes('<head>')) {
  html = html.replace('<head>', '<head>\n  ' + cacheBusterScript);
} else {
  // Fallback: prepend before the first <script> tag
  html = cacheBusterScript + '\n' + html;
}

fs.writeFileSync(distIndexPath, html, 'utf8');

console.log('✅ Cache-buster injected into dist/index.html');
console.log('   Version hash:', versionHash);
console.log('   Build date:', buildDate);
console.log('');
console.log('   This APK will:');
console.log('   - Detect version mismatch when installed on a new phone');
console.log('   - Clear all stale caches + Service Workers automatically');
console.log('   - Force a clean reload with fresh assets');
console.log('   - Preserve the user\'s API_BASE_URL setting');
