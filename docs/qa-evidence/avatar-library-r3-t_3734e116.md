# Independent QA report — Avatar library r3

Task: `t_3734e116`
Verdict: **FAIL for full acceptance; staged implementation checks PASS, live acceptance NOT TESTED/BLOCKED.**
Tested source commit: `c62c8363684f0b76f61d883be7dad90ebc0ada6b` on `origin/wt/t_81294fb5`; independent `git ls-remote` readback matched exactly. QA worktree was advanced fast-forward to this commit; no production source edits were made.
Local build server artifact SHA-256: `50e10bdb684104d3a6faa9f5413def69064edd9a18e2a9de18ca62feec25f3be`.

## Evidence and results

- **PASS — supplied R3 assets / source manifest agreement.** Independent check of all 50 source and packaged WebPs against `/Users/garbagod/.hermes/assets/ipaslogo/library-r3/manifest.json`: 50 entries/files, 50 unique SHA-256s, client/server hash maps matched, all decoded as 128×128 WebP, source and packaged raw decoded pixels matched for all 50. Packaged total 475126 bytes; min 4922, max 14782; zero mismatches. Repro: `node scripts/qa/check-avatar-library-r3.mjs` (QA-only checker; not product runtime).
- **PASS — focused tests.** `npm exec vitest -- run tests/client/avatar-library.test.ts tests/client/profile-avatar-library.test.ts tests/server/avatar-library.test.ts tests/server/group-chat-avatar-only.test.ts tests/server/profiles-routes.test.ts` — 5 files, 45/45 tests passed.
- **PASS — harness.** `npm run harness:check` — exit 0; harness and Ekko public API documentation checks passed.
- **PASS — full build.** `npm run build` — exit 0, including OpenAPI generation, Vue/TypeScript checks, Vite client build, server typecheck, and server bundle. Independently built `dist/server/index.js` hash matches the engineering-reported/candidate hash above.
- **PASS — source hygiene / target identity.** `node --check scripts/migrate-avatar-library-r3.mjs`; `git diff --check HEAD^ HEAD`; exact engineering remote SHA readback. Focused server tests exercise library whitelist checks, authorized avatar-only room write, denial for non-owner/invalid avatar, persisted avatar-only field behavior, and member avatar CAS.
- **NOT TESTED — live browser/account/profile/room behavior, screenshots, cold-start request set, random request timing, repeat browser cache hit, upload/reset and actual profile list payload byte comparison.** No restart or live deployment was made (explicitly out of scope in this QA session); the currently serving service is not this tested artifact. The supplied 6,912,128-byte old payload remains historical context, not a fresh baseline.
- **NOT TESTED — actual migration / rollback.** The migration CLI was syntax-checked, not executed against authorized service data. No account/profile/room writes occurred in QA. Candidate build is staged only.
- **FAIL — zero-old-avatar / complete identity acceptance.** The staged change catalog itself explicitly leaves SOUL visual blocks and Naya index unchanged, historical/removed room-member snapshots unaudited, and live migration unrun. Thus the requirement to replace all active references and prove no old large avatar payload remains is not met; do not certify this artifact for release or claim complete migration.
- **NOT TESTED — source license/extra terms beyond recorded notice.** The manifest records the site notice “網站標示：可免費下載並免費商用。” The change catalog records `/terms` returned 404 and no definitive complete license/terms were verified. This report makes no broader rights claim.

## Immutable candidate artifact (platform handoff; not release acceptance)

Platform provided the read-only candidate tree `/Users/garbagod/.hermes/profiles/platform-engineer/cache/scratch/t_28fcf0a7/prepared-1791623418005762000/candidate-dist`, containing 665 files / 106383863 bytes. QA independently re-hashed all 665 files against `candidateHashes` in `/Users/garbagod/.hermes/profiles/platform-engineer/cache/scratch/t_28fcf0a7/prepared-1791623418005762000/preparation.json` (SHA-256 `cb5b016a0f72d2f7e33f0f9308db29c5433862764065e00ac512236ea5789b78`); 665/665 matched, and embedded source/remote SHA both matched the tested commit. Candidate server bundle hash matches the independent local build. Repro: `node scripts/qa/check-avatar-library-r3.mjs`.

## Runtime / deployment boundary

Platform's latest handoff reports runtime snapshot timestamp `1791623459035` with `running=1` and `worker=1`; this was not independently probed by QA, and it is not a quiet gate. No live operation was executed. Earlier platform notes reported source PID 87890, working tree `/Users/garbagod/projects/hermes-studio`, serving `dist/server/index.js`, data home `~/.hermes-web-ui-source`, and Bridge PID 88088; these remain platform observations, not a QA live probe. No live process/data mutation or activation occurred; deployment status is **staged, not deployed**. Accordingly no live service URL is certified for this revision. Share code `9WTPLEDTKGSLBG6H` was resolved upstream to room `muzvuy30vy9c4k`; current account, profile roster and room member data were not independently re-read by QA.

## Overall disposition

The artifact passes the independent asset integrity, focused test, harness, build and full candidate-tree hash checks at the exact pushed source SHA. It **fails full acceptance** because mandatory zero-old-reference/SOUL-index/migration criteria remain incomplete, and real UI/network/cache/payload behavior remains untested on a deployed candidate. The orchestrator has routed bounded remaining migration/SOUL work to a separate sole-writer continuation and created a separate exact-SHA verifier plus a later live QA lane; this staged verdict is not a substitute for that final live QA. Do not promote or claim live acceptance based on these staged checks.