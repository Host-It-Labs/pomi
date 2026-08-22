import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const watchRoot = new URL(
  '../packages/frontend/src-tauri/gen/apple/PomiWatch/',
  import.meta.url
);
const tauriRoot = new URL('../packages/frontend/src-tauri/', import.meta.url);
const wearRoot = new URL('gen/android/wear/src/main/', tauriRoot);

test('native watch launchers use the canonical Pomi brand assets', async () => {
  const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const [
    manifest,
    watchIcons,
    appleWatchIcon,
    appleSourceIcon,
    applePairingLogo,
    applePairingView,
    brandSourceIcon,
    ...wearIconPairs
  ] = await Promise.all([
    readFile(new URL('AndroidManifest.xml', wearRoot), 'utf8'),
    readFile(
      new URL(
        'gen/apple/PomiWatch/Assets.xcassets/AppIcon.appiconset/Contents.json',
        tauriRoot
      ),
      'utf8'
    ).then(JSON.parse),
    readFile(
      new URL(
        'gen/apple/PomiWatch/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
        tauriRoot
      )
    ),
    readFile(
      new URL(
        'gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
        tauriRoot
      )
    ),
    readFile(
      new URL(
        'gen/apple/PomiWatch/Assets.xcassets/PomiLogo.imageset/PomiLogo.png',
        tauriRoot
      )
    ),
    readFile(
      new URL('gen/apple/PomiWatch/ContentView.swift', tauriRoot),
      'utf8'
    ),
    readFile(new URL('../app-icon.png', import.meta.url)),
    ...densities.map(density =>
      Promise.all([
        readFile(
          new URL(`res/mipmap-${density}/ic_watch_launcher.png`, wearRoot)
        ),
        readFile(
          new URL(
            `gen/android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
            tauriRoot
          )
        ),
      ])
    ),
  ]);

  assert.match(manifest, /android:icon="@mipmap\/ic_watch_launcher"/);
  assert.equal((manifest.match(/@mipmap\/ic_watch_launcher/g) ?? []).length, 2);
  assert.deepEqual(watchIcons.images, [
    {
      filename: 'AppIcon.png',
      idiom: 'universal',
      platform: 'watchos',
      size: '1024x1024',
    },
  ]);
  assert.deepEqual(appleWatchIcon, appleSourceIcon);
  assert.deepEqual(applePairingLogo, brandSourceIcon);
  assert.match(applePairingView, /Image\("PomiLogo"\)/);
  assert.doesNotMatch(applePairingView, /Image\(systemName: "timer"\)/);
  for (const [wearIcon, sourceIcon] of wearIconPairs) {
    assert.deepEqual(wearIcon, sourceIcon);
  }
});

test('Apple Watch resume carries the current timer type', async () => {
  const content = await readFile(
    new URL('ContentView.swift', watchRoot),
    'utf8'
  );

  assert.match(
    content,
    /timerType: timer\.status == "paused" \? timer\.type : nil/
  );
});

test('Apple Watch waits for accepted user actions before refreshing', async () => {
  const api = await readFile(new URL('WatchAPI.swift', watchRoot), 'utf8');

  assert.match(
    api,
    /while status\.status == "accepted" \|\| status\.status == "running"/
  );
  assert.match(api, /\/user-actions\/\\\(status\.actionId\)\?waitMs=15000/);
  assert.match(api, /status\.error\?\.message \?\? "Action failed"/);
  assert.doesNotMatch(api, /method: String =/);
  assert.doesNotMatch(api, /timerType: String\? =/);
});

test('iOS release configuration uses production APNs and derives Google callback', async () => {
  const project = await readFile(new URL('../project.yml', watchRoot), 'utf8');

  assert.match(project, /aps-environment: \$\(APS_ENVIRONMENT\)/);
  assert.match(project, /debug:\n\s+APS_ENVIRONMENT: development/);
  assert.match(project, /release:\n\s+APS_ENVIRONMENT: production/);
  assert.match(project, /client_id="\$\{VITE_GOOGLE_AUTH_CLIENT_ID:-\}"/);
  assert.match(
    project,
    /reversed_client_id="com\.googleusercontent\.apps\.\$\{client_prefix\}"/
  );
});

test('macOS enables native Apple sign-in and in-app purchases', async () => {
  const [
    rust,
    cargo,
    releaseConfigSource,
    devConfigSource,
    capabilitySource,
    entitlements,
    macosRustBridge,
    macosStoreKitBridge,
  ] = await Promise.all([
    readFile(new URL('src/lib.rs', tauriRoot), 'utf8'),
    readFile(new URL('Cargo.toml', tauriRoot), 'utf8'),
    readFile(new URL('tauri.conf.json', tauriRoot), 'utf8'),
    readFile(new URL('tauri.dev.conf.json', tauriRoot), 'utf8'),
    readFile(new URL('capabilities/apple-desktop.json', tauriRoot), 'utf8'),
    readFile(new URL('Entitlements.plist', tauriRoot), 'utf8'),
    readFile(
      new URL('vendor/tauri-plugin-iap/src/macos.rs', tauriRoot),
      'utf8'
    ),
    readFile(
      new URL(
        'vendor/tauri-plugin-iap/macos/Sources/IapPlugin.swift',
        tauriRoot
      ),
      'utf8'
    ),
  ]);
  const releaseConfig = JSON.parse(releaseConfigSource);
  const devConfig = JSON.parse(devConfigSource);
  const capability = JSON.parse(capabilitySource);

  for (const config of [releaseConfig, devConfig]) {
    assert.ok(
      config.app.security.capabilities.includes('apple-desktop-capability')
    );
    assert.equal(config.bundle.macOS.entitlements, './Entitlements.plist');
  }
  assert.deepEqual(capability.platforms, ['macOS']);
  assert.ok(capability.permissions.includes('iap:default'));
  assert.ok(
    capability.permissions.includes('siwa:allow-get-apple-id-credential')
  );
  assert.match(
    rust,
    /#\[cfg\(target_os = "macos"\)\]\s+let builder = builder\s+\.plugin\(tauri_plugin_iap::init\(\)\)\s+\.plugin\(tauri_plugin_siwa::init\(\)\);/
  );
  assert.match(
    cargo,
    /\[target\.'cfg\(target_os = "macos"\)'\.dependencies\][\s\S]*?tauri-plugin-iap = "0\.9"[\s\S]*?tauri-plugin-siwa = "1\.0\.0"/
  );
  assert.match(entitlements, /com\.apple\.developer\.applesignin/);
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(entitlements, /com\.apple\.security\.network\.client/);
  assert.match(macosRustBridge, /appAccountToken: Option<String>/);
  assert.match(macosRustBridge, /options\.app_account_token/);
  assert.match(
    macosStoreKitBridge,
    /purchaseOptions\.insert\(\.appAccountToken\(uuid\)\)/
  );
  assert.match(
    macosStoreKitBridge,
    /product\.purchase\(options: purchaseOptions\)/
  );
});
