# Native Platform Production Setup

Pomi's hosted mode supports Google and Apple authentication, App Store and
Google Play subscriptions, APNs and FCM push notifications, and an Apple Watch
app with a WidgetKit complication. Account-specific credentials are
intentionally blank in tracked files. Complete this guide before producing
signed store builds.

## 1. Hosted backend and access flow

Start from `packages/backend/.env.example` and configure production PostgreSQL,
Redis, HTTPS, and a strong, private `JWT_SECRET`. Set:

```dotenv
POMI_HOSTING_MODE=hosted
POMI_TRUST_PROXY=
```

Leave `POMI_TRUST_PROXY` blank when the backend receives client connections
directly. When HTTPS terminates at a reverse proxy or load balancer, set it to
that proxy's exact comma-separated IP/CIDR ranges so checkout abuse controls
use the real client address. A numeric hop count such as `1` is supported only
when the backend cannot be reached through any shorter direct path. Pomi
rejects the unsafe unrestricted value `true`. Optionally set a separate strong
`BILLING_RATE_LIMIT_HASH_SECRET`; otherwise the required `JWT_SECRET` protects
the pseudonymous limiter keys. Anonymous checkout creation and verification
are limited by normalized client network, opaque checkout token, and an
operational global ceiling; Redis failures fail closed.

Hosted access uses a payment-before-authentication flow:

1. The unauthenticated app requests `POST /billing/checkouts`.
2. The backend creates a durable checkout record and issues its UUID plus a
   cryptographically random opaque token. Only the token hash is stored, and
   the checkout does not expire while a delayed store purchase is awaiting
   account creation or sign-in.
3. The app passes that UUID to StoreKit as `appAccountToken`, or to Google Play
   as the obfuscated external account ID, and completes the purchase.
4. The customer signs in or creates an account.
5. The authenticated app sends the checkout token and signed store purchase to
   `POST /billing/entitlement/claim`.
6. The backend verifies the receipt, requires its store account identifier to
   match the checkout UUID, then atomically binds the checkout to the first
   authenticated Pomi account and attaches the unique transaction before app
   and socket access begin. That account may safely retry the claim, while any
   other account is rejected.

Returning customers can log in directly. Hosted accounts without an active
entitlement are sent to the payment screen; restore and authenticated receipt
sync remain available there. Apple purchases made on either iOS or macOS use
the backend platform value `ios` because both are StoreKit transactions.

Self-hosted deployments keep `POMI_HOSTING_MODE=self-hosted`. They bypass
billing, reject hosted checkout creation and claim verification, and retain the
self-host URL and credential flow.

Run all TypeORM migrations before starting the updated backend:

```bash
pnpm --filter @pomi/backend migration:run
```

When the backend runs in Docker, mount the APNs key and Apple root CA files into
the container and use their in-container absolute paths for `APN_KEY_PATH` and
`APPLE_ROOT_CA_PATHS`. The production Compose file forwards all variables in
this guide but cannot infer host file mounts.

## 2. Account-specific variables to provide

Keep secrets out of Git. The following tracked placeholders are deliberately
blank and must be supplied by the production build or deployment environment.

Backend identity and store verification:

```dotenv
GOOGLE_AUTH_CLIENT_IDS=
APPLE_AUTH_CLIENT_IDS=
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=
APPLE_APP_ID=
APPLE_ROOT_CA_PATHS=
```

Backend push providers:

```dotenv
FIREBASE_SERVICE_ACCOUNT_JSON=
APN_KEY_PATH=
APN_KEY_ID=
APN_TEAM_ID=
```

Native frontend build:

```dotenv
VITE_GOOGLE_AUTH_CLIENT_ID=
VITE_GOOGLE_AUTH_CLIENT_SECRET=
```

`VITE_GOOGLE_AUTH_CLIENT_SECRET` is only for the desktop Google OAuth client
that requires it. Leave it blank in mobile builds. Native Sign in with Apple
does not use a frontend client secret: it depends on the signed Apple bundle,
the Sign in with Apple entitlement, and an accepted audience in
`APPLE_AUTH_CLIENT_IDS`.

These product and bundle values have repository defaults, but they must match
the records created in the Apple and Google consoles:

