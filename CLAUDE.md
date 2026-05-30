# Momentum — working notes for Claude

Expo / React Native / TypeScript, local-first habit app. The product turns a
big goal into 3 doable tasks/day with adaptive AI, plus journey/gamification.

## Release & build process (IMPORTANT)

**Build number — never set it manually; it auto-increments.**
`eas.json` has `cli.appVersionSource: "remote"` + `build.production.autoIncrement: true`,
so EAS increments the iOS build number (CFBundleVersion) **server-side on every
production build**. Do not hand-edit build numbers. (History: build 24 → 25 auto.)

**Marketing version — bump it ABOVE the highest version Apple has ever seen.**
The version (`app.config.ts` → `version`, CFBundleShortVersionString) is NOT
auto-incremented. Apple closes old version "trains" once a version is approved,
and rejects a build whose version isn't higher (errors 90062 / 90478 / 90186).
- When cutting a new release, set `version` higher than every version previously
  uploaded to App Store Connect (not just the current one).
- Current version: **1.0.2** (1.0.0 and 1.0.1 trains are closed).

**Build + submit (from `main`):**
```sh
# build (build number auto-increments)
npx eas-cli@latest build --platform ios --profile production --non-interactive --no-wait
# submit the finished build to TestFlight (ASC API key is stored on EAS servers)
npx eas-cli@latest submit --platform ios --profile production --id <BUILD_ID> --non-interactive
```
Note: the project-local eas-cli can hit a `yallist is not a constructor` error;
use `npx eas-cli@latest` to sidestep it. Always verify the new build number is
higher than the last after building.

## PR workflow (standing instruction)

For every code PR: run two reviewer subagents (one correctness/security, one
architecture/quality), fix all P1 and P2 findings (decline with a reason if a
finding is wrong), leave P3 for later, verify (tsc + tests + lint), then merge
and notify. Trivial config/doc one-liners may skip the two-agent review.

## AI proxy

The app never holds an API key. AI goes through `server/momentum-proxy.mjs`
(provider-agnostic; switch with `MOMENTUM_AI_PROVIDER=openai|anthropic`).
- Deployed on Render (`render.yaml`), URL baked into the production build via
  `eas.json` `build.production.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL`.
- Local dev: put secrets in gitignored `.env.local`; `pnpm ai:proxy` auto-loads it.
- No proxy URL configured → app silently uses the local template plan.

## Checks

```sh
npx tsc --noEmit        # typecheck
npx vitest run          # tests
npx eslint <files>      # lint
```
