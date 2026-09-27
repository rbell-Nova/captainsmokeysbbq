# Captain Smokey's Crew Pass — Complete Handoff

> **Current status (2026-09-27): Google-only sign-in.** Crew Pass codes and
> the manager access key have been **removed**. The staff dashboard is opened
> only with Sign in with Google, for accounts listed in the Apps Script
> `MANAGER_EMAILS` property. See **section 13** — it supersedes the Crew Pass
> and access-key material in sections 1–12, which is kept as history.

## 1. Goal

Replace the awkward two-password staff experience with a free, low-friction
flow that uses the existing static website and Google Apps Script backend:

1. A manager enters the permanent backend `ACCESS_KEY` once.
2. The manager generates a temporary Crew Pass QR code and an eight-character
   fallback code.
3. Staff scan the QR or type the short code once.
4. Each device receives a signed, expiring device pass.
5. Staff enter their name for audit attribution and open the dashboard.
6. Returning staff go straight back in on that device.
7. The manager can revoke every staff device with one action.

No paid service was added. The design uses the existing static hosting,
Google Apps Script, Script Properties, browser storage, and a pinned free QR
encoder library.

## 2. Critical workspace information

Work only in this clean clone unless the user explicitly decides otherwise:

`captainsmokeysbbq-crew-pass` (the clean clone in the owner's iCloud Drive project folder)

Repository:

- Remote: `https://github.com/rbell-Nova/captainsmokeysbbq.git`
- Branch: `crew-pass-checkpoint` (created from `feature/staff-check-in`)
- Base commit: `0e0c3df` (`Keep mock ticket preview available`)
- Crew Pass work: **committed and pushed** (`afcf41f`…`c71d735`; see section 11)

Do not work from this older directory without first solving its iCloud problem:

`Website snapshot 3-3-2026/well-known` (the older working copy in the same iCloud Drive folder)

That directory and its nested `.git` contain `compressed,dataless` iCloud
placeholders. Direct reads time out, and `brctl download` reports that the
placeholder files do not exist in the provider. It also contained newer
uncommitted work, so it was deliberately left untouched. A clean clone was
created rather than overwriting it.

The disk initially had about 116 MB available. The user approved clearing the
re-creatable npm download cache (`npm cache clean --force`), which recovered
about 5 GB and made the clean clone possible.

## 3. Existing live services and accounts

- Public staff page: `https://www.captainsmokeysbbq.com/staff/check-in/`
- Registration page: `https://www.captainsmokeysbbq.com/register/`
- Apps Script backend deployment:
  `https://script.google.com/macros/s/AKfycbwXDJPz-qdkoCclQ3gHYAbbndD6SsPKIcje0HnAX0Rgyn4Oxx3e4KJTRU8Wm5T4j5cQ/exec`
- Apps Script project (**Smokey's Ticketing Backend**): link kept privately by the owner
- Google account that owns the Apps Script project: the owner's business Google account
- Bound spreadsheet name: `Captain Smokey's Event Tickets`
- Spreadsheet: bound to the Apps Script project (link kept privately)

The permanent manager key exists only as the Apps Script Script Property
`ACCESS_KEY`. Do not copy it into source, documentation, Git, URLs, or chat.
Retrieve it from Project Settings only when it is genuinely needed.

The production `/staff/` path also appeared to be protected by HostGator
Directory Privacy / HTTP Basic Auth. That creates a second login screen and
conflicts with the simplified design. The intended final state is to remove
that HostGator gate after Crew Pass is deployed and verified.

## 4. What has been implemented

### Backend: signed Crew Pass authentication

File: `backend/apps-script/Code.gs`

Added three API actions:

- `createCrewPass` — manager-key protected; creates a QR invite and fallback
  code valid for 20 minutes.
- `redeemCrewPass` — public endpoint that accepts the temporary invite/code
  and returns a signed device token.
- `revokeCrewPasses` — manager-key protected; increments a global generation
  number, immediately invalidating all existing device tokens and active
  invite codes.

Protected staff actions now accept either:

- the permanent manager `key`, or
- a valid signed `crewToken`.

Crew Pass state is stored in Apps Script Script Properties:

- `CREW_INVITE_HASH`
- `CREW_CODE_HASH`
- `CREW_INVITE_EXPIRES_AT`
- `CREW_SIGNING_SECRET`
- `CREW_TOKEN_GENERATION`

Only hashes of the temporary invite and fallback code are stored. The signing
secret is generated automatically inside Script Properties. Device tokens are
HMAC-SHA256 signed, include an expiry, include a random ID, and include the
current revocation generation.

Device expiry is the later of:

- event end plus six hours, or
- 12 hours from redemption.

The fallback code excludes confusing characters and is displayed as
`ABCD-EFGH`. It has roughly 40 bits of entropy. A newly generated manager code
replaces the prior active invite.

### Repository/auth transport

File: `assets/event-ticketing/repository.js`

- Requests now dynamically choose the manager key from `sessionStorage` or a
  Crew Pass device token from `localStorage`.
- The manager key takes priority when both exist.
- `redeemCrewPass` deliberately sends no existing auth credential.
- Added repository methods for create, redeem, and revoke.
- Added mock versions so the static mock mode retains the same interface.

Important existing architectural constraint: Apps Script requests remain GET
requests because Apps Script redirects POST requests and historically dropped
their body. This means credentials are sent to Google's endpoint as query
parameters during fetches. They are not put in the browser address bar or page
history, but this is still worth a security review if the architecture is
replaced later.

### Staff login and manager UI

Files:

- `staff/check-in/index.html`
- `staff/assets/js/check-in-app.js`
- `staff/assets/css/staff.css`

New staff flow:

- Default screen says **Join the Crew**.
- Staff scan a manager QR or type the short code.
- QR links use a URL fragment: `#crew=<temporary invite>`. Fragments are not
  sent to the static web host.
- JavaScript removes the fragment from the address bar before redeeming it.
- Successful redemption stores only the signed device token and its expiry.
- The next screen asks **Who are you?**.
- Staff name is audit attribution only and is remembered locally.
- Station/device entry was removed; the backend receives the fixed internal
  label `Staff Dashboard`.
- Returning devices validate the saved token and reopen automatically when a
  remembered staff name exists.
- **Switch Staff** returns to the name screen without logging the device out.
- **Forget this device** removes the device pass, manager session, and saved
  staff name.

Manager flow:

- A collapsed **Manager setup** section accepts the permanent access key.
- The key is held in `sessionStorage`, not persistent `localStorage`.
- Authenticated managers see a **Crew Pass** dashboard button.
- The manager modal can generate/regenerate the QR and short code, copy the
  join link, or revoke every crew device.
- QR generation happens in the browser using the pinned
  `qrcode-generator@1.4.4` script from jsDelivr. The invite is never sent to
  jsDelivr; only the library file is downloaded. For maximum event-day
  reliability, vendor this library locally before production.

The guest-ticket scanner was also corrected to extract the existing `?a=`
ticket token before falling back to the older path-style token format.

### Documentation/config comments

File: `assets/event-ticketing/config.js`

Updated comments so they no longer say staff store the permanent access key in
local storage.

## 5. Tests and verification already completed

New file: `tests/crew-pass.test.mjs`

Run:

```sh
node tests/crew-pass.test.mjs
node --check staff/assets/js/check-in-app.js
node --check assets/event-ticketing/repository.js
cp backend/apps-script/Code.gs /private/tmp/smokey-crew-pass-Code.js
node --check /private/tmp/smokey-crew-pass-Code.js
git diff --check
```

Current result: all commands pass; test output is `Crew Pass tests passed.`

The Node test verifies:

- QR invite and short-code issuance.
- Code normalization.
- Device-token signing and validation.
- Manager key and Crew Pass authorization routing.
- Tamper rejection.
- Expired invite rejection.
- Global revocation.
- Repository selection of `key` versus `crewToken`.
- Public redemption omitting existing credentials.
- Every JavaScript `el("...")` reference has a corresponding HTML ID.
- The permanent access key is not read from or written to `localStorage`.

Visual verification completed through a temporary local server:

- The Join the Crew screen rendered correctly.
- The short-code field, Manager setup disclosure, and manager key form were
  visually inspected.
- The temporary local server on port 4174 was stopped.

No live backend round trip was performed because the new `Code.gs` has not
been deployed to the live Apps Script project.

## 6. Current Git state

Superseded. Everything below was committed on `crew-pass-checkpoint`:

- `afcf41f`: Crew Pass sign-in, tests, and this doc
- `781b358`: Clear button, race guards, build script
- `66a5fb4`: Guest ticket counts and disabled Wallet buttons
- `c71d735`: Vendored QR library, local ticket QRs, auth hardening

The branch is pushed to `origin/crew-pass-checkpoint`. Nothing is deployed or
published.

## 7. Important newer work that is not in this clean clone

The broken iCloud working copy contained newer uncommitted September 22 work.
Before a production release, recover it or deliberately reimplement the parts
that still matter. Earlier inspection showed that version included:

- guest ticket adult/child/total counts and screenshot guidance;
- an Admin Login → Who are you? → Dashboard flow;
- fixed internal station attribution;
- a safe client-only Clear/Reset action with camera and pending-lookup
  cancellation;
- `?a=` QR-token parsing;
- clearly disabled/unavailable Wallet buttons rather than fake support;
- `scripts/build-check-in.mjs` to copy source into `out/`;
- broader check-in regression tests;
- `CHECK-IN-IMPLEMENTATION.md` and `CHECKIN_DESIGN_HANDOFF.md`.

This Crew Pass clone already reimplements the identity flow, fixed station
attribution, and `?a=` QR parsing. It does **not** yet deliberately port the
safe reset work, Wallet messaging, all ticket-display refinements, the prior
build script, or the full prior regression suite.

Do not assume the clean remote branch contains those later improvements.

## 8. Work still required before production

### A. Code review and hardening

1. ✅ Done (§11–12). Review the full Crew Pass diff and the Apps Script crypto helpers.
2. ✅ Done: vendored (§11). Decide whether to keep the jsDelivr QR dependency or vendor
   `qrcode-generator@1.4.4` locally. Local vendoring is preferred for event-day
   reliability and removes a runtime CDN dependency.
3. ✅ Done (§11). Improve manager-login error placement. At present the shared login error is
   rendered in the staff-code portion of the card even when a manager key
   fails.
4. Add rate limiting or temporary lockout if the short-code endpoint needs
   stronger brute-force protection. The current eight-character code has high
   entropy and a 20-minute window, but there is no request counter.
5. Add a browser integration test that covers QR redemption → name entry →
   dashboard → switch staff → return visit → revoke.
6. Test the layout at mobile widths and with a real phone camera.
7. Verify and update the hard-coded `EVENT` metadata in `Code.gs`; the remote
   branch currently contains a Fall Muster example event, dates, and venue.

### B. Reconcile the missing September 22 improvements

1. ✅ Done. Recreate or recover `scripts/build-check-in.mjs`.
2. ✅ Done. Re-add the safe Clear/Reset behavior and its race-condition tests.
3. ✅ Done. Confirm guest tickets show first/last name plus adult/child/total counts.
4. ✅ Done. Keep Apple/Google Wallet buttons disabled until real signed passes exist.
5. Copy required routes and shared assets into `out/` if `out/` remains the
   HostGator deployment source.

### C. Deploy the Apps Script backend

1. Sign into the Google account that owns the project.
2. Open **Smokey's Ticketing Backend** from Apps Script's project list.
3. Back up the current live `Code.gs`.
4. Replace it with the reviewed local `backend/apps-script/Code.gs`.
5. Save.
6. In **Deploy → Manage deployments**, edit the existing web-app deployment
   and select **New version**. Saving source alone does not update `/exec`.
7. Keep **Execute as: Me** and the existing public web-app access setting.
8. Do not change or expose the `ACCESS_KEY` Script Property.
9. Confirm the deployment URL remains the URL in `config.js`.

### D. Live end-to-end validation

Use an isolated/test event or sheet if possible, then verify:

1. Manager key opens the dashboard.
2. Manager generates a Crew Pass.
3. QR scan and fallback code both redeem from separate devices/browsers.
4. The URL fragment disappears immediately after opening.
5. Staff name is recorded on check-in activity.
6. Refresh/reopen keeps a crew device signed in.
7. Switch Staff changes attribution without re-authentication.
8. Tampered, expired, and revoked passes fail.
9. Revoke All signs out existing crew devices on their next request.
10. QR guest-ticket scanning and name lookup still work.
11. Duplicate check-ins remain blocked.

### E. Publish the static site

1. Determine whether HostGator deploys repository root or `out/`.
2. Build/copy the reviewed source accordingly.
3. Publish the staff route and shared assets.
4. Verify production asset paths, including the QR library strategy.
5. Only after Crew Pass works in production, remove HostGator Directory
   Privacy / Basic Auth from `/staff/` so users do not see two login gates.

Changing HostGator access controls and publishing production files are
external state changes. Confirm the exact deployment procedure and target
before doing either.

## 9. Recommended immediate next steps for the next agent

1. `cd` into `captainsmokeysbbq-crew-pass` (not the broken snapshot).
2. Read this file completely.
3. Run `git status --short`, `git diff --check`, and the test commands above.
4. Review `backend/apps-script/Code.gs`, especially Crew Pass functions and
   Apps Script compatibility.
5. ✅ Done. Vendor the QR encoder locally or explicitly document why the pinned CDN is
   acceptable.
6. ✅ Done (the build script has not been run into `out/`). Recreate the source-to-`out/` build script and port the missing September 22
   safe-reset/ticket refinements.
7. Add end-to-end browser tests in mock mode.
8. Stop before live deployment unless the user explicitly asks to publish and
   the HostGator workflow has been identified.

## 10. Product decisions already made

- Free implementation: yes, within existing Google Apps Script quotas.
- Permanent access key: manager-only.
- Staff authentication: temporary Crew Pass exchanged for a signed device
  token.
- Staff-facing fallback: eight-character code, not the permanent key.
- Invite window: 20 minutes.
- Device lifetime: through the event plus teardown time.
- Global emergency control: revoke all devices.
- Staff identity: attribution only, not a second authentication factor.
- Station/device field: removed from normal UI; fixed internal label used.
- HostGator Basic Auth: intended to be removed after successful deployment.
- Secrets in Git: prohibited.

## 11. Update — checkpoint and section 8B progress (2026-09-22 evening)

Branch `crew-pass-checkpoint` (from `feature/staff-check-in`), local only:

- `e990529` — Crew Pass checkpoint (everything in sections 4–6).
- Next commit — 8B items 1–2:
  - `scripts/build-check-in.mjs` rebuilt from scratch. It follows the three
    route HTML files' local references (including CSS `@import`) and copies
    only those files into `out/` (or `--out <dir>`). It adds `?v=<hash>` to
    local JS/CSS because `out/.htaccess` caches JS/CSS for a year as
    `immutable`. It is additive only (never deletes), and supports
    `--check` and `--dry-run`. It has **not** been run against `out/` yet.
  - Safe **Clear** button on the staff dashboard. It runs client-side only:
    it stops the camera, cancels debounced and in-flight manual lookups and
    QR lookups, and deselects the party. If notes are unsaved, it asks
    first. Switch Staff runs the same cleanup.
  - Race fixes: a camera stream that arrives after Stop/Clear is released
    (before this fix it stayed on); double-tapping Start opens one camera
    request; older lookup responses can't overwrite newer ones; lookup and
    scan failures show errors instead of unhandled rejections.

Run every test:

```sh
node --test tests/*.test.mjs
```

Open items found during review (not yet fixed):

- Public repo: private links, the account email, and local paths were
  removed from this file before pushing.
- `verifyCrewToken_` decodes unpadded base64. Confirm that Apps Script's
  `Utilities.base64DecodeWebSafe` accepts it, or re-pad before decoding.
- Clear the legacy `localStorage` `staffCheckIn.accessKey` on page load.
- Add an SRI hash to the jsDelivr QR script, or vendor it (8A.2).
- The tracked `out/` folder is stale: `out/index.html` predates the GA4
  commit, and `out/` has no staff/register/ticket routes. It also contains a
  65 MB `Archive.zip`. Confirm whether HostGator deploys from the repo root
  or from `out/` before running the build.
- `node_modules/` (114 files, including a macOS `sharp` binary) is tracked
  in Git.
- Guest ticket QR images come from `api.qrserver.com`, so every guest's
  ticket URL (including its `?a=` token) is sent to a third party. That's
  also a runtime dependency. Generate QRs locally instead (the same
  library as 8A.2).

8B.3–4 done in a follow-up commit: the ticket and register cards show
Adults / Children / Total tiles plus the donation line, the ticket page
tells guests to screenshot it, and the Wallet buttons ship disabled as
"coming soon" on both pages (previously `/register` had clickable
buttons that did nothing). Tests: `tests/ticket-card.test.mjs`. Only 8B.5
is left (running the build into `out/`), which is blocked on confirming
the HostGator deploy source.

### Hardening follow-up (8A items 2–3 plus review findings)

- The QR library is vendored at `assets/vendor/qrcode-generator-1.4.4/`
  (unmodified npm file; the hash is pinned in its README and checked in
  tests). The staff Crew Pass QR and the guest ticket QRs are now both
  drawn in the browser. `api.qrserver.com` and jsDelivr are gone, so ticket
  tokens no longer go to a third party. A rendered ticket QR was decoded
  and confirmed to contain the `/ticket/?a=` URL.
- `Code.gs`: crew tokens are re-padded before `base64DecodeWebSafe`. The
  test mock now behaves like a strict, padded Apps Script decoder, and the
  previous code fails under it. A wrong manager key now says "Invalid
  manager access key."
- Staff page: the old `staffCheckIn.accessKey` in `localStorage` is removed
  on load. Manager-login errors show under the manager key field, and
  network failures show a readable message.
- Still open from 8A: rate limiting on `redeemCrewPass` (A.4), a real
  browser end-to-end test (A.5), a real-phone camera test (A.6), and the
  `EVENT` metadata in `Code.gs` (A.7).

## 12. Known risks and gaps (review of `c71d735`)

Items 1–3 were **fixed on 2026-09-25** (commit after `c71d735`), with regression tests
in `tests/check-in-reset.test.mjs` that fail on the old code.

1. ✅ **Fixed.** **Stored XSS on the staff dashboard.** `renderSelected()` in
   `check-in-app.js` puts `checkedInBy` and `checkInStation` into `innerHTML`
   without escaping. `checkedInBy` is the free-text staff name any Crew Pass
   device can set. A crew member could enter markup as their name. It would
   then run on the manager's screen when the manager selects that guest, and
   the manager's `sessionStorage` holds the permanent key.
   `renderRegisterConfirmation()` has the same unescaped pattern for
   staff-typed names. Fix: pass these through `escapeHtml`, and add a test.
2. ✅ **Fixed.** **Switch Staff keeps the manager session.** `logoutBtn` only calls
   `showIdentityGate()`, so the next person on that device inherits manager
   controls: Crew Pass generate and revoke. This wasn't intentional. Fix: end
   the manager session on Switch Staff. Go to the name screen if the device
   has a crew token; otherwise go to the login screen.
3. ✅ **Fixed.** **Switch Staff discards unsaved notes without asking.** It runs
   `clearCheckInWork()` directly, while the Clear button confirms first. This
   wasn't intentional. Fix: route it through the same unsaved-notes check.

Other gaps:

4. **The `EVENT` metadata in `Code.gs` is still the example** (Fall Muster,
   2026-10-17). The real details weren't available, so it was left unchanged.
   Device-pass lifetime depends on it: passes issued now stay valid until
   2026-10-18 00:00 ET (event end plus 6 hours). That's weeks, not hours.
   Set real dates before issuing passes. Revoke All still works regardless.
5. **Credentials travel in GET query strings** to Apps Script (manager key or
   crew token). This is an architectural constraint, noted in section 4.
6. **Staff names are attribution only.** Any crew device can type any name.
   This is by design.
7. **Nothing has run on real Apps Script yet.** The base64 fix and the crew
   endpoints are tested only against a Node mock.
8. **`deploy/crew-pass-upload.zip`** (local, not committed) was rebuilt on
   2026-09-25 from the commit containing the fixes above. Earlier, it matched a build of `c71d735`. That includes the vendored QR at `?v=18ae399f81`
   and the hashed JS/CSS references. Rebuild it after any further code change. It's built from the repo root, not from
   `out/`.
9. The local branch `crew-pass-checkpoint-unredacted-backup` holds the
   pre-redaction history. **Never push it.**

## 13. Update — Google-only sign-in (2026-09-27)

Ryan decided that, for now, only he and Smokey Mike use the dashboard, so
Crew Pass and the access key were removed rather than kept as options.

What changed:

- **Staff page** (`staff/check-in/`): one sign-in card with the Google button
  and the Smokey icon. No crew code, no access-key form, no "Who are you?"
  step, no Crew Pass modal. **Switch Staff is now Sign Out**. It ends the
  session, clears the saved name, and turns off Google auto-select. Stale
  `accessKey` / `crewToken` storage from older builds is deleted on load. Old
  `#crew=` links just land on sign-in.
- **Name:** comes from the Google account (first name, then full name, then
  the part of the email before `@`). It is saved with the session and sent as
  `staffName` on check-ins.
- **Repository** (`repository.js`): only ever sends `managerToken`. The
  `redeemCrewPass`, `createCrewPass` and `revokeCrewPasses` methods are gone.
- **Backend** (`Code.gs`): `requireAccess_` accepts only a valid session
  token. The crew actions now return "Unknown action". `ACCESS_KEY` is never
  read, so the Script Property can be deleted. The HMAC key stays in the
  `CREW_SIGNING_SECRET` property, under its old name so live sessions survive.
  Delete that property to sign every device out.
- **Adding a person:** add their Gmail to `MANAGER_EMAILS`. While the OAuth app
  is in Testing, also add it under Google Auth Platform → Audience → Test
  users. Removing an email from `MANAGER_EMAILS` cuts that person off on their
  next request.
- **Favicons:** the root `favicon.ico` was the default Next.js triangle. It is
  now the Smokey icon. The home and 404 pages link the versioned Smokey icons
  like the other pages.
- **Tests:** `tests/crew-pass.test.mjs` became `tests/staff-auth.test.mjs`.
  `google-login` and `check-in-reset` were rewritten for Google-only. All
  pass.

Risks and notes:

- There is no break-glass login any more. If Google sign-in breaks on event
  day, the fix is in Apps Script: check `MANAGER_EMAILS`, check
  `GOOGLE_OAUTH_CLIENT_ID`, and check the OAuth test users.
- Section 12 items 4 and 6 still apply. `EVENT` is still example data.
  `staffName` is still client-supplied, now from Google.

