// Regression tests for the staff dashboard's client-only Clear action and
// the async race guards around the camera, manual lookup, and QR lookup.
// Runs check-in-app.js inside a small fake DOM — no browser required.
//
//   node tests/check-in-reset.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "staff/assets/js/check-in-app.js"), "utf8");
const pageHtml = fs.readFileSync(path.join(root, "staff/check-in/index.html"), "utf8");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Seed each fake element with the classes it has in the real page, so
// "hidden" starts where the HTML puts it.
const initialClasses = new Map();
for (const [tag] of pageHtml.matchAll(/<[a-z]+\b[^>]*\bid="[^"]+"[^>]*>/gi)) {
  const id = tag.match(/\bid="([^"]+)"/)[1];
  const cls = (tag.match(/\bclass="([^"]*)"/) || [])[1] || "";
  initialClasses.set(id, cls.split(/\s+/).filter(Boolean));
}

function fakeElement(id) {
  const classes = new Set(initialClasses.get(id) || []);
  const listeners = {};
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: false,
    srcObject: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : Boolean(force);
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    // Fire listeners like a browser would (without waiting for any async
    // handler to finish), then let pending microtasks settle.
    async dispatch(type, extra) {
      const event = { type, target: this, preventDefault() {}, ...extra };
      for (const fn of listeners[type] || []) {
        Promise.resolve(fn(event)).catch((err) => {
          throw err;
        });
      }
      await flush();
    },
    querySelectorAll: () => [],
    appendChild(child) {
      this.children = (this.children || []).concat(child);
      return child;
    },
    remove() {},
    focus() {},
    select() {},
    reset() {},
    play: async () => {},
    getAttribute: () => null,
  };
}

const ATTENDEE = {
  id: "att_1",
  firstName: "Pat",
  lastName: "Griller",
  ticketNumber: "SM-1001",
  phoneNumber: "5555551234",
  phoneLastFour: "1234",
  adultCount: 2,
  childCount: 1,
  totalGuestCount: 3,
  includedAdultCount: 2,
  extraAdultCount: 0,
  donationAmountCents: 0,
  registeredAt: "2026-09-01T12:00:00Z",
  ticketStatus: "ready",
  deliveryStatus: "sent",
  checkedInAt: null,
  checkedInBy: null,
  checkInStation: null,
  notes: "",
};

/**
 * Boots check-in-app.js as a signed-in manager with a remembered staff
 * name, so init() lands on the dashboard. Every repository call and
 * getUserMedia request is recorded; tests resolve them when they choose.
 */
