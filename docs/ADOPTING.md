# Adopting this kit

Three ways in, depending on where you're starting. All of them end with
`npm run verify` passing and a Maestro flow you can run on a real device.

## 1. New mobile app

```bash
npx degit mutaaf/mobile-starter my-app
cd my-app && npm install
npm run verify        # confirm the kit is green before you change anything
npm run ios           # or: npm run android
```

Then rename the app: `app.json` → `name`, `slug`, `scheme`,
`ios.bundleIdentifier`, `android.package`. Update `appId` in `.maestro/*.yaml` to
match the new bundle identifier, or the E2E flows will launch nothing.

## 2. Existing web project, adding mobile

Keep the web app where it is and add a sibling. Do **not** try to make one
codebase render both — share logic, not components.

```
repo/
  web/                 # your existing app, untouched
  mobile/              # npx degit mutaaf/mobile-starter mobile
  packages/core/       # the shared layer you extract into
```

Move into `packages/core` only what is platform-free: domain types, validation
schemas, API clients, pure business logic, formatting, constants. Everything that
touches the DOM, CSS, `window`, or routing stays behind.

Wire it up with a workspace, then in `mobile/`:

```bash
npx expo install @your-scope/core
```

Metro resolves workspace packages, but they must ship untranspiled-safe source or
a React Native-compatible build — Metro does not read `browser` fields the way
webpack does. If a shared package pulls in a Node builtin, that's a signal it
isn't platform-free and belongs on the web side.

## 3. Existing React Native app, adopting the conventions

You want the testing setup and the invariants, not the scaffold. Copy:

- `AGENTS.md` — the contract, and the reason each invariant exists
- the `jest` block in `package.json` (especially `resolver` and `moduleNameMapper`)
- `jest-setup.ts`, `__mocks__/style-mock.js`, `types/css.d.ts`
- `.maestro/` and the `e2e:*` / `verify` scripts
- `.github/workflows/ci.yml`

Then run `npm run verify` and fix what falls out.

## What actually transfers from a web app

| Web | Mobile | Notes |
|---|---|---|
| Business logic, types, validation | ✅ as-is | The real prize. Extract these first. |
| `fetch`, API clients | ✅ as-is | Available in RN. |
| React state, context, reducers | ✅ as-is | Hooks work identically. |
| TanStack Query, Zustand, Redux | ✅ as-is | Platform-agnostic. |
| Zod / valibot schemas | ✅ as-is | |
| `<div>` / `<span>` / `<p>` | `<View>` / `<Text>` | All text must be inside `<Text>`. |
| `onClick` | `onPress` | On `Pressable` / `TouchableOpacity`. |
| CSS / Tailwind classes | `StyleSheet.create` | No cascade, no inheritance except within `<Text>`. |
| CSS units (`px`, `rem`, `%`) | unitless numbers | Density-independent pixels. `%` works only in some props. |
| `display: flex` | default | Every `View` is flex, and `flexDirection` defaults to `column`, not `row`. |
| `position: fixed` | ❌ | Use absolute positioning inside a fixed-height container. |
| `react-router` / Next routing | `expo-router` | File-based, already set up in `src/app/`. |
| `localStorage` | `expo-secure-store` / MMKV / AsyncStorage | Async. Secure-store for tokens. |
| `window`, `document`, DOM APIs | ❌ | No DOM. Guard any shared code that touches them. |
| `<img>` | `expo-image` | Already a dependency. |
| `<input>` | `<TextInput>` | Different keyboard/focus semantics. |
| Media queries | `useWindowDimensions` | Plus `Platform.select` for platform splits. |
| Web fonts via CSS | `expo-font` | |
| Service workers, PWA | ❌ | Use EAS Update for over-the-air JS updates. |

The honest summary: **your logic ports, your view layer does not.** Budget for
rewriting every component's markup and styling, and for keeping the two view
layers in sync afterwards.

## Pointing an agent at this kit

An agent in another repo can consume the contract directly:

```
https://raw.githubusercontent.com/mutaaf/mobile-starter/main/AGENTS.md
```

For a durable setup, vendor it rather than fetching every time — add to the
project's own `AGENTS.md` / `CLAUDE.md`:

```markdown
## Mobile

The mobile app in `mobile/` follows the mobile-starter kit. Its conventions and
invariants are in `mobile/AGENTS.md` — read that file before changing anything
under `mobile/`, and treat its "Invariants" section as binding.
```

Nested `AGENTS.md` files are picked up automatically by most coding agents when
work happens in that subtree, so `mobile/AGENTS.md` will apply on its own once the
directory exists.

## What this kit does not give you

Stated plainly so you can plan around it:

- **No app store pipeline.** No EAS config, signing, provisioning, or submission.
  Add `eas.json` when you're ready to ship.
- **No auth, no navigation guards, no data layer.** Deliberately — those are
  product decisions.
- **The E2E suite is one smoke flow.** It proves the harness works end to end; it
  is not coverage. Add a flow per critical user path.
- **CI runs on emulators and simulators only.** No real-device farm. Maestro Cloud
  or a device lab covers the gap between simulator and hardware.
