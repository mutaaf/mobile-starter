# Building installable apps

Two routes: locally (free, no account) or through EAS Build (cloud, handles
signing). What you can produce depends on which platform and whether you have an
Apple Developer account.

| Artifact | Installs on | Needs | Route |
|---|---|---|---|
| **APK** | Any Android phone, sideloaded | nothing | local or EAS |
| **AAB** | Play Store upload | Play console | EAS `production` |
| **iOS simulator `.app`** | macOS simulators only | nothing | local or EAS `preview:simulator` |
| **IPA (ad-hoc)** | Registered devices only | Apple Developer account, $99/yr | EAS `preview` |
| **IPA (App Store)** | TestFlight / App Store | Apple Developer account | EAS `production` |

**There is no way to produce a device-installable IPA without an Apple Developer
account.** Apple requires a signing certificate and a provisioning profile tied to
a paid team. Unsigned IPAs will not launch on a stock iPhone. If you only need to
demo on a Mac, the simulator build is free and immediate.

## Local Android APK — no account required

```bash
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`. Expo's
template signs the release variant with the bundled debug keystore, so it installs
on any device with "install unknown apps" enabled. That keystore is **not**
suitable for the Play Store — generate a real upload key before publishing.

Transfer it by `adb install app-release.apk`, or just send the file.

## Local iOS simulator build

```bash
npm run ios
```

The `.app` bundle is under
`~/Library/Developer/Xcode/DerivedData/<project>/Build/Products/Debug-iphonesimulator/`.
Drag it onto a running simulator to install, or
`xcrun simctl install booted <path>.app`.

## EAS Build — both platforms, cloud-signed

```bash
npm install -g eas-cli
eas login
eas build:configure

eas build -p android --profile preview   # → downloadable APK
eas build -p ios --profile preview       # → ad-hoc IPA (needs Apple account)
```

`eas.json` in this repo already defines the profiles:

- **development** — dev client, for daily work against Metro.
- **preview** — internal distribution. Android APK; iOS ad-hoc IPA.
- **preview:simulator** — same, but an iOS simulator build needing no account.
- **production** — Android App Bundle and a store-signed IPA.

EAS prompts to generate and store credentials the first time. For iOS it needs
your Apple ID and will register the target devices for ad-hoc distribution.

## Over-the-air updates

Once a build is installed, JS-only changes ship without a new binary:

```bash
eas update --channel preview -m "fix seismic sort order"
```

The `preview` and `production` profiles are already bound to matching channels.
Native changes — a new dependency with native code, a permission, an app icon —
always require a rebuild.
