# PA02 implementation checkpoint / blocked native verification

Task: t_43c808d9, run11. Date: 2026-10-10+08:00. Owner Naya; implementation developer. This is a candidate implementation checkpoint, not phase-B QA acceptance, overall completion, installation or a release.

## Result

- Canonical central ownership now uses the actual `/api/studio/sessions/:id` DTO `session.user_id: string | null`. The real session repository normalizes its supported legacy numeric inputs/storage to strings; the isolated SQLite DTO test exercises both. Unknown, absent, mismatched owner/profile/session fails closed. No invented `created_by_user_id`, backend `task_id`, session migration or weakened ownership predicate. Optional `clientTaskId` is client-owned SessionTarget metadata only.
- Added authenticated, fixed-origin central login/state/history/submission/observer transport with projection v1 JSON Schema/OpenAPI. Local native bearer is independent and never forwarded to central. Safe bounded history/events omit workspace/config/credentials. Resume/reconnect/detach/close do not replay run, abort or file mutations. Socket.IO fixture is faithful local protocol verification, not a live Naya reply.
- Added personal renderer module/mode entry, all 11 locale messages, target-bound PA01 file UI, delete hash/target confirmation, restore, revoke and errors. Saved native mode works; explicit normal deep links remain authoritative; absent/disabled/incompatible module stays core-compatible. Disposed account controllers cannot revive from late network responses. Accessible labels now bind to the actual NaiveUI inputs, after native execution exposed the wrapper-label defect.
- Added isolated native `personal-entry`/restricted chooser preload and client-only gateway composition. Its public HTTP/renderer API cannot accept an absolute workspace root; a real native OS chooser and main-to-gateway IPC own onboarding. Reuses accepted PA01 public protocol/native ABI/receipts without PA01 reimplementation. Gateway graph contains no local Agent/Bridge/runtime bootstrap. Normal Desktop entry/package version remains unchanged.

## Real verification

62/62 scoped tests across 18 files passed. Machine-readable report: `dist/personal-lab/evidence/focused-tests.json`. Covers new controller/entry/mode/central/repository DTO/Socket.IO/onboarding/gateway/central-contract tests, existing client registry/login redirect, server registry/module/contracts/OpenAPI/boundary and Desktop identities.

Commands with exit 0:

- `npm run build` (OpenAPI generation, Vue typecheck, normal renderer build, server typecheck and server build).
- `node scripts/personal-lab-build.mjs --package` (gateway graph/build, personal renderer, `npm --prefix packages/desktop run build:main`, real electron-builder macOS arm64 ZIP, no publication).
- `npm run harness:check`.

The build retains baseline oversized-chunk warnings. Fixture negative registry tests deliberately log registration rejection; the existing login jsdom test logs its canvas warning. No unrelated full suite was run or repaired.

Native artifact:

`/Users/garbagod/projects/ekko-studio-personal-agent/dist/personal-lab/package/Ekko-Personal-Lab-0.7.31-personal.1-arm64.zip`

This is an unsigned/non-notarized macOS arm64 `.app` ZIP built from the isolated stage, not a signed installer or installed/physical-device acceptance. Normal application package defaults and official updater are unchanged. Digest/integrity/identity records belong to `dist/personal-lab/evidence/`; they identify the candidate bytes, not a release.

Verified latest ZIP: 127172060 bytes, 627 entries, `testzip()` passed. SHA-256 `014ae5a8d7a10f28f2060bbaffc62efebafd96a68b649f7036aea83b68de2689`. Its real Info.plist has bundle ID `com.ekko.personal-lab`, name `Ekko Personal Lab`, version `0.7.31-personal.1`. Reading the packaged ASAR confirms package `ekko-personal-lab`, version `0.7.31-personal.1`, main `dist/main/personal-entry.js`.

Final scoped source check: 46 changed paths, strict catalog valid with 5 entries and the accepted parent base `8e750592626c8698e6565c7be92a6bff91763eaf`; source boundary gate passed (124 whole-branch paths, 14 upstream-equal paths, 51 module sources). `git diff --check` and post-input-label `vue-tsc -b` passed. Exact candidate commit/remote SHA is recorded on the board, avoiding a self-referential commit hash in this tracked receipt.

## Native execution evidence and genuine blocker

Invocation: `PA02_NATIVE_E2E=1 node node_modules/@playwright/test/cli.js test --config=scripts/personal-lab-playwright.config.mjs`.

Playwright launched the actual packaged Electron entry and renderer, not an external browser. It reached the first-use chooser, personal view, honest unconfigured central/workspace state, desktop/compact rendering and explicit folder/capability modal. Saved real files:

- `dist/personal-lab/evidence/native-chooser-1440x1000.png`
- `dist/personal-lab/evidence/native-unconfigured-1440x1000.png`
- `dist/personal-lab/evidence/native-unconfigured-390x844.png`

The compact document had no horizontal overflow. Native E2E failed at the real OS chooser, so the file UI loop, hash-bound confirmation and restore screenshots are NOT verified. The harness only guides the real dialog's initial directory; it never replaces the dialog result or synthesizes root approval.

Bounded attempts:

1. Initial native execution caught a real NaiveUI wrapper-label issue; corrected the actual input props and rebuilt the package.
2. AX owner-name lookup failed with no window. One simplified exact-PID + named Lab OpenPanel/XPC lookup also failed: `Lab native chooser is not exposed through AX (-2700)`.
3. `hermes computer-use doctor` failed MCP initialize: daemon contract 0.8.0 does not match SDK 0.7.0. Native `computer_use list_apps` returned backend session setup failure.
4. One standard macOS launcher recovery used `open -g -n -a <exact Lab artifact> --env PERSONAL_LAB_CDP_PORT=4363`. The fixed-origin gateway health was real `personal-gateway`, `localAgent=false`, `localBridge=false`; its native CDP target was the exact local `personal.html` page. Fresh System Events lookup still reported Lab PID95360 with 0 AX windows. No blind keyboard/coordinate input or system permission click followed.

The session cannot verify native folder approval from this surface. Naya must expose the Lab in a usable interactive GUI session and coordinate the shared computer-use daemon/SDK alignment, or supply an approved manual native chooser verification. Do not replace this gate with a mocked chooser, fake file reply or browser demo. No global driver/profile/provider/config/memory/MCP change was made.

Cleanup: closed only the exact owned native CDP renderer at `http://127.0.0.1:4362/personal.html#/personal-agent`, which invoked the personal entry's normal window-close shutdown. Subsequent `lsof` readback showed no 4362 listener. No process belonging to the central/official application was stopped or restarted.

## Remaining dimensions and resume

- Live central: unverified and unoperated. Boss must authorize a dedicated non-current test session, intended account/profile and an approved masked credential path; the worker did not create/rename/delete/continue live sessions or alter memory. Never use the current production conversation as a fixture.
- Physical Windows/Linux/cross-host/network, signed/notarized installer and formal installation: unverified. Accepted PA01 same-machine scope remains accepted and unchanged.
- Independent QA/contrast/native acceptance: pending. No task completion or release approval follows this checkpoint. PA03 remains dependency-gated.
- Resume this same branch/worktree at the candidate commit recorded on the board; retain the generated package, scoped reports and actual screenshots. First re-verify single writer/remote SHA and a non-empty native capture, then run the existing opt-in native test with actual folder approval and receiver disk readback. No PA01 restart/reimplementation or production cutover is needed.
