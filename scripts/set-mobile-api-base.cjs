/**
 * Pre-build script: injects <meta name="api-base-url" content="..."> into index.html
 * so the mobile app (Capacitor) knows which server to connect to.
 *
 * Usage:
 *   API_BASE_URL=http://192.168.1.100:3000 node scripts/set-mobile-api-base.cjs
 *
 * Or just edit .env and set MOBILE_API_BASE_URL, then run this script.
 *
 * After running, build the app as usual:
 *   npm run build && npx cap sync android
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');

// Read API URL from env (priority: API_BASE_URL > MOBILE_API_BASE_URL)
let apiUrl = process.env.API_BASE_URL || process.env.MOBILE_API_BASE_URL || '';

if (!apiUrl) {
  console.log('⚠️  No API_BASE_URL or MOBILE_API_BASE_URL set in env.');
  console.log('   The mobile app will fall back to the default production URL.');
  console.log('   To customize, run:');
  console.log('     API_BASE_URL=http://192.168.1.100:3000 node scripts/set-mobile-api-base.cjs');
  console.log('');
  process.exit(0);
}

// Normalize: ensure protocol prefix
apiUrl = apiUrl.trim();
if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
  apiUrl = 'http://' + apiUrl;
}
apiUrl = apiUrl.replace(/\/$/, ''); // strip trailing slash

if (!fs.existsSync(indexPath)) {
  console.error('❌ index.html not found at:', indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// Remove any existing meta tag with the same name
html = html.replace(/<meta\s+name=["']api-base-url["'][^>]*>\s*/gi, '');

// Insert the new meta tag right after <head>
const metaTag = `<meta name="api-base-url" content="${apiUrl}" />\n  `;
if (html.includes('<head>')) {
  html = html.replace('<head>', '<head>\n  ' + metaTag);
} else {
  // Fallback: prepend
  html = metaTag + html;
}

fs.writeFileSync(indexPath, html, 'utf8');

console.log('✅ Mobile API base URL set to:', apiUrl);
console.log('   The Capacitor mobile app will now connect to this server.');
console.log('   Next steps:');
console.log('     1. npm run build');
console.log('     2. npx cap sync android');
console.log('     3. Open Android Studio and build APK');
