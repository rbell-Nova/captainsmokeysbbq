// Guest ticket card: adult/child/total counts, donation line, screenshot
// guidance, and Wallet buttons that are honestly unavailable.
//
//   node tests/ticket-card.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const cardSource = read("assets/event-ticketing/render-ticket-card.js");
const pages = {
  ticket: { html: read("ticket/index.html"), js: read("ticket/assets/js/ticket-page.js") },
  register: { html: read("register/index.html"), js: read("register/assets/js/register-form.js") },
};

function fakeNode(tag) {
  const attrs = {};
  return {
    tag,
    className: "",
    textContent: "",
    children: [],
    disabled: false,
    title: "",
    get firstChild() {
      return this.children[0] || null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    setAttribute(k, v) {
      attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete attrs[k];
      if (k === "src") delete this.src;
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
}

const qrLibSource = read("assets/vendor/qrcode-generator-1.4.4/qrcode.js");

function loadCard({ withQrLib = true, onQr } = {}) {
  const context = { document: { createElement: fakeNode }, EventTicketing: {} };
  context.window = context;
  vm.createContext(context);
  if (withQrLib) {
    vm.runInContext(qrLibSource, context, { filename: "qrcode.js" });
    const real = context.qrcode;
    context.qrcode = (...args) => {
      const qr = real(...args);
      const addData = qr.addData.bind(qr);
      qr.addData = (data) => {
        if (onQr) onQr(data);
        return addData(data);
      };
      return qr;
    };
  }
  vm.runInContext(cardSource, context, { filename: "render-ticket-card.js" });
  return context.EventTicketing;
}

const ET_HELPERS = {
  formatCurrency: (c) => `$${(c / 100).toFixed(2)}`,
  formatDateTime: (v) => String(v),
};

const EVENT = { name: "Fall Muster", startsAt: "2026-10-01T16:00:00Z", venue: "Lot" };
const baseAttendee = {
  firstName: "Pat",
  lastName: "Griller",
  ticketNumber: "SM-1001",
  adultCount: 3,
  childCount: 2,
  totalGuestCount: 5,
  donationAmountCents: 1000,
  ticketStatus: "ready",
};

function render(attendee, { withCounts = true } = {}) {
  const card = loadCard();
  const dom = {
    eventName: fakeNode(),
    eventMeta: fakeNode(),
    guestName: fakeNode(),
    ticketNumber: fakeNode(),
    qrImg: fakeNode(),
    summaryLine: fakeNode(),
    status: fakeNode(),
  };
  if (withCounts) dom.partyCounts = fakeNode();
  card.renderTicketCard(dom, ET_HELPERS, EVENT, attendee, "tk_abc");
  const counts = withCounts
    ? dom.partyCounts.children.map((cell) => `${cell.children[0].textContent} ${cell.children[1].textContent}`)
    : null;
  return { dom, counts };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("shows first/last name plus adult, child, and total counts", () => {
  const { dom, counts } = render(baseAttendee);
  assert.equal(dom.guestName.textContent, "Pat Griller");
  assert.deepEqual(counts, ["3 Adults", "2 Children", "5 Total"]);
  assert.equal(dom.summaryLine.textContent, "$10.00 donation due at check-in");
});

test("singular labels and zero children", () => {
  const { dom, counts } = render({ ...baseAttendee, adultCount: 1, childCount: 0, totalGuestCount: 1, donationAmountCents: 0 });
  assert.deepEqual(counts, ["1 Adult", "0 Children", "1 Total"]);
  assert.equal(dom.summaryLine.textContent, "No donation due");
});

test("re-rendering replaces counts instead of appending", () => {
  const card = loadCard();
  const dom = { eventName: fakeNode(), eventMeta: fakeNode(), guestName: fakeNode(), ticketNumber: fakeNode(), qrImg: fakeNode(), summaryLine: fakeNode(), partyCounts: fakeNode() };
  card.renderTicketCard(dom, ET_HELPERS, EVENT, baseAttendee, "tk_abc");
  card.renderTicketCard(dom, ET_HELPERS, EVENT, baseAttendee, "tk_abc");
  assert.equal(dom.partyCounts.children.length, 3);
});

test("counts are text, never markup", () => {
  const { counts } = render({ ...baseAttendee, adultCount: "<img src=x onerror=alert(1)>", totalGuestCount: 2 });
  assert.equal(counts[0], "0 Adults", "non-numeric values are coerced to numbers");
});

test("pages without a counts element keep the one-line summary", () => {
  const { dom } = render(baseAttendee, { withCounts: false });
  assert.equal(dom.summaryLine.textContent, "5 guests · $10.00 donation due at check-in");
});

test("QR is drawn locally from the ?a= ticket URL", () => {
  const encoded = [];
  const card = loadCard({ onQr: (data) => encoded.push(data) });
  const dom = { eventName: fakeNode(), eventMeta: fakeNode(), guestName: fakeNode(), ticketNumber: fakeNode(), qrImg: fakeNode(), summaryLine: fakeNode() };
  card.renderTicketCard(dom, ET_HELPERS, EVENT, baseAttendee, "tk_abc");
  assert.deepEqual(encoded, ["https://www.captainsmokeysbbq.com/ticket/?a=tk_abc"], "matches the staff scanner's ?a= parsing");
  assert.match(dom.qrImg.src, /^data:image\/gif;base64,/);
  assert.doesNotMatch(dom.qrImg.src, /tk_abc/, "token is not visible in the image URL");
});

test("without the QR library, no outside QR service is used", () => {
  const card = loadCard({ withQrLib: false });
  const dom = { eventName: fakeNode(), eventMeta: fakeNode(), guestName: fakeNode(), ticketNumber: fakeNode(), qrImg: fakeNode(), summaryLine: fakeNode() };
  card.renderTicketCard(dom, ET_HELPERS, EVENT, baseAttendee, "tk_abc");
  assert.equal(dom.qrImg.src, undefined);
  assert.match(dom.qrImg.alt, /QR code unavailable — show ticket SM-1001/);
});

test("no page or shared script calls a third-party QR service or CDN", () => {
  const files = [
    "assets/event-ticketing/render-ticket-card.js",
    "ticket/index.html",
    "register/index.html",
    "staff/check-in/index.html",
    "staff/assets/js/check-in-app.js",
  ];
  for (const rel of files) assert.doesNotMatch(read(rel), /qrserver|chart\.googleapis|cdn\.jsdelivr|unpkg\.com/, rel);
});

test("vendored QR library is the pinned, unmodified 1.4.4 file", async () => {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(fs.readFileSync(path.join(root, "assets/vendor/qrcode-generator-1.4.4/qrcode.js"))).digest("hex");
  assert.equal(hash, "18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780");
});

for (const [name, { html, js }] of Object.entries(pages)) {
  test(`${name}: Wallet buttons are disabled and say coming soon`, () => {
    for (const id of ["appleWalletBtn", "googleWalletBtn"]) {
      const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0];
      assert.match(tag, /\bdisabled\b/, `${id} must be disabled in ${name}`);
      assert.match(tag, /aria-disabled="true"/);
    }
    assert.doesNotMatch(html, /Add to (Apple|Google) Wallet/, "no fake Add-to-Wallet label");
    assert.equal((html.match(/Wallet — coming soon/g) || []).length, 2);
  });

  test(`${name}: counts element exists and is passed to the renderer`, () => {
    assert.match(html, /id="ticketPartyCounts"/);
    assert.match(js, /partyCounts:\s*(el\("ticketPartyCounts"\)|dom\.partyCounts)/);
    if (name === "register") assert.match(js, /partyCounts: dom\.partyCounts/);
  });

  test(`${name}: page tells guests to screenshot the ticket`, () => {
    assert.match(html, /screenshot/i);
  });

  test(`${name}: QR library loads before the ticket renderer`, () => {
    const lib = html.indexOf('src="/assets/vendor/qrcode-generator-1.4.4/qrcode.js"');
    const renderer = html.indexOf('src="/assets/event-ticketing/render-ticket-card.js"');
    assert.ok(lib > -1 && renderer > lib);
  });

  test(`${name}: every el("...") the script uses exists in the HTML`, () => {
    const ids = [...js.matchAll(/el\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `${name} is missing #${id}`);
  });
}

test("wireWalletPlaceholders keeps buttons disabled without a click", () => {
  const card = loadCard();
  const apple = fakeNode();
  const google = fakeNode();
  card.wireWalletPlaceholders(apple, google);
  assert.equal(apple.disabled, true);
  assert.equal(google.disabled, true);
  assert.equal(apple.getAttribute("aria-disabled"), "true");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n${err && err.stack ? err.stack : err}`);
  }
}
if (failed) {
  console.error(`${failed} ticket card test(s) failed.`);
  process.exit(1);
}
console.log(`Ticket card tests passed (${tests.length}).`);