```dotenv
POMI_SUBSCRIPTION_MONTHLY_PRODUCT_ID=app.pomi.community.pro.monthly
POMI_SUBSCRIPTION_YEARLY_PRODUCT_ID=app.pomi.community.pro.yearly
VITE_SUBSCRIPTION_MONTHLY_PRODUCT_ID=app.pomi.community.pro.monthly
VITE_SUBSCRIPTION_YEARLY_PRODUCT_ID=app.pomi.community.pro.yearly
GOOGLE_PLAY_PACKAGE_NAME=app.pomi.community
APPLE_BUNDLE_ID=app.pomi.community
APPLE_IAP_ENVIRONMENT=sandbox
APN_BUNDLE_ID=app.pomi.community
APN_PRODUCTION=false
```

## 3. Google authentication

In Google Cloud Console:

1. Configure the OAuth consent screen and its production publishing state.
2. Create OAuth clients for every shipped native platform.
3. Configure the Android package name and release signing-certificate
   fingerprints.
4. Put every Google token audience accepted by the backend in the
   comma-separated `GOOGLE_AUTH_CLIENT_IDS` value.
5. Export the platform-appropriate client ID as
   `VITE_GOOGLE_AUTH_CLIENT_ID` when building the frontend.
6. Set `VITE_GOOGLE_AUTH_CLIENT_SECRET` only for the desktop OAuth client that
   requires it.

The iOS build derives and installs the reversed Google callback URL scheme from
`VITE_GOOGLE_AUTH_CLIENT_ID`. Export the value in the environment that launches
the Xcode build.

## 4. Apple authentication and signing

In Apple Developer and App Store Connect, register the shipped identifiers:

- iOS and macOS app bundle: `app.pomi.community`
- Watch app: `app.pomi.community.watchkitapp`
- Watch widget: `app.pomi.community.watchkitapp.widget`
- App group: `group.app.pomi.community`

If separate iOS and macOS records use different bundle identifiers, update the
Tauri configuration and include every resulting Apple identity-token audience
in the comma-separated `APPLE_AUTH_CLIENT_IDS` backend value.

Enable Sign in with Apple and In-App Purchase for the app identifier. Enable
Push Notifications and the app group for the iOS identifier, and enable the
same app group for the Watch app and widget. Create the required development,
distribution, and provisioning assets, then select the Apple development team
for all Xcode targets.

The repository already wires Sign in with Apple and IAP into iOS and macOS.
The macOS Tauri bundle uses `Entitlements.plist` for
`com.apple.developer.applesignin` and grants the native `siwa` and `iap` plugin
permissions through `apple-desktop-capability`. A real macOS sign-in or purchase
still requires an Apple-signed build associated with the configured App Store
Connect app and products.

## 5. Store subscriptions

Create one auto-renewing subscription group and these products in App Store
Connect and Google Play Console:

| Product ID                       | Billing period | Price     |
| -------------------------------- | -------------- | --------- |
| `app.pomi.community.pro.monthly` | One month      | USD 2.99  |
| `app.pomi.community.pro.yearly`  | One year       | USD 24.99 |

Complete each store's paid-app agreement, tax, and banking requirements. Keep
the backend and frontend product ID variables identical if the IDs change.

### App Store and Mac App Store

1. Create the App Store Connect app, subscription group, and both products;
   make the subscriptions available to every Apple platform Pomi ships.
2. Set `APPLE_APP_ID` to the app's numeric App Store Connect ID.
3. Set `APPLE_BUNDLE_ID` to the signed bundle identifier.
4. Download the Apple root CA certificates used to validate signed App Store
   payloads. Put them on the backend host and set their comma-separated absolute
   paths in `APPLE_ROOT_CA_PATHS`.
5. Use `APPLE_IAP_ENVIRONMENT=sandbox` while testing and `production` for the
   production backend.
6. Configure App Store Server Notifications V2 for both sandbox and production:

   ```text
   https://<public-backend-host>/billing/apple/notifications
   ```

Use StoreKit sandbox testers for iPhone and Mac acceptance. Pomi supplies the
server-issued checkout UUID as StoreKit's `appAccountToken`; receipt claims are
rejected if the signed transaction contains another value.

### Google Play

1. Register the Play application with package name `app.pomi.community`.
2. Enable the Google Play Android Developer API in the linked Google Cloud
   project.
3. Create a service account and grant it the minimum Play Console access needed
   to read subscription purchases.
