const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.log('\x1b[31m%s\x1b[0m', '❌ لم يتم العثور على مجلد أندرويد. يرجى إضافة منصة أندرويد أولاً عن طريق تشغيل:');
  console.log('\x1b[36m%s\x1b[0m', '   npx cap add android');
  console.log('\x1b[31m%s\x1b[0m', '❌ Android folder not found. Please add the android platform first by running:');
  console.log('\x1b[36m%s\x1b[0m', '   npx cap add android\n');
  process.exit(1);
}

try {
  let content = fs.readFileSync(manifestPath, 'utf8');
  
  if (content.includes('android:usesCleartextTraffic="true"')) {
    console.log('\x1b[32m%s\x1b[0m', '✅ ملف AndroidManifest.xml مبرمج بالفعل للسماح بالاتصال المحلي (Cleartext Traffic).');
    console.log('\x1b[32m%s\x1b[0m', '✅ AndroidManifest.xml is already configured for Cleartext HTTP traffic.');
    process.exit(0);
  }

  // Find <application and append android:usesCleartextTraffic="true"
  if (content.includes('<application')) {
    content = content.replace(/<application([^>]*)/, (match, group1) => {
      // Avoid duplicating if it already exists in some other form
      if (group1.includes('android:usesCleartextTraffic')) {
        return match;
      }
      return `<application\n        android:usesCleartextTraffic="true"${group1}`;
    });

    fs.writeFileSync(manifestPath, content, 'utf8');
    console.log('\x1b[32m%s\x1b[0m', '🎉 تم تحديث ملف AndroidManifest.xml بنجاح وتفعيل الاتصال المحلي (Cleartext HTTP Traffic)!');
    console.log('\x1b[32m%s\x1b[0m', '🎉 Successfully updated AndroidManifest.xml to enable Cleartext HTTP traffic!');
    console.log('\x1b[33m%s\x1b[0m', '👉 يمكنك الآن تشغيل التطبيق على الهاتف وسيتصل بالسيرفر بنجاح.');
    console.log('\x1b[33m%s\x1b[0m', '👉 You can now rebuild and run the app on your phone.');
  } else {
    console.log('\x1b[31m%s\x1b[0m', '❌ فشل العثور على وسم <application> داخل AndroidManifest.xml');
  }
} catch (error) {
  console.error('An error occurred while patching AndroidManifest.xml:', error);
}
