/**
 * Ensures the Android platform has been added to the Capacitor project.
 * If `npx cap add android` was never run, this script runs it automatically.
 * If the android folder already exists, it just skips.
 *
 * This is called by `npm run build:mobile` before `cap sync android` so the
 * user doesn't have to remember to run `npx cap add android` first.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const androidDir = path.join(__dirname, '..', 'android');

if (fs.existsSync(androidDir) && fs.existsSync(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'))) {
  console.log('✅ Android platform already exists — skipping add step.');
  process.exit(0);
}

console.log('📦 Android platform not found. Adding it now (one-time setup)...');
console.log('   Running: npx cap add android');

try {
  execSync('npx cap add android', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ Android platform added successfully!');

  // Auto-patch the AndroidManifest.xml for cleartext traffic (allow HTTP local server)
  console.log('🔧 Patching AndroidManifest.xml for cleartext traffic...');
  try {
    execSync('node scripts/patch-android.cjs', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (patchErr) {
    console.warn('⚠️  Patch script failed (non-fatal):', patchErr.message);
  }

  console.log('');
  console.log('🎉 Android platform is ready!');
  console.log('   Next: run "npm run cap:sync" or "npm run build:mobile" again to sync web assets.');
} catch (err) {
  console.error('❌ Failed to add Android platform:');
  console.error('   ', err.message);
  console.error('');
  console.error('Possible causes:');
  console.error('  1. Capacitor CLI not installed — run: npm install @capacitor/cli @capacitor/core @capacitor/android');
  console.error('  2. capacitor.config.json is missing or invalid');
  console.error('  3. dist/ folder is missing — run: npm run build:web');
  console.error('');
  process.exit(1);
}