async function boot({ barcodeValue, attendee = ATTENDEE, manager = true, crewToken = "", googleClientId = "", google = null,
  googleLogin = null, managerToken = "", managerTokenExpiresAt = "", expectDashboard = true } = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, fakeElement(id));
    return elements.get(id);
  };

  const calls = [];
  const pending = { search: [], qr: [], camera: [] };
  const mutations = ["checkInAttendee", "undoCheckIn", "cancelTicket", "updateNotes", "resendTicket", "registerAttendee", "revokeCrewPasses", "createCrewPass"];

  const repo = {
    getEventDetails: async () => ({ name: "Test Event", startsAt: "2026-10-01T16:00:00Z", venue: "Lot", status: "open" }),
    getAttendees: async () => [{ ...attendee }],
    getRecentActivity: async () => [],
    searchAttendees(query) {
      calls.push(["searchAttendees", query]);
      const d = deferred();
      pending.search.push({ query, ...d });
      return d.promise;
    },
    findAttendeeByQrToken(token) {
      calls.push(["findAttendeeByQrToken", token]);
      const d = deferred();
      pending.qr.push({ token, ...d });
      return d.promise;
    },
  };
  repo.googleLogin = async (fields) => {
    calls.push(["googleLogin", fields]);
    if (googleLogin) return googleLogin(fields);
    return { managerToken: "mgr-token", expiresAt: new Date(Date.now() + 3600e3).toISOString(), email: "manager@example.com", name: "Ryan" };
  };
  for (const name of mutations) {
    repo[name] = async () => {
      calls.push([name]);
      return { ok: true, attendee: { ...ATTENDEE } };
    };
  }

  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  };
  const localStorage = storage();
  const sessionStorage = storage();
  localStorage.setItem("staffCheckIn.staffName", "Test Staff");
  if (manager) sessionStorage.setItem("staffCheckIn.accessKey", "manager-secret");
  if (crewToken) localStorage.setItem("staffCheckIn.crewToken", crewToken);
  if (managerToken) localStorage.setItem("staffCheckIn.managerToken", managerToken);
  if (managerTokenExpiresAt) localStorage.setItem("staffCheckIn.managerTokenExpiresAt", managerTokenExpiresAt);
  const injectedScripts = [];

  const unrefTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  };

  const toasts = [];
  const context = {
    console,
    Promise,
    Date,
    Map,
    Set,
    URL,
    performance,
    localStorage,
    sessionStorage,
    setTimeout: unrefTimer,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (cb) => unrefTimer(() => cb(performance.now()), 5),
    cancelAnimationFrame: (t) => clearTimeout(t),
    history: { replaceState() {} },
    location: { hash: "", pathname: "/staff/check-in/", search: "", origin: "https://example.test" },
    navigator: {
      clipboard: { writeText: async () => {} },
      mediaDevices: {
        getUserMedia() {
          calls.push(["getUserMedia"]);
          const d = deferred();
          pending.camera.push(d);
          return d.promise;
        },
      },
    },
    document: {
      activeElement: null,
      visibilityState: "visible",
      getElementById: getEl,
      createElement: () => fakeElement(),
      head: { appendChild: (node) => { injectedScripts.push(node); return node; } },
    },
    EventTicketing: {
      CONFIG: { GOOGLE_CLIENT_ID: googleClientId },
      createRepository: () => repo,
      calculatePartyTotals: () => ({ totalGuestCount: 0, donationAmountCents: 0 }),
      formatCurrency: (c) => `$${(c / 100).toFixed(2)}`,
      formatDateTime: (v) => String(v),
      maskPhone: () => "(***) ***-1234",
    },
  };
  if (barcodeValue) {
    context.BarcodeDetector = class {
      async detect() {
        return [{ rawValue: barcodeValue }];
      }
    };
  }
  if (google) context.google = google;
  context.window = context;
  vm.createContext(context);

  // Capture toasts by wrapping the toast stack element.
  const stack = getEl("toastStack");
  stack.appendChild = (node) => {
    toasts.push(node.textContent);
    return node;
  };

  vm.runInContext(appSource, context, { filename: "check-in-app.js" });
  await flush();

  const $ = getEl;
  if (expectDashboard) assert.equal($("dashboardContent").classList.contains("hidden"), false, "harness should open the dashboard");
  return { $, calls, pending, toasts, context, mutations, localStorage, sessionStorage, injectedScripts };
}

