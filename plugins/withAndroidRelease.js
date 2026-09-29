// Expo config plugin: Android release build setup, applied on every `npx expo prebuild`.
//
// 1. Signing: if ../signing/keystore.properties exists (next to the project folder's root,
//    i.e. <project>/signing/keystore.properties), release builds are signed with that key.
//    Otherwise release APKs are left unsigned (CI signs them later). Passwords never go in git.
//      storeFile=tuitionbook-release.jks
//      storePassword=...
//      keyAlias=tuitionbook
//      keyPassword=...
// 2. One APK per CPU type plus a universal APK (smaller downloads).
//    CPU types come from TB_ABIS (default: armeabi-v7a,arm64-v8a).
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARK = '// tuitionbook-release-plugin';

function abis() {
  return (process.env.TB_ABIS || 'armeabi-v7a,arm64-v8a').split(',').map((s) => s.trim()).filter(Boolean);
}

function editBuildGradle(src) {
  if (src.includes(MARK)) return src;
  let s = src;

  // Load signing properties (if present) before the android block.
  s = s.replace(
    /\nandroid \{\n/,
    `\n${MARK}
def tbSigningFile = rootProject.file('../signing/keystore.properties')
def tbSigning = new Properties()
if (tbSigningFile.exists()) { tbSigningFile.withInputStream { tbSigning.load(it) } }

android {
    splits { abi { enable true; reset(); include ${abis().map((a) => `'${a}'`).join(', ')}; universalApk true } }
`,
  );

  // A release signing config that reads the properties.
  s = s.replace(
    /signingConfigs \{\n/,
    `signingConfigs {
        release {
            if (tbSigningFile.exists()) {
                storeFile rootProject.file('../signing/' + tbSigning['storeFile'])
                storePassword tbSigning['storePassword']
                keyAlias tbSigning['keyAlias']
                keyPassword tbSigning['keyPassword']
            }
        }
`,
  );

  // Release build type: sign with the release key when available, otherwise unsigned.
  const bt = s.indexOf('buildTypes');
  const rel = s.indexOf('release {', bt);
  const line = 'signingConfig signingConfigs.debug';
  const at = s.indexOf(line, rel);
  if (bt < 0 || rel < 0 || at < 0) throw new Error('withAndroidRelease: could not find the release signing line');
  s = s.slice(0, at) + 'signingConfig tbSigningFile.exists() ? signingConfigs.release : null' + s.slice(at + line.length);

  if (!s.includes('splits { abi') || !s.includes('tbSigning[')) throw new Error('withAndroidRelease: build.gradle edit failed');
  return s;
}

module.exports = function withAndroidRelease(config) {
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = editBuildGradle(c.modResults.contents);
    return c;
  });
  config = withGradleProperties(config, (c) => {
    const set = (key, value) => {
      const item = c.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else c.modResults.push({ type: 'property', key, value });
    };
    set('reactNativeArchitectures', abis().join(','));
    set('org.gradle.jvmargs', '-Xmx4g -XX:MaxMetaspaceSize=1g');
    set('org.gradle.parallel', 'true');
    set('org.gradle.caching', 'true');
    return c;
  });
  return config;
};
