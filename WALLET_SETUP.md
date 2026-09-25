# Apple and Google Wallet setup

## Status (2026-09-25)

| Part | State |
|---|---|
| Pass service `wallet/index.php` + `wallet/lib.php` | Written and tested (`php tests/wallet.test.php`, 24 tests) against throwaway certificates and a mocked Google API. **Not deployed; not tested against real Apple/Google accounts.** |
| Apple account | Pass Type ID, Team ID and certificate **not created yet** |
| Google account | Merchant profile exists. The merchant ID (`BCR2…`) is **not** the Wallet issuer ID. Wallet issuer onboarding, issuer ID, API enablement and service account are **not done yet** |
| Web pages | Wallet buttons still ship disabled ("coming soon"); not wired to the service yet |
| HostGator | PHP version and the openssl / curl / zip extensions **not confirmed yet** |
| Event details | `Code.gs` still has the example event. The service refuses to issue passes until `event_confirmed` is true and `event_id` matches `getEvent` |

## How the service works

- `GET /wallet/?action=status` returns `{apple, google}` readiness booleans.
  Pages use it to decide whether to show each button.
- `GET /wallet/?action=apple&token=tk_…` returns a signed `.pkpass`
  (`application/vnd.apple.pkpass`). Errors on this path show a small HTML page
  with a link back to the ticket.
- `POST /wallet/` `{"provider":"google","token":"tk_…"}` returns
  `{"url":"https://pay.google.com/gp/v/save/…"}`.
- Every request re-reads the ticket and event from Apps Script
  (`getGuestTicket`, `getEvent`). Names and counts from the browser are never
  trusted. Only `ready` and `checked-in` tickets get passes. A checked-in
  ticket shows as COMPLETED in Google Wallet.
- The pass QR is the same `https://www.captainsmokeysbbq.com/ticket/?a=…` URL
  the staff scanner already reads.
- Private config, keys and certificates are refused if they're inside
  `public_html`. There's a per-client rate limit (20 pass requests per 10
  minutes; it stores hashed addresses only). PHP warnings are never printed
  into responses.

## Private config (outside `public_html`)

Copy `backend/wallet/config.example.php` to
`/home/<cpanel-user>/smokeys-wallet/config.php`. Put the certificate, key and
service-account files in the same folder with owner-only permissions (0600
files, 0700 folder). Never commit them, email them, or paste them into chat.

## Apple Wallet steps

1. Apple Developer → Identifiers → **Pass Type IDs**: register
   `pass.com.captainsmokeysbbq.event`.
2. Create the Pass Type ID certificate from a certificate signing request that
   you generate yourself, so the private key never leaves your machine. Record
   the **Team ID** (shown on the certificate's OU).
3. Download Apple's WWDR intermediate certificate (G4) and convert the files to
   PEM for the config.
4. Test on an iPhone: add the pass, then scan it with the staff scanner.

## Google Wallet steps

1. In the Pay & Wallet Console → **Google Wallet API**, finish issuer
   onboarding and record the **numeric issuer ID**. This is different from the
   merchant ID.
2. In Google Cloud: enable the **Google Wallet API**, create a service account
   and a JSON key, then add the service account's email to the issuer with
   **Developer** access.
3. Add test accounts while in demo mode. Request publishing access before
   guests can use it.

## Before turning it on

- Confirm the real event in `Code.gs`, then set `event_id` and
  `event_confirmed => true`.
- Confirm HostGator has PHP 8.1+ with `openssl`, `curl` and `zip`.
- Wire the buttons on the register confirmation and ticket pages to
  `?action=status`, using the official Apple and Google badges. Keep the
  QR/screenshot fallback.
- Test a real save on both platforms and scan the saved QR at check-in before
  setting `enabled => true`.

Docs: [Apple identifiers & certificates](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates) ·
[Apple pass structure](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html) ·
[Google issuer onboarding](https://developers.google.com/wallet/generic/getting-started/issuer-onboarding) ·
[Google service account auth](https://developers.google.com/wallet/generic/getting-started/auth/rest) ·
[Google event tickets](https://developers.google.com/wallet/tickets/events/use-cases/jwt)