function fakeStream() {
  const stopped = [];
  return {
    stopped,
    getTracks: () => [{ stop: () => stopped.push("video") }],
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("page has a Clear button wired to the app", () => {
  assert.match(pageHtml, /id="resetCheckInBtn"/);
  assert.match(appSource, /el\("resetCheckInBtn"\)/);
});

test("Clear while the camera prompt is open releases the late stream", async () => {
  const { $, pending } = await boot();
  await $("startScanBtn").dispatch("click");
  assert.equal(pending.camera.length, 1);
  assert.equal($("stopScanBtn").classList.contains("hidden"), false, "Stop is offered while starting");
  assert.equal($("startScanBtn").classList.contains("hidden"), true, "Start is hidden while starting");

  await $("resetCheckInBtn").dispatch("click");
  const stream = fakeStream();
  pending.camera[0].resolve(stream);
  await flush();

  assert.deepEqual(stream.stopped, ["video"], "late camera stream must be stopped");
  assert.equal($("scannerVideo").srcObject, null);
  assert.equal($("startScanBtn").classList.contains("hidden"), false);
  assert.equal($("stopScanBtn").classList.contains("hidden"), true);
});

test("Stop during the camera prompt also releases the late stream", async () => {
  const { $, pending } = await boot();
  await $("startScanBtn").dispatch("click");
  await $("stopScanBtn").dispatch("click");
  const stream = fakeStream();
  pending.camera[0].resolve(stream);
  await flush();
  assert.deepEqual(stream.stopped, ["video"]);
});

test("double-tapping Start opens only one camera request", async () => {
  const { $, pending } = await boot();
  await $("startScanBtn").dispatch("click");
  await $("startScanBtn").dispatch("click");
  assert.equal(pending.camera.length, 1);
});

test("Clear cancels a debounced lookup before it is sent", async () => {
  const { $, calls } = await boot();
  $("lookupInput").value = "Pat";
  await $("lookupInput").dispatch("input");
  await $("resetCheckInBtn").dispatch("click");
  await sleep(250);
  assert.equal(calls.filter(([n]) => n === "searchAttendees").length, 0);
  assert.equal($("lookupInput").value, "");
});

test("Clear discards an in-flight lookup result", async () => {
  const { $, pending } = await boot();
  $("lookupInput").value = "Pat";
  await $("lookupInput").dispatch("input");
  await sleep(220);
  assert.equal(pending.search.length, 1);

  await $("resetCheckInBtn").dispatch("click");
  pending.search[0].resolve([{ ...ATTENDEE }]);
  await flush();
  assert.equal($("lookupResults").innerHTML, "");
});

test("an older lookup cannot overwrite a newer one", async () => {
  const { $, pending } = await boot();
  $("lookupInput").value = "Pa";
  await $("lookupInput").dispatch("input");
  await sleep(220);
  $("lookupInput").value = "Pat";
  await $("lookupInput").dispatch("input");
  await sleep(220);
  assert.equal(pending.search.length, 2);

  pending.search[1].resolve([{ ...ATTENDEE, firstName: "Newest" }]);
  await flush();
  pending.search[0].resolve([{ ...ATTENDEE, firstName: "Stale" }]);
  await flush();
  assert.match($("lookupResults").innerHTML, /Newest/);
  assert.doesNotMatch($("lookupResults").innerHTML, /Stale/);
});

test("a failed lookup shows an inline error instead of throwing", async () => {
  const { $, pending } = await boot();
  $("lookupInput").value = "Pat";
  await $("lookupInput").dispatch("input");
  await sleep(220);
  pending.search[0].reject(new Error("Network down"));
  await flush();
  assert.match($("lookupResults").innerHTML, /Network down/);
});

async function scanToPendingLookup(ctx) {
  const { $, pending } = ctx;
  await $("startScanBtn").dispatch("click");
  pending.camera[0].resolve(fakeStream());
  for (let i = 0; i < 20 && pending.qr.length === 0; i++) await sleep(10);
  assert.equal(pending.qr.length, 1, "scan should trigger a ticket lookup");
  assert.equal(pending.qr[0].token, "tk_abc123", "?a= token is extracted from the ticket URL");
}

test("Clear discards a QR lookup that resolves afterward", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await scanToPendingLookup(ctx);
  await ctx.$("resetCheckInBtn").dispatch("click");
  ctx.pending.qr[0].resolve({ ...ATTENDEE });
  await flush();
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), true, "no party re-selected");
  assert.equal(ctx.toasts.some((t) => /Ready to check in/.test(t)), false);
});

test("without Clear, a scan selects the party (control case)", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await scanToPendingLookup(ctx);
  ctx.pending.qr[0].resolve({ ...ATTENDEE });
  await flush();
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), false);
  assert.ok(ctx.toasts.some((t) => /Ready to check in Pat Griller/.test(t)));
});

test("Clear deselects the party and never calls the backend", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await scanToPendingLookup(ctx);
  ctx.pending.qr[0].resolve({ ...ATTENDEE });
  await flush();

  const before = ctx.calls.length;
  await ctx.$("resetCheckInBtn").dispatch("click");
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), true);
  assert.equal(ctx.$("selectedEmpty").classList.contains("hidden"), false);
  const after = ctx.calls.slice(before).map(([n]) => n);
  assert.deepEqual(after.filter((n) => ctx.mutations.includes(n)), [], "Clear must not mutate tickets");
});

test("Clear asks before discarding unsaved notes", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await scanToPendingLookup(ctx);
  ctx.pending.qr[0].resolve({ ...ATTENDEE });
  await flush();

  ctx.$("detailNotes").value = "Needs wheelchair seating";
  await ctx.$("resetCheckInBtn").dispatch("click");
  assert.equal(ctx.$("modalBackdrop").classList.contains("hidden"), false, "confirm modal shown");
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), false, "still selected until confirmed");

  await ctx.$("modalConfirmBtn").dispatch("click");
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), true);
  assert.equal(ctx.$("detailNotes").value, "");
});

