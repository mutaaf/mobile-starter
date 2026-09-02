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

## Architecture

Data flows one way, and every layer depends on an interface rather than a concrete
implementation:

```
screen  →  useResource(key, fetcher)     // subscribes, never fetches
           ↓
       ResourceCache                     // lifecycle, dedup, SWR, events
           ↓
        CacheStore  (interface)
           ↓
     TieredStore → MemoryStore + AsyncStorageStore
```

- **Screens never fetch.** They call `useResource` with a key from `CacheKeys`
  and render the returned state. A screen that calls `fetch` directly bypasses
  dedup, caching and the devtools, and is a bug.
- **The cache is injected**, via `<CacheProvider>` and `useCache()` — not imported
  as a module singleton. Tests mount a `MemoryStore`-backed instance.
- **Stores are swappable.** `CacheStore` is five methods; swapping AsyncStorage
  for MMKV touches one file.
- **Adding a data source** means: add a fetcher to `src/lib/api.ts`, add a key to
  `CacheKeys`, call `useResource`. Nothing else.

Six screens ship. Five run against four keyless public APIs: ISS position
(wheretheiss.at), earthquakes (USGS), geomagnetic Kp (NOAA SWPC) and the launch
manifest (Launch Library 2). Each demonstrates a different interaction — live
polling, a long list, a scrubbable chart, live countdowns — plus on-device
sensors and gestures on the Motion tab.

The sixth, **Brief**, is bring-your-own-key. `LlmProvider` (`src/lib/llm/types.ts`)
is the abstraction; Anthropic, OpenAI and Gemini are three implementations over
plain `fetch` — no vendor SDKs in the bundle, and one place to normalise errors
and usage. It reads the four feeds straight out of the cache, adds the handset's
tilt and clock, and asks the user's chosen model for one fused situational
briefing, so it costs no network calls of its own.

`ResourceCache` owns entry lifecycle, single-flight dedup, stale-while-revalidate,
pinned overrides, an event log and stats. It knows nothing about what it caches.

## The devtools overlay

A draggable badge (bottom-right) expands into an inspector with four tabs: live
cache entries with per-key invalidate/release/evict, a cache event timeline,
UI-thread and JS-thread FPS meters with hit-rate stats, and network injection
(force offline, fail-next, latency).

Injection goes through `cache.setPolicy()`, so it applies to every screen at once
and no call site knows it exists. Use it to check loading and error states without
unplugging anything.

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
The React Compiler lint rule rejects it. To mirror an external source, subscribe
with `useSyncExternalStore` instead — see `src/hooks/use-resource.ts`. Where an
effect legitimately kicks off async work, disable the rule on that line with a
reason; note that `eslint-disable-next-line` must be the *last* line before its
target, so put the explanation above it.

**8. `cache.getState()` must return a referentially stable object.**
`useResource` reads it through `useSyncExternalStore`, which re-renders forever if
`getSnapshot` allocates a new object each call. The empty state is a frozen
singleton for exactly this reason.

**9. AsyncStorage needs its Jest mock, registered in `jest-setup.ts`.**
It is a native module with no Node implementation. Symptom if removed: every
suite that transitively imports the cache dies with
`NativeModule: AsyncStorage is null`.

**10. Mutate cache policy through `setPolicy()`, never the object.**
The React Compiler's `react-hooks/immutability` rule rejects assigning to a value
captured in a handler, and direct mutation would not notify subscribers.

**11. Animate on the UI thread.**
Use Reanimated shared values and worklets, not `setState` per frame. High-frequency
sources (sensors, countdowns) must never round-trip through React — the countdown
timers drive a `TextInput`'s `text` prop through `useAnimatedProps` precisely so
twenty live timers cost no renders.

**12. A helper called from a worklet must itself be a worklet.**
Declaring one *inside* a worklet does not make it one; it stays a JS function and
the UI runtime throws `Tried to synchronously call a Remote Function`. Hoist it to
module scope with a `'worklet'` directive (see `pad` in `src/app/launch.tsx`).

**13. Start animations in effects, never in `useMemo`.**
Starting one is a side effect, and React may skip or re-run a memo body —
especially with the React Compiler enabled. Getting this wrong silently left the
starfield frozen.

**14. `useFrameCallback` is not a vsync frame counter.**
It was measured firing ~8x/sec while `adb shell dumpsys gfxinfo` reported a 28ms
median frame (~35fps), so it cannot back an FPS meter. The devtools badge shows
**JS-thread** fps (rAF-based, honest); the worklet tick rate is labelled as such.
For real render statistics use `adb shell dumpsys gfxinfo <package>`.

**15. API keys go in the device keystore, never in the cache.**
`expo-secure-store` only (Keychain / EncryptedSharedPreferences). The resource
cache persists to AsyncStorage in plain text and its contents are dumped by the
devtools panel — a key there would be readable. Keys are never logged, never
rendered beyond `maskKey`, and never interpolated into a URL (URLs reach logs and
crash reports; headers do not).

**16. Bind pull-to-refresh to user intent, not to `status`.**
`status === 'revalidating'` is true for background polls too, which makes the
spinner flash on every tick. `refresh()` is awaitable — drive a local `pulling`
state from it.

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
