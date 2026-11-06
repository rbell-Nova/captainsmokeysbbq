# Captain Smokey's BBQ — Vercel operations

This repository builds a deliberately allowlisted static deployment in `dist/`. The build includes the public homepage, `/menu`, menu PDF, `/register`, `/ticket`, and `/staff/check-in`, but it does not publish the dormant PHP wallet service, Apps Script backend source, tests, archived builds, or repository notes.

## Vercel project settings

- Framework preset: Other
- Install command: leave empty
- Build command: `node scripts/build-vercel.mjs`
- Output directory: `dist`
- Node.js: 24.x (pinned in `package.json`)
- GitHub repository: `rbell-Nova/captainsmokeysbbq`
- Production branch: `codex/vercel-reliability-security` (verified in Vercel on November 6, 2026)
- Vercel project: `rbell-1755s-projects/captainsmokeysbbq`
- Default production hostname: `captainsmokeysbbq.vercel.app`
- Preview deployments: Vercel Authentication (Standard Protection) enabled
- Production deployment: public, then restricted by the US-only firewall rule below

After reconnecting the Git repository, recheck **Settings → Environments → Production → Branch Tracking**. Reconnection reset this project to `main` on November 6, 2026; restore `codex/vercel-reliability-security`, keep automatic production-domain assignment enabled, and save. Verify a subsequent Git push produces a **Production** deployment, not only a successful Preview build.

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

The publishing flow is a push to the production GitHub branch, an automatic Vercel build, and visitors reaching that Vercel deployment through the domain's DNS records. HostGator can remain the DNS provider; Vercel does not copy built files into HostGator hosting.

At the start of the November 6, 2026 migration, the public domain still served the separately uploaded HostGator copy. The verified rollback DNS values were:

- Apex A: `50.87.146.108`
- `www` CNAME: `captainsmokeysbbq.com.`
- Nameservers: `hgns1.hostgator.com.` and `hgns2.hostgator.com.`

Vercel Domains supplied these website records on November 6, 2026:

- Apex A: `216.198.79.1`
- `www` CNAME: `7581742443683f9a.vercel-dns-017.com.`
- `www` redirect: HTTP 308 to `captainsmokeysbbq.com`

Mail is separate: MX points to `mail.captainsmokeysbbq.com`, whose A record is `50.87.146.108`. Leave both records intact.

Point only the website records to the exact targets provided by Vercel Domains. Preserve email records and nameservers. Verify the production deployment before making the domain change, and confirm the custom domain's response and menu route afterward.

## Rollback

- Immediate code rollback: promote the last known-good Vercel deployment.
- Firewall rollback: change `us-only-public-access` from Deny back to Log only while investigating; do not delete it.
- DNS rollback: restore the recorded HostGator apex and `www` records. Keep the old hosting account intact until the Vercel domain has been stable through DNS TTL plus a full business day.

## Cache policy

- HTML and active application routes: revalidate on every visit.
- hashed Next.js assets, versioned favicons, and the pinned QR library: one year, immutable.
- images, video, CSS/JS reliability assets, the menu PDF, robots file, and sitemap: one hour with one day of stale-while-revalidate.

The build adds a content hash to the homepage enhancement CSS/JS, menu stylesheet, and PDF links on the menu page. Each source change produces a new asset URL so it takes effect immediately after deployment. If another unversioned asset changes, it should be renamed or allowed to age out for at most one hour.

## Menu and navigation updates

- Edit the public menu in `menu/index.html` and its styles in `assets/css/menu.css`. Keep items, serving sizes, prices, and premium upgrades consistent with the approved catering PDF.
- `scripts/build-vercel.mjs` publishes the menu route and routes desktop/mobile Menu links and the homepage's full-menu button to it.
- Homepage anchors use native smooth scrolling with room for the fixed header. Reduced-motion preferences retain immediate navigation.
- Run `npm test` and `npm run build`, review desktop/mobile navigation, commit the source changes, then push the production branch. Do not commit `dist/` or rely on a manual HostGator upload for future Vercel updates.
