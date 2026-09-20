/**
 * Unified mobile build script (works on Windows + Linux + macOS without cross-env).
 *
 * Steps:
 *   1. Set MOBILE_BUILD=true env var (disables VitePWA in vite.config.ts)
 *   2. Run set-mobile-api-base.cjs (injects API_BASE_URL meta tag)
 *   3. Run vite build (produces dist/ without Service Worker)
 *   4. Run cache-bust-mobile.cjs (injects cache-buster inline script into dist/index.html)
 *   5. Run check-or-add-android.cjs (adds Android platform if missing)
 *   6. Run cap sync android (copies dist/ → android/app/src/main/assets/public/)
 *
 * Usage:  npm run build:mobile
 *
 * Equivalent manual commands (if you prefer to run them individually):
 *   set MOBILE_BUILD=true            (Windows)   or   export MOBILE_BUILD=true   (Linux/Mac)
 *   node scripts/set-mobile-api-base.cjs
 *   npx vite build
 *   node scripts/cache-bust-mobile.cjs
 *   node scripts/check-or-add-android.cjs
 *   npx cap sync android
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(cmd, args, label) {
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────');
  console.log('│ ' + label);
  console.log('└─────────────────────────────────────────────────────────────');
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, MOBILE_BUILD: 'true' },
  });
  if (result.status !== 0) {
    console.error(`❌ Step failed: ${label} (exit code ${result.status})`);
    process.exit(result.status || 1);
  }
}

console.log('🚀 Starting MOBILE BUILD (Android APK)');
console.log('   This will produce a Capacitor-ready dist/ folder WITHOUT Service Worker');
console.log('   (uses custom cache-buster instead to prevent "Application files are invalid" errors)');
console.log('');

// Step 1: set-mobile-api-base (sets API_BASE_URL in index.html meta tag)
run('node', ['scripts/set-mobile-api-base.cjs'], 'STEP 1/5: Setting API base URL in index.html');

// Step 2: vite build (MOBILE_BUILD=true is set via env in run())
run('npx', ['vite', 'build'], 'STEP 2/5: Building web assets (VitePWA disabled)');

// Step 3: cache-bust-mobile (injects version-aware cache-buster inline script)
run('node', ['scripts/cache-bust-mobile.cjs'], 'STEP 3/5: Injecting cache-buster into dist/index.html');

// Step 4: ensure Android platform exists
run('node', ['scripts/check-or-add-android.cjs'], 'STEP 4/5: Ensuring Android platform is added');

// Step 5: cap sync android (copies dist → android)
run('npx', ['cap', 'sync', 'android'], 'STEP 5/5: Syncing web assets to Android project');

console.log('');
console.log('✅ Mobile build completed successfully!');
console.log('');
console.log('Next steps:');
console.log('  1. Open Android Studio:    npm run cap:open-android');
console.log('  2. Build APK:               Build → Build Bundle(s) / APK(s) → Build APK(s)');
console.log('  3. Find APK at:              android/app/build/outputs/apk/debug/app-debug.apk');
console.log('  4. Share via Bluetooth/ShareIt — should work on any phone without "files invalid" error');