test("Switch Staff also clears pending check-in work", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await scanToPendingLookup(ctx);
  await ctx.$("logoutBtn").dispatch("click");
  ctx.pending.qr[0].resolve({ ...ATTENDEE });
  await flush();
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), true);
});

// --- review fixes: XSS escaping and Switch Staff ---------------------------

const EVIL = '<img src=x onerror="alert(1)">';

async function selectByScan(ctx, attendee) {
  await scanToPendingLookup(ctx);
  ctx.pending.qr[0].resolve({ ...attendee });
  await flush();
  assert.equal(ctx.$("selectedPanel").classList.contains("hidden"), false);
}

test("a hostile staff name is escaped in the selected-party details", async () => {
  const hostile = { ...ATTENDEE, ticketStatus: "checked-in", checkedInBy: EVIL, checkInStation: EVIL, checkedInAt: "2026-10-17T17:00:00Z" };
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123", attendee: hostile });
  await selectByScan(ctx, hostile);
  const html = ctx.$("detailGrid").innerHTML;
  assert.doesNotMatch(html, /<img/i, "markup must not reach innerHTML");
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("sheet values in badges and directory rows are escaped", async () => {
  const hostile = { ...ATTENDEE, ticketStatus: EVIL, deliveryStatus: EVIL, adultCount: EVIL };
  const ctx = await boot({ attendee: hostile });
  const html = ctx.$("attendeeTableBody").innerHTML;
  assert.ok(html.length > 0, "directory rendered");
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /class="badge badge--imgsrcxonerroralert1"/, "badge class is reduced to safe characters");
});

test("Switch Staff ends the manager session (no crew pass → login screen)", async () => {
  const ctx = await boot();
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), "manager-secret");
  await ctx.$("logoutBtn").dispatch("click");
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), null, "manager key removed");
  assert.equal(ctx.$("loginGate").classList.contains("hidden"), false);
  assert.equal(ctx.$("dashboardContent").classList.contains("hidden"), true);
  assert.equal(ctx.$("openCrewPassBtn").classList.contains("hidden"), true);
});

test("Switch Staff on a crew device keeps the crew pass and asks for a name", async () => {
  const ctx = await boot({ manager: true, crewToken: "crew-device-token" });
  await ctx.$("logoutBtn").dispatch("click");
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), null, "manager key still removed");
  assert.equal(ctx.localStorage.getItem("staffCheckIn.crewToken"), "crew-device-token");
  assert.equal(ctx.$("identityGate").classList.contains("hidden"), false);
  assert.equal(ctx.$("loginGate").classList.contains("hidden"), true);
});

test("Switch Staff asks before discarding unsaved notes", async () => {
  const ctx = await boot({ barcodeValue: "https://www.captainsmokeysbbq.com/ticket/?a=tk_abc123" });
  await selectByScan(ctx, ATTENDEE);
  ctx.$("detailNotes").value = "Bring a high chair";
  await ctx.$("logoutBtn").dispatch("click");
  assert.equal(ctx.$("modalBackdrop").classList.contains("hidden"), false, "confirm shown");
  assert.equal(ctx.$("dashboardContent").classList.contains("hidden"), false, "still on dashboard");
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), "manager-secret", "nothing changed yet");

  await ctx.$("modalConfirmBtn").dispatch("click");
  assert.equal(ctx.$("dashboardContent").classList.contains("hidden"), true);
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), null);
});

// --- Sign in with Google -----------------------------------------------------

function fakeGoogle() {
  const gsi = { initialized: null, rendered: null, disabledAutoSelect: 0 };
  gsi.api = { accounts: { id: {
    initialize: (opts) => { gsi.initialized = opts; },
    renderButton: (el, opts) => { gsi.rendered = { el, opts }; },
    disableAutoSelect: () => { gsi.disabledAutoSelect++; },
  } } };
  return gsi;
}

test("no client ID → no Google button and Google's script is never loaded", async () => {
  const ctx = await boot({ manager: false, expectDashboard: false });
  assert.equal(ctx.$("googleSignInBlock").classList.contains("hidden"), true);
  assert.equal(ctx.injectedScripts.length, 0);
  assert.equal(ctx.$("loginGate").classList.contains("hidden"), false);
});

