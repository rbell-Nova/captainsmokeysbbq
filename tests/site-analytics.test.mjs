import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const readScript = (name) => readFileSync(new URL("../assets/" + name, import.meta.url), "utf8");
const analytics = readScript("site-analytics.js");
const booking = readScript("site-reliability.js");

function page(hostname = "captainsmokeysbbq.com", { form = null, visibility = "visible" } = {}) {
  const listeners = new Map();
  const scripts = [];
  const observers = [];
  const timers = new Map();
  let clock = 0, nextTimer = 0;
  const window = { matchMedia: () => ({ matches: true }) };
  const document = {
    readyState: "complete",
    visibilityState: visibility,
    head: { append: (script) => scripts.push(script) },
    createElement: () => ({}),
    querySelector: () => form,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn)),
    dispatchEvent: (event) => [...(listeners.get(event.type) || [])].forEach((fn) => fn(event)),
  };
  window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const context = {
    window, document, location: new URL("https://" + hostname), URL, Event, CustomEvent,
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, due: clock + delay }); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  };
  runInNewContext(analytics, context);
  const events = () => Array.from(window.dataLayer || []).filter(([type]) => type === "event").map((args) => JSON.parse(JSON.stringify([...args])));
  const tick = (milliseconds) => {
    clock += milliseconds;
    for (const [id, timer] of timers) {
      if (timer.due <= clock) { timers.delete(id); timer.fn(); }
    }
  };
  const setVisibility = (value) => {
    document.visibilityState = value;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return { context, scripts, events, observers, tick, setVisibility };
}

test("public links report distinct actions without contact details or preview traffic", () => {
  const { context, scripts, events } = page();
  assert.equal(scripts.length, 1);
  for (const href of ["tel:+15555555555", "mailto:example@example.com", "/#book", "/PDFs/CateringMenu-2025-Template.pdf?v=1", "/menu", "/#gallery"]) {
    const link = { href: new URL(href, context.location).href };
    context.document.dispatchEvent({ type: "click", target: { closest: () => link } });
  }
  assert.deepEqual(events(), ["click_to_call", "click_to_email", "booking_cta_click", "menu_pdf_click", "menu_cta_click"].map((name) => ["event", name, { cta_location: "other" }]));
  assert.equal(page("preview.vercel.app").scripts.length, 0);
});

test("CTA labels and submission-error categories allow only fixed values", () => {
  const { context, events } = page();
  for (const [href, placement] of [["/#book", "hero"], ["/menu", "header"], ["mailto:guest@example.com", "guest@example.com"]]) {
    const link = { href: new URL(href, context.location).href, dataset: { analyticsLocation: placement } };
    context.document.dispatchEvent({ type: "click", target: { closest: () => link } });
  }
  context.document.dispatchEvent(new CustomEvent("bookingerror", { detail: { category: "network", email: "private@example.com" } }));
  context.document.dispatchEvent(new CustomEvent("bookingerror", { detail: { category: "private@example.com" } }));
  assert.deepEqual(events(), [
    ["event", "booking_cta_click", { cta_location: "hero" }],
    ["event", "menu_cta_click", { cta_location: "header" }],
    ["event", "click_to_email", { cta_location: "other" }],
    ["event", "booking_form_error", { error_category: "network" }],
  ]);
  assert.doesNotMatch(JSON.stringify(events()), /guest@example|private@example/);
});

test("the booking form needs one continuous visible second and reports once per page", () => {
  const form = {};
  const { events, observers, tick } = page("captainsmokeysbbq.com", { form });
  const observer = observers[0];
  const visibility = (ratio) => observer.callback([{ target: form, isIntersecting: ratio > 0, intersectionRatio: ratio }]);
  observer.callback([
    { target: form, isIntersecting: true, intersectionRatio: 0.5 },
    { target: form, isIntersecting: false, intersectionRatio: 0 },
  ]);
  tick(1500);
  assert.deepEqual(events(), []);
  visibility(0.14);
  tick(1500);
  visibility(0.5);
  tick(500);
  visibility(0);
  tick(1000);
  assert.deepEqual(events(), []);
  visibility(0.5);
  tick(999);
  assert.deepEqual(events(), []);
  tick(1);
  assert.deepEqual(events(), [["event", "booking_form_view"]]);
  assert.equal(observer.disconnected, true);
  visibility(0.8);
  tick(2000);
  assert.equal(events().length, 1);
});

test("a background tab never records a booking-form view or keeps a partial dwell", () => {
  const form = {};
  const { events, observers, tick, setVisibility } = page("captainsmokeysbbq.com", { form, visibility: "hidden" });
  observers[0].callback([{ target: form, isIntersecting: true, intersectionRatio: 0.5 }]);
  tick(2000);
  assert.deepEqual(events(), []);
  setVisibility("visible");
  tick(500);
  setVisibility("hidden");
  tick(2000);
  assert.deepEqual(events(), []);
  setVisibility("visible");
  tick(1000);
  assert.deepEqual(events(), [["event", "booking_form_view"]]);
  assert.equal(page("preview.vercel.app", { form }).observers.length, 0);
});

test("only an accepted booking emits one lead and no submitted fields", async () => {
  const { context, events } = page();
  const status = { dataset: {} };
  let submit, accepted = false, networkFailure = false;
  const form = {
    querySelector: () => null,
    reportValidity: () => true,
    reset() {},
    addEventListener: (type, handler) => { if (type === "submit") submit = handler; },
  };
  Object.assign(context.document, {
    querySelector: (selector) => selector.startsWith("#book form") ? form : null,
    querySelectorAll: () => [],
    getElementById: (id) => id === "booking-status" ? status : null,
  });
  Object.assign(context, {
    fetch: async () => { if (networkFailure) throw new Error("private@example.com"); return { ok: accepted }; },
    FormData: class { *[Symbol.iterator]() { yield ["date", "2099-01-01"]; yield ["email", "guest@example.com"]; } },
    console: { error() {} },
  });
  runInNewContext(booking, context);
  context.document.dispatchEvent(new Event("DOMContentLoaded"));
  await submit({ preventDefault() {} });
  assert.equal(status.dataset.state, "error");
  assert.deepEqual(events(), [["event", "booking_form_error", { error_category: "service" }]]);
  networkFailure = true;
  await submit({ preventDefault() {} });
  assert.equal(status.dataset.state, "error");
  assert.deepEqual(events().at(-1), ["event", "booking_form_error", { error_category: "network" }]);
  networkFailure = false;
  accepted = true;
  await submit({ preventDefault() {} });
  assert.equal(status.dataset.state, "success");
  assert.deepEqual(events().at(-1), ["event", "generate_lead"]);
  assert.equal(events().filter(([, name]) => name === "generate_lead").length, 1);
  assert.doesNotMatch(JSON.stringify(events()), /guest@example|private@example|2099-01-01/);
});
