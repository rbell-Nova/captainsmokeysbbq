# Captain Smokey's Crew Pass — Complete Handoff

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
- Checked-out branch: `feature/staff-check-in`
- Starting commit: `0e0c3df` (`Keep mock ticket preview available`)
- Current Crew Pass work is **uncommitted**.

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

Modified:

- `assets/event-ticketing/config.js`
- `assets/event-ticketing/repository.js`
- `backend/apps-script/Code.gs`
- `staff/assets/css/staff.css`
- `staff/assets/js/check-in-app.js`
- `staff/check-in/index.html`

Untracked:

- `tests/crew-pass.test.mjs`
- `CREW_PASS_HANDOFF.md`

Before this handoff document, the diff was approximately 684 insertions and
83 deletions across the six modified production files. Nothing has been
committed, pushed, deployed, or published.

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

1. Review the full Crew Pass diff and the Apps Script crypto helpers.
2. Decide whether to keep the jsDelivr QR dependency or vendor
   `qrcode-generator@1.4.4` locally. Local vendoring is preferred for event-day
   reliability and removes a runtime CDN dependency.
3. Improve manager-login error placement. At present the shared login error is
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

1. Recreate or recover `scripts/build-check-in.mjs`.
2. Re-add the safe Clear/Reset behavior and its race-condition tests.
3. Confirm guest tickets show first/last name plus adult/child/total counts.
4. Keep Apple/Google Wallet buttons disabled until real signed passes exist.
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
5. Vendor the QR encoder locally or explicitly document why the pinned CDN is
   acceptable.
6. Recreate the source-to-`out/` build script and port the missing September 22
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
