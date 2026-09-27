// Staff sign-in plumbing on the client: the repository only ever sends the
// Google session token, and the staff page has no other way in.
//
//   node tests/staff-auth.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function testRepositoryAuthRouting() {
  const urls = [];
  let auth = { managerToken: "mgr-token" };
  const context = vm.createContext({
    console,
    URL,
    Promise,
    setTimeout,
    fetch: async (url) => {
      urls.push(String(url));
      return { json: async () => ({ ok: true, data: {} }) };
    },
    window: { EventTicketing: {} },
  });
  const source = fs.readFileSync(new URL("assets/event-ticketing/repository.js", root), "utf8");
  vm.runInContext(source, context);
  const repo = context.window.EventTicketing.createAppsScriptRepository("https://example.test/exec", () => auth);

  await repo.getAttendees();
  let called = new URL(urls.pop());
  assert.equal(called.searchParams.get("managerToken"), "mgr-token");

  // Leftover credentials from older builds are never sent.
  auth = { key: "manager-secret", crewToken: "crew-device-token", managerToken: "mgr-token" };
  await repo.checkInAttendee("att_1", "Ryan", "Staff Dashboard");
  called = new URL(urls.pop());
  assert.equal(called.searchParams.get("managerToken"), "mgr-token");
  for (const p of ["key", "crewToken"]) assert.equal(called.searchParams.has(p), false, p);

  // Signed out: nothing attached.
  auth = {};
  await repo.getAttendees();
  called = new URL(urls.pop());
  assert.equal(called.searchParams.has("managerToken"), false);

  // googleLogin carries only the Google ID token — no stored credential.
  auth = { managerToken: "mgr-token" };
  await repo.googleLogin({ idToken: "h.p.s", extra: "ignored" });
  called = new URL(urls.pop());
  assert.equal(called.searchParams.get("action"), "googleLogin");
  assert.equal(called.searchParams.get("idToken"), "h.p.s");
  for (const p of ["key", "managerToken", "crewToken", "extra"]) assert.equal(called.searchParams.has(p), false, p);

  for (const gone of ["redeemCrewPass", "createCrewPass", "revokeCrewPasses"]) {
    assert.equal(typeof repo[gone], "undefined", `${gone} removed`);
  }
}

function testStaffPage() {
  const html = fs.readFileSync(new URL("staff/check-in/index.html", root), "utf8");
  const app = fs.readFileSync(new URL("staff/assets/js/check-in-app.js", root), "utf8");
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
  const referenced = Array.from(app.matchAll(/el\("([^"]+)"\)/g), (match) => match[1]);
  const missing = referenced.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `Missing HTML ids: ${missing.join(", ")}`);

  // Google is the only way in: no crew code, access key, or name step.
  for (const id of ["crewCodeInput", "accessKeyInput", "managerLoginForm", "identityGate", "staffNameInput", "crewPassModalBackdrop", "openCrewPassBtn"]) {
    assert.equal(ids.has(id), false, `${id} removed from the page`);
  }
  assert.ok(ids.has("googleSignInSlot"));
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(app, /sessionStorage\.setItem|localStorage\.setItem\("staffCheckIn\.(accessKey|crewToken)/);
  assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg|cdnjs/, "no runtime CDN scripts on the staff page");
}

await testRepositoryAuthRouting();
testStaffPage();
console.log("Staff auth tests passed.");