4. Put the complete service-account JSON document in
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` and set
   `GOOGLE_PLAY_PACKAGE_NAME=app.pomi.community`.
5. Configure license testers and publish the products to an internal test
   track before acceptance testing.

Pomi supplies the checkout UUID as the obfuscated external account ID. The
backend removes UUID dashes and compares it with the account identifier returned
by Google Play before claiming the purchase.

## 6. Push notifications

### Apple Push Notification service

Enable Push Notifications on `app.pomi.community`, create an APNs token-signing
`.p8` key, and configure:

```dotenv
APN_KEY_PATH=/absolute/path/to/AuthKey_<KEY_ID>.p8
APN_KEY_ID=
APN_TEAM_ID=
APN_BUNDLE_ID=app.pomi.community
APN_PRODUCTION=false
```

The generated iOS project uses the `development` APNs entitlement for Debug and
`production` for Release. The provisioning profile must include that
entitlement and match `APN_BUNDLE_ID`. Set `APN_PRODUCTION=false` for development
and sandbox device tokens; set it to `true` only for production-signed builds.

After an entitled customer enables push notifications in Pomi, the iOS app asks
for permission, registers with APNs, uploads the device token as platform `ios`,
and installs the `POMI_TIMER` action that opens the timer. Validate foreground,
background, and terminated delivery on a physical iPhone; the simulator alone
is not sufficient release evidence.

### Firebase Cloud Messaging

For Android push, configure Firebase for `app.pomi.community`, add the Firebase
configuration required by the native Android build, create a server service
account, and put its complete JSON document in
`FIREBASE_SERVICE_ACCOUNT_JSON`. Confirm the release signing setup and test on
the same Play track used for IAP acceptance.

## 7. Apple Watch

The iPhone target embeds `PomiWatchApp`, which embeds `PomiWatchWidget`. Before
shipping:

1. Select the same Apple development team for the iPhone, Watch, and widget
   targets.
2. Create matching provisioning profiles for all three identifiers.
3. Add `group.app.pomi.community` to the iPhone, Watch, and widget App IDs and
   confirm it appears in all three signed entitlements.
4. Confirm `PomiWatchApp` is embedded in the signed iPhone archive and the
   widget is embedded in the Watch app.
5. Install watchOS 10 or newer on a paired physical Apple Watch, or install a
   matching simulator runtime for development checks.

The Watch does not purchase a subscription itself. After the iPhone has a
claimed entitlement and an authenticated session, it sends the companion
session over WatchConnectivity. Validate:

- signed-in and signed-out companion-session changes;
- timer start, pause, resume, skip, and stop actions reaching terminal state;
- task completion synchronizing back to the phone;
- the WidgetKit complication reading and refreshing the shared app-group
  snapshot;
- unreachable-phone and API errors remaining visible instead of leaving stale
  optimistic state.

## 8. Landing page

Start from `packages/landing/.env.example` and configure real public URLs:

```dotenv
VITE_APP_STORE_URL=
VITE_PLAY_STORE_URL=
VITE_PRIVACY_URL=
VITE_TERMS_URL=
```

Build the static site with:

```bash
pnpm --filter @pomi/landing build
```

Deploy `packages/landing/dist` to the selected static host or CDN. Use HTTPS
and replace all placeholder links before announcing the hosted subscription
offering.

## 9. Release acceptance

Before store submission, verify all of the following with signed builds and
store sandbox accounts:

- the welcome, feature tour, payment, authentication, purchase claim, and app
  access sequence on a new hosted install;
- direct returning-user login and redirection to payment when entitlement is
  inactive;
- Google and Apple sign-in, sign-out, cancellation, and repeat sign-in on every
  supported native platform, including Sign in with Apple on macOS;
- monthly and yearly purchase, pending purchase, restore, claim retry, renewal,
  expiration, refund, revocation, and cross-account claim rejection;
- App Store Server Notification delivery to the public backend;
- foreground, background, and terminated-app APNs delivery on a physical
  iPhone;
- Watch installation, companion synchronization, timer/task controls, and
  complication refresh;
- self-host URL setup, authentication, and app access without a subscription;
- App Store, Play Store, privacy-policy, and terms links on the landing page.

A complete signed archive requires the Apple and Google accounts, store
records, signing certificates, provisioning profiles, APNs key, service-account
credentials, store sandbox testers, and a suitable physical device or installed
Watch runtime.
