// Staff sign-in with Google — the only way into the staff dashboard
// (backend/apps-script/Code.gs).
//
//   node tests/google-login.test.mjs
//
// Google's tokeninfo endpoint is faked; every claim check is exercised.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
const bytes = (v) => Array.from(Buffer.from(v), (b) => (b > 127 ? b - 256 : b));
const fromBytes = (v) => Buffer.from(Array.from(v, (b) => (b < 0 ? b + 256 : b)));
const FAKE_ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";

function backend({ props = {}, tokeninfo } = {}) {
  const properties = new Map(Object.entries({
    // A leftover property from before Google-only sign-in; it must be ignored.
    ACCESS_KEY: "manager-secret",
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
    MANAGER_EMAILS: "manager@example.com",
    ...props,
  }).filter(([, v]) => v !== null));
  const fetches = [];
  const context = vm.createContext({
    console, Date, JSON, Math,
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => properties.get(k) || null,
      setProperty: (k, v) => properties.set(k, String(v)),
      deleteProperty: (k) => properties.delete(k),
      setProperties: (o) => Object.entries(o).forEach(([k, v]) => properties.set(k, String(v))),
    }) },
    UrlFetchApp: { fetch: (url, opts) => {
      fetches.push({ url, opts });
      const [code, body] = typeof tokeninfo === "function" ? tokeninfo(url) : [200, tokeninfo];
      return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) };
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_a, v) => bytes(crypto.createHash("sha256").update(String(v)).digest()),
      computeHmacSha256Signature: (v, k) => bytes(crypto.createHmac("sha256", String(k)).update(String(v)).digest()),
      base64EncodeWebSafe: (v) => fromBytes(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      base64DecodeWebSafe: (v) => {
        const t = String(v);
        if (t.length % 4 !== 0 || /[^A-Za-z0-9_=-]/.test(t)) throw new Error("Could not decode string.");
        return bytes(Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
      },
      newBlob: (v) => {
        const d = typeof v === "string" ? Buffer.from(v) : fromBytes(v);
        return { getBytes: () => bytes(d), getDataAsString: () => d.toString("utf8") };
      },
    },
  });
  vm.runInContext(fs.readFileSync(new URL("backend/apps-script/Code.gs", root), "utf8"), context);
  return { api: context, properties, fetches };
}

const goodClaims = (over = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, email: "Manager@Example.com", email_verified: "true",
  exp: String(Math.floor(Date.now() / 1000) + 3600), given_name: "Ryan", ...over,
});

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("an allowlisted, verified Google account gets a manager session", () => {
  const { api, fetches } = backend({ tokeninfo: goodClaims() });
  const result = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  assert.equal(result.email, "manager@example.com", "email is normalized to lowercase");
  assert.equal(result.name, "Ryan");
  assert.ok(Date.parse(result.expiresAt) > Date.now() + 11 * 3600e3, "about a 12-hour session");
  assert.match(fetches[0].url, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);
  assert.equal(fetches[0].opts.muteHttpExceptions, true);
  assert.doesNotThrow(() => api.requireAccess_({ managerToken: result.managerToken }), "staff actions");
});

for (const [label, claims, pattern] of [
  ["wrong audience (another app's token)", goodClaims({ aud: "evil.apps.googleusercontent.com" }), /sign-in failed/],
  ["unverified email", goodClaims({ email_verified: "false" }), /sign-in failed/],
  ["wrong issuer", goodClaims({ iss: "https://evil.example" }), /sign-in failed/],
  ["expired token", goodClaims({ exp: String(Math.floor(Date.now() / 1000) - 5) }), /sign-in failed/],
  ["missing email", goodClaims({ email: "" }), /sign-in failed/],
  ["account not on the allowlist", goodClaims({ email: "stranger@gmail.com" }), /stranger@gmail\.com isn't approved/],
]) {
  test(`rejects ${label}`, () => {
    const { api } = backend({ tokeninfo: claims });
    assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), pattern);
  });
}

test("Google rejecting the token (non-200) fails closed", () => {
  const { api } = backend({ tokeninfo: () => [400, { error: "invalid_token" }] });
  assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), /sign-in failed/);
});

test("malformed ID tokens never reach Google", () => {
  const { api, fetches } = backend({ tokeninfo: goodClaims() });
  for (const bad of ["", "not-a-jwt", "a.b", "a.b.c.d", FAKE_ID_TOKEN + "&action=x", "x".repeat(5000)]) {
    assert.throws(() => api.googleLogin_({ idToken: bad }), /sign-in failed/);
  }
  assert.equal(fetches.length, 0);
});

test("not configured → clear message", () => {
  for (const props of [{ GOOGLE_OAUTH_CLIENT_ID: null }, { MANAGER_EMAILS: null }, { MANAGER_EMAILS: " , " }]) {
    const { api } = backend({ props, tokeninfo: goodClaims() });
    assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), /isn't set up yet/);
  }
});

