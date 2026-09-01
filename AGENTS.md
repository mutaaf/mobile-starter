# Agent contract — mobile-starter

This file is the operating manual for any agent working in this repo, **or in a
project that adopted this kit**. It is self-contained: an agent elsewhere can read
this file alone and apply the same conventions.

Canonical copy:
<https://raw.githubusercontent.com/mutaaf/mobile-starter/main/AGENTS.md>

## What this is

A React Native app on **Expo SDK 57** (RN 0.86, React 19), with unit tests, E2E
tests, typechecking and linting that are all verified green on a real iOS
simulator and a real Android emulator.

Expo changes fast and its APIs are version-specific. Before writing code against
an Expo API, read the **versioned** docs for this exact SDK:
<https://docs.expo.dev/versions/v57.0.0/>. Do not rely on memory of older SDKs.

## Commands

These are the contract. Prefer them over ad-hoc invocations.

```bash
npm run verify        # typecheck + lint + unit tests — run this before claiming done
npm test              # unit tests only
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint

npm start             # Metro dev server
npm run ios           # build + install + launch on iOS simulator
npm run android       # build + install + launch on Android emulator

npm run e2e:ios       # Maestro flows against a running iOS simulator
npm run e2e:android   # Maestro flows against a running Android emulator
```

`npm run verify` is the gate. E2E needs a booted device with the app already
installed, so it is deliberately not part of `verify` — run it explicitly after
`npm run ios` / `npm run android`.

## Invariants — do not break these

Each of these cost real debugging time. The symptom is listed so you can
recognise a regression instead of re-deriving the cause.

**1. `render` from React Native Testing Library is async.**
RNTL v14 renders through React 19's concurrent root.

```tsx
await render(<HomeScreen />);          // correct
expect(screen.getByText('...')).toBeOnTheScreen();
```

Symptom if you forget `await`: every query throws
``` `render` function has not been called ```, which reads like a setup problem
but is not. Matchers are registered automatically in v13+ — there is no
`extend-expect` import.

**2. Jest needs `resolver: "react-native-worklets/jest/resolver.js"`.**
Reanimated 4 pulls in `react-native-worklets`, whose `.native` entry point calls
into a native module that does not exist under Node. The shipped resolver steers
resolution to the non-native build.
Symptom if removed: `TypeError: Cannot read properties of undefined (reading 'loadUnpackers')`.

**3. `moduleNameMapper` must mirror the `tsconfig.json` path aliases.**
Jest does not read `tsconfig` paths. `@/*` → `src/*` and `@/assets/*` → `assets/*`
are declared in both places and must stay in sync.
Symptom if they drift: `Could not locate module @/... mapped as ...`.

**4. `.css` imports need both a Jest stub and an ambient declaration.**
The template imports CSS for web builds. `__mocks__/style-mock.js` handles Jest;
`types/css.d.ts` handles TypeScript.
Symptom: `SyntaxError: Unexpected token ':'` in Jest, or TS2307 in typecheck.

**5. Unit tests live in `__tests__/`, never under `src/app/`.**
`src/app/` is expo-router's route directory — files there become routes.

**6. Assert on `testID` in Maestro whenever an element contains an icon.**
iOS folds a child SF Symbol's name into the parent's accessibility label. The
docs link is `"Expo documentation, arrow.up.right.square"` on iOS but plain
`"Expo documentation"` on Android, so a text assertion passes on one platform and
fails on the other. `testID` maps to `accessibilityIdentifier` (iOS) and
`resource-id` (Android) and matches identically.
Inspect what the runner actually sees with `maestro hierarchy`.

**7. Do not call `setState` synchronously inside an effect.**
The React Compiler lint rule rejects it. For a hydration flag use
`useSyncExternalStore` (see `src/hooks/use-color-scheme.web.ts`).

## Native projects are generated

`ios/` and `android/` are produced by `expo prebuild` (Continuous Native
Generation) and are **gitignored**. Never hand-edit them — the edit is lost on the
next prebuild.

Express native configuration through `app.json` plugins instead. To add a
dependency with native code:

```bash
npx expo install <package>     # not `npm install` — this picks the SDK-compatible version
npx expo prebuild --clean      # regenerate ios/ and android/
npm run ios                    # rebuild; JS-only changes never need this
```

## Conventions

- **Layout**: routes in `src/app/`, shared UI in `src/components/`, hooks in
  `src/hooks/`, design tokens in `src/constants/theme.ts`.
- **Imports**: use the `@/` alias, not deep relative paths.
- **TypeScript**: `strict` is on. Do not add `any` to silence an error.
- **Platform code**: prefer `Platform.select` over branching files; when a file
  must differ, use the `.ios.tsx` / `.android.tsx` / `.web.tsx` suffix.
- **Tests**: one behaviour per `it`. Query by what a user perceives (text, a11y
  role) rather than implementation details — except where invariant 6 applies.

## Debugging

- **React Native DevTools** is the debugger: `j` in the Metro terminal, or `cmd+d`
  (iOS sim) / `cmd+m` (Android emulator) → Open Debugger.
- **Flipper is dead.** Do not install or suggest it.
- Bundle size: `npx expo-atlas`.

## Environment notes

Machine-specific setup that is not derivable from this repo:

- **iOS**: if `xcode-select -p` points at `CommandLineTools`, export
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per command rather
  than requiring `sudo xcode-select -s`.
- **iOS runtimes**: a newly downloaded simulator runtime must appear in
  `xcrun simctl list runtimes`. An entry that shows `Ready` in
  `xcrun simctl runtime list` but never mounts under
  `/Library/Developer/CoreSimulator/Volumes/` is unusable, and Xcode reports it as
  `iOS <version> is not installed`. Never `simctl runtime delete` a duplicate —
  duplicates share a backing image, so deleting one destroys both.
- **Android**: `$ANDROID_HOME/platform-tools` must precede Homebrew on `PATH`, or
  a stale Homebrew `adb` shadows the SDK one and version-mismatches the emulator.

## Definition of done

1. `npm run verify` passes.
2. If the change touches UI or navigation, the Maestro flow passes on at least one
   platform — both if the change is platform-sensitive.
3. If the change touches a documented invariant above, this file is updated too.

Do not report work as complete on the strength of a build succeeding. Build
wrappers can exit 0 while the underlying `xcodebuild`/Gradle invocation failed —
check for `BUILD SUCCEEDED` / `BUILD SUCCESSFUL` in the output, and confirm the
app actually installed and rendered.
