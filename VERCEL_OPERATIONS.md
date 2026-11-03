# Captain Smokey's BBQ — Vercel operations

This repository builds a deliberately allowlisted static deployment in `dist/`. The build includes the public homepage, menu PDF, `/register`, `/ticket`, and `/staff/check-in`, but it does not publish the dormant PHP wallet service, Apps Script backend source, tests, archived builds, or repository notes.

## Vercel project settings

- Framework preset: Other
- Install command: leave empty
- Build command: `node scripts/build-vercel.mjs`
- Output directory: `dist`
- Node.js: 20 or later
- Production branch: `crew-pass-checkpoint`
- Preview deployments: Vercel Authentication (Standard Protection) enabled
- Production deployment: public, then restricted by the US-only firewall rule below

Do not add wallet secrets or Google service credentials to Vercel. The wallet implementation is intentionally inactive, and the event backend remains the separately deployed Google Apps Script endpoint already referenced by the site.

## US-only firewall rule

Create one Vercel WAF custom rule at the project level:

- Name: `us-only-public-access`
- If: trusted request field **Country** does not equal `US`
- Then: **Deny**
- Duration: no temporary expiration
- Order: first among custom rules unless a documented emergency rule must precede it

Start the rule in **Log** mode. From a US connection, verify the homepage, menu PDF, booking form UI, `/register`, `/ticket`, and `/staff/check-in`. Then inspect firewall events to confirm requests carry the trusted country value. Before switching to **Deny**, verify how Vercel classifies requests whose country is unavailable; if `Country != US` does not match an unavailable value, add a separate deny condition for an unavailable country rather than allowing it. Finally switch the rule to **Deny** and run one US and one non-US probe. Do not create country bypasses for assets, APIs, alternate hostnames, or preview URLs.

Vercel Authentication on previews is defense in depth. The project WAF rule must still cover every production and preview hostname so an alternate Vercel URL cannot bypass the restriction.

## Domain cutover

1. Add both `captainsmokeysbbq.com` and `www.captainsmokeysbbq.com` to the Vercel project.
2. Choose the apex as the canonical production domain and configure `www` to redirect to it in Vercel Domains.
3. Review the Vercel preview before changing DNS. Test one narrow phone viewport, one standard phone, tablet, laptop, and desktop; portrait and landscape; touch scrolling through every carousel; keyboard navigation; reduced motion; and a simulated video failure.
4. Lower DNS TTL in advance if the current DNS provider permits it. Record the existing HostGator DNS values before changing them.
5. Apply the exact Vercel DNS records shown by the project Domains screen. Do not guess the apex or `www` targets.
6. After DNS propagation, verify HTTPS, the canonical redirect, headers, caches, WAF events, the menu PDF, booking UI, and all crew routes.

The current site is hosted on HostGator, so Vercel code deployment alone does not change public traffic. DNS cutover is a separate, scheduled action after review.

## Rollback

- Immediate code rollback: promote the last known-good Vercel deployment.
- Firewall rollback: change `us-only-public-access` from Deny back to Log only while investigating; do not delete it.
- DNS rollback: restore the recorded HostGator apex and `www` records. Keep the old hosting account intact until the Vercel domain has been stable through DNS TTL plus a full business day.

## Cache policy

- HTML and active application routes: revalidate on every visit.
- hashed Next.js assets, versioned favicons, and the pinned QR library: one year, immutable.
- unversioned images, video, CSS/JS reliability assets, the menu PDF, robots file, and sitemap: one hour with one day of stale-while-revalidate.

This avoids stale active content while still allowing Vercel's CDN to absorb repeat asset traffic. If an unversioned asset changes, it should be renamed or allowed to age out for at most one hour.