test("client ID set → loads Google's script and renders the button", async () => {
  const ctx = await boot({ manager: false, expectDashboard: false, googleClientId: "abc.apps.googleusercontent.com" });
  assert.equal(ctx.$("googleSignInBlock").classList.contains("hidden"), false);
  assert.equal(ctx.$("managerEntry").open, true, "manager setup opens");
  assert.equal(ctx.$("managerKeyEntry").open, false, "access key folds away as a backup");
  assert.equal(ctx.injectedScripts.length, 1);
  assert.equal(ctx.injectedScripts[0].src, "https://accounts.google.com/gsi/client");
  // Simulate the script finishing loading.
  const g = fakeGoogle();
  ctx.context.google = g.api;
  ctx.injectedScripts[0].onload();
  assert.equal(g.initialized.client_id, "abc.apps.googleusercontent.com");
  assert.equal(g.initialized.auto_select, false);
  assert.equal(g.rendered.el, ctx.$("googleSignInSlot"));
});

test("script load failure points managers to the access key", async () => {
  const ctx = await boot({ manager: false, expectDashboard: false, googleClientId: "abc.apps.googleusercontent.com" });
  ctx.injectedScripts[0].onerror();
  assert.equal(ctx.$("managerKeyEntry").open, true);
  assert.match(ctx.$("managerLoginError").textContent, /couldn't load/);
});

test("Google sign-in stores a manager session and opens the manager dashboard", async () => {
  const g = fakeGoogle();
  const ctx = await boot({ manager: false, expectDashboard: false, googleClientId: "abc", google: g.api, crewToken: "" });
  ctx.localStorage.removeItem("staffCheckIn.staffName");
  await g.initialized.callback({ credential: "header.payload.sig" });
  await flush();
  assert.equal(JSON.stringify(ctx.calls.find(([n]) => n === "googleLogin")[1]), JSON.stringify({ idToken: "header.payload.sig" }));
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerToken"), "mgr-token");
  assert.equal(ctx.sessionStorage.getItem("staffCheckIn.accessKey"), null, "no access key involved");
  assert.equal(ctx.$("identityGate").classList.contains("hidden"), false, "asks who is working");
  await ctx.$("identityForm").dispatch("submit");
  assert.equal(ctx.$("dashboardContent").classList.contains("hidden"), false);
  assert.equal(ctx.$("openCrewPassBtn").classList.contains("hidden"), false, "manager controls shown");
});

test("a rejected Google account shows the reason and stores nothing", async () => {
  const g = fakeGoogle();
  const ctx = await boot({ manager: false, expectDashboard: false, googleClientId: "abc", google: g.api,
    googleLogin: async () => { throw new Error("The Google account x@gmail.com isn't a manager for this event."); } });
  await g.initialized.callback({ credential: "h.p.s" });
  await flush();
  assert.match(ctx.$("managerLoginError").textContent, /isn't a manager/);
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerToken"), null);
  assert.equal(ctx.$("dashboardContent").classList.contains("hidden"), true);
});

test("returning manager with a saved Google session goes straight in", async () => {
  const ctx = await boot({ manager: false, managerToken: "mgr-token",
    managerTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(ctx.$("openCrewPassBtn").classList.contains("hidden"), false);
});

test("an expired saved Google session is discarded at startup", async () => {
  const ctx = await boot({ manager: false, expectDashboard: false, managerToken: "old",
    managerTokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerToken"), null);
  assert.equal(ctx.$("loginGate").classList.contains("hidden"), false);
});

test("Switch Staff signs the Google manager out on this device", async () => {
  const g = fakeGoogle();
  const ctx = await boot({ manager: false, google: g.api, googleClientId: "abc", managerToken: "mgr-token",
    managerTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString() });
  await ctx.$("logoutBtn").dispatch("click");
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerToken"), null);
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerTokenExpiresAt"), null);
  assert.equal(g.disabledAutoSelect, 1, "Google won't silently sign the next person in");
  assert.equal(ctx.$("loginGate").classList.contains("hidden"), false);
});

test("Forget this device clears the Google manager session too", async () => {
  const ctx = await boot({ manager: false, managerToken: "mgr-token",
    managerTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString() });
  await ctx.$("forgetDeviceBtn").dispatch("click");
  assert.equal(ctx.localStorage.getItem("staffCheckIn.managerToken"), null);
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
  console.error(`${failed} check-in reset test(s) failed.`);
  process.exit(1);
}
console.log(`Check-in reset tests passed (${tests.length}).`);