test("a second account can be added with a comma-separated list", () => {
  const { api } = backend({ props: { MANAGER_EMAILS: "manager@example.com, second-manager@gmail.com" },
    tokeninfo: goodClaims({ email: "Second-Manager@gmail.com" }) });
  const result = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  assert.equal(result.email, "second-manager@gmail.com");
  assert.doesNotThrow(() => api.requireAccess_({ managerToken: result.managerToken }));
});

test("the Google name falls back to the full name when there is no first name", () => {
  const { api } = backend({ tokeninfo: goodClaims({ given_name: undefined, name: "Smokey Mike" }) });
  assert.equal(api.googleLogin_({ idToken: FAKE_ID_TOKEN }).name, "Smokey Mike");
});

test("removing an email from MANAGER_EMAILS revokes that session immediately", () => {
  const { api, properties } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  properties.set("MANAGER_EMAILS", "someone-else@gmail.com");
  assert.throws(() => api.requireAccess_({ managerToken }), /expired or was removed/);
});

test("deleting the signing secret signs every device out", () => {
  const { api, properties } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  assert.ok(properties.get("CREW_SIGNING_SECRET"), "secret created on first sign-in");
  properties.delete("CREW_SIGNING_SECRET");
  assert.equal(api.verifyManagerToken_(managerToken), "");
});

test("tampered or expired session tokens are rejected", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  const [payload, sig] = managerToken.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 2, r: "manager", e: "stranger@gmail.com", exp: Date.now() + 1e9, id: "x" }))
    .toString("base64url");
  assert.equal(api.verifyManagerToken_(`${forged}.${sig}`), "", "payload swap breaks the signature");
  assert.equal(api.verifyManagerToken_(`${payload}.${sig.slice(0, -2)}AA`), "");
  const expired = api.issueManagerToken_("manager@example.com", Date.now() - 1);
  assert.equal(api.verifyManagerToken_(expired), "");
});

test("old Crew Pass tokens (v1, same signing key) are not sessions", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const sign = (payload) => {
    const encoded = api.base64UrlText_(JSON.stringify(payload));
    return `${encoded}.${api.signPayload_(encoded)}`;
  };
  const exp = Date.now() + 3600e3;
  const oldCrew = sign({ v: 1, g: 1, exp, id: "x" });
  assert.equal(api.verifyManagerToken_(oldCrew), "");
  assert.equal(api.verifyManagerToken_(sign({ v: 1, r: "manager", e: "manager@example.com", exp })), "");
  assert.equal(api.verifyManagerToken_(sign({ v: 2, r: "crew", e: "manager@example.com", exp })), "");
  assert.throws(() => api.requireAccess_({ managerToken: oldCrew }), /Sign in with Google again/);
});

test("the old access key and crew tokens no longer open anything", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  assert.throws(() => api.requireAccess_({ key: "manager-secret" }), /Please sign in with Google/);
  assert.throws(() => api.requireAccess_({ crewToken: "anything" }), /Please sign in with Google/);
  assert.throws(() => api.requireAccess_({}), /Please sign in with Google/);
  for (const name of ["managerKeyMatches_", "requireManagerAccess_", "createCrewPass_", "redeemCrewPass_", "verifyCrewToken_"]) {
    assert.equal(typeof api[name], "undefined", `${name} is gone`);
  }
});

test("through the web app: key/crew requests are refused, crew actions are gone", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const call = (parameter) => JSON.parse(api.doGet({ parameter }).text);
  for (const parameter of [
    { action: "getAttendees", key: "manager-secret" },
    { action: "getAttendees", crewToken: "x.y" },
    { action: "checkIn", key: "manager-secret", attendeeId: "a" },
  ]) {
    const res = call(parameter);
    assert.equal(res.ok, false);
    assert.match(res.error, /sign in with Google/i);
  }
  for (const action of ["redeemCrewPass", "createCrewPass", "revokeCrewPasses"]) {
    assert.match(call({ action, key: "manager-secret", code: "ABCD-EFGH" }).error, /Unknown action/);
  }
});

test("googleLogin is routed publicly in doGet/doPost", () => {
  const src = fs.readFileSync(new URL("backend/apps-script/Code.gs", root), "utf8");
  assert.match(src, /case "googleLogin":\s*\n(?:\s*\/\/.*\n)*\s*data = googleLogin_\(input\);/);
  assert.doesNotMatch(src, /getProperty\("ACCESS_KEY"\)/, "the access key is never read");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n${err.stack}`);
  }
}
if (failed) {
  console.error(`${failed} Google login test(s) failed.`);
  process.exit(1);
}
console.log(`Google login tests passed (${tests.length}).`);
