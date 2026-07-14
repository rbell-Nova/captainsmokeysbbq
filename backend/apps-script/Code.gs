/**
 * Captain Smokey's BBQ — event ticketing backend.
 *
 * This is NOT part of the deployed website. It's a Google Apps Script
 * project you deploy separately, bound to a Google Sheet, which then acts
 * as a free, self-contained REST-ish API + database for the staff
 * check-in page and the admin registration page. See DEPLOYMENT STEPS
 * below — I (the assistant) have no way to create or deploy this myself,
 * you have to do this part in your own Google account.
 *
 * ============================ DEPLOYMENT STEPS ============================
 * 1. Go to sheets.google.com, create a new blank spreadsheet. Name it
 *    something like "Captain Smokey's Event Tickets". This sheet is now
 *    your database — leave it empty, this script creates its own tabs.
 *
 * 2. In that sheet: Extensions -> Apps Script. Delete the placeholder
 *    code in Code.gs and paste this entire file in its place. Save
 *    (the project will ask you to name it — anything is fine).
 *
 * 3. Set your access key (this gates every staff/admin action — anyone
 *    without it can't read attendee data or check anyone in):
 *      - In the Apps Script editor, click the gear icon (Project Settings)
 *        on the left, or go to Project Settings -> Script Properties.
 *      - Add a property: key = ACCESS_KEY, value = some long random
 *        string you make up (this is effectively your staff password —
 *        treat it like one; don't put it in any file that gets committed
 *        to GitHub).
 *
 * 4. (Optional, later) To turn on real SMS, add three more Script
 *    Properties once you have a Twilio account:
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *    Until all three are set, sendSmsIfConfigured_() below silently does
 *    nothing and tickets are created with deliveryStatus "not-sent" —
 *    nothing breaks, SMS just doesn't go out yet.
 *
 * 5. Deploy -> New deployment -> select type "Web app".
 *      - Description: anything.
 *      - Execute as: Me.
 *      - Who has access: Anyone.
 *    Click Deploy, authorize the permissions it asks for (this is your
 *    own script touching your own sheet — normal to see a warning screen
 *    for a personal project, click through "Advanced" -> "Go to project").
 *    Copy the Web App URL it gives you (ends in /exec) and send it to me
 *    — I'll drop it into assets/event-ticketing/config.js on the site.
 *
 * 6. Whenever you edit this script later, you must create a NEW
 *    deployment version (Deploy -> Manage deployments -> edit -> new
 *    version) for changes to take effect on the live URL.
 * ===========================================================================
 */

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

var SHEET_TICKETS = "Tickets";
var SHEET_ACTIVITY = "Activity";

var EVENT = {
  id: "evt_smokey_2026_fall_muster",
  name: "Captain Smokey's Fall Muster",
  description: "Annual community cookout and fundraiser.",
  startsAt: "2026-10-17T16:00:00-04:00",
  endsAt: "2026-10-17T20:00:00-04:00",
  venue: "American Legion Post 42",
  address: "118 Harbor Rd, Port Everly",
  status: "open",
};

var TICKET_URL_BASE = "https://www.captainsmokeysbbq.com/ticket/";

var TICKET_HEADERS = [
  "id", "ticketNumber", "qrTokenHash", "firstName", "lastName", "phoneNumber",
  "phoneLastFour", "adultCount", "childCount", "totalGuestCount",
  "includedAdultCount", "extraAdultCount", "donationAmountCents",
  "ticketStatus", "deliveryStatus", "registeredAt", "checkedInAt",
  "checkedInBy", "checkInStation", "notes",
];

var ACTIVITY_HEADERS = ["id", "attendeeId", "action", "staffName", "stationName", "createdAt"];

// ---------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (parseErr) { body = {}; }
    }
    var input = {};
    for (var k in params) input[k] = params[k];
    for (var k2 in body) input[k2] = body[k2];

    var action = String(input.action || "").trim();
    var data;

    switch (action) {
      case "getEvent":
        data = EVENT;
        break;
      case "getAttendees":
        requireAccess_(input);
        data = getAttendees_();
        break;
      case "getActivity":
        requireAccess_(input);
        data = getActivity_();
        break;
      case "getGuestTicket":
        data = getGuestTicket_(input.token);
        break;
      case "findByToken":
        requireAccess_(input);
        data = findAttendeeByToken_(input.token);
        break;
      case "search":
        requireAccess_(input);
        data = searchAttendees_(input.q || "");
        break;
      case "register":
        requireAccess_(input);
        data = registerAttendee_(input);
        break;
      case "checkIn":
        requireAccess_(input);
        data = checkInAttendee_(input.attendeeId, input.staffName, input.stationName);
        break;
      case "undoCheckIn":
        requireAccess_(input);
        data = undoCheckIn_(input.attendeeId, input.staffName, input.stationName);
        break;
      case "cancelTicket":
        requireAccess_(input);
        data = cancelTicket_(input.attendeeId, input.staffName, input.stationName);
        break;
      case "updateNotes":
        requireAccess_(input);
        data = updateNotes_(input.attendeeId, input.notes, input.staffName, input.stationName);
        break;
      case "resendTicket":
        requireAccess_(input);
        data = resendTicket_(input.attendeeId, input.staffName, input.stationName);
        break;
      default:
        throw new Error("Unknown action: " + action);
    }

    return respond_({ ok: true, data: data });
  } catch (err) {
    return respond_({ ok: false, error: String((err && err.message) || err) });
  }
}

function respond_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function requireAccess_(input) {
  var expected = PropertiesService.getScriptProperties().getProperty("ACCESS_KEY");
  if (!expected) throw new Error("Server misconfigured: ACCESS_KEY script property is not set.");
  if (String(input.key || "") !== expected) throw new Error("Invalid or missing access key.");
}

// ---------------------------------------------------------------------
// Sheet plumbing
// ---------------------------------------------------------------------

function getTicketsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TICKETS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TICKETS);
    sheet.appendRow(TICKET_HEADERS);
    sheet.setFrozenRows(1);
    // Force these columns to plain text so Sheets doesn't "helpfully"
    // convert digit-only values to numbers and strip leading zeros —
    // e.g. a phoneLastFour of "0123" silently becoming 123.
    ["phoneNumber", "phoneLastFour"].forEach(function (h) {
      var col = TICKET_HEADERS.indexOf(h) + 1;
      sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat("@");
    });
  }
  return sheet;
}

function getActivitySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ACTIVITY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ACTIVITY);
    sheet.appendRow(ACTIVITY_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readAllRows_(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowIndexById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +2: skip header, 1-indexed
  }
  return -1;
}

function attendeeToRowArray_(attendee) {
  return TICKET_HEADERS.map(function (h) {
    var v = attendee[h];
    return v === undefined || v === null ? "" : v;
  });
}

// ---------------------------------------------------------------------
// Calculation (mirrors assets/event-ticketing/utils.js — keep in sync)
// ---------------------------------------------------------------------

function calculatePartyTotals_(adultCount, childCount) {
  var adults = Math.max(0, Number(adultCount) || 0);
  var children = Math.max(0, Number(childCount) || 0);
  var includedAdultCount = Math.min(adults, 2);
  var extraAdultCount = Math.max(adults - 2, 0);
  var donationAmountCents = extraAdultCount * 1500;
  var totalGuestCount = adults + children;
  return {
    adultCount: adults,
    childCount: children,
    includedAdultCount: includedAdultCount,
    extraAdultCount: extraAdultCount,
    donationAmountCents: donationAmountCents,
    totalGuestCount: totalGuestCount,
  };
}

// ---------------------------------------------------------------------
// Tokens — raw token is only ever returned to the caller at
// register/resend time; the sheet stores a SHA-256 hash, never the raw
// value, so reading the sheet directly can't produce a working ticket link.
// ---------------------------------------------------------------------

function generateToken_() {
  return "tk_" + Utilities.getUuid().replace(/-/g, "");
}

function hashToken_(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || ""));
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    var hex = v.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

function getAttendees_() {
  var sheet = getTicketsSheet_();
  var rows = readAllRows_(sheet, TICKET_HEADERS);
  return rows.map(stripHash_);
}

function getActivity_() {
  var sheet = getActivitySheet_();
  var rows = readAllRows_(sheet, ACTIVITY_HEADERS);
  return rows.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function stripHash_(attendee) {
  var copy = {};
  for (var k in attendee) copy[k] = attendee[k];
  delete copy.qrTokenHash;
  // Defensive: even with the "@" text format set on these columns (see
  // getTicketsSheet_), coerce back to a zero-padded 4-digit string in
  // case a cell ever ends up holding a bare number (e.g. rows created
  // before that formatting was applied).
  if (copy.phoneLastFour !== undefined && copy.phoneLastFour !== "") {
    copy.phoneLastFour = String(copy.phoneLastFour).padStart(4, "0");
  }
  copy.phoneNumber = String(copy.phoneNumber || "");
  return copy;
}

function findAttendeeRowByHash_(sheet, tokenHash) {
  var rows = readAllRows_(sheet, TICKET_HEADERS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].qrTokenHash === tokenHash) return rows[i];
  }
  return null;
}

function findAttendeeByToken_(token) {
  var sheet = getTicketsSheet_();
  var attendee = findAttendeeRowByHash_(sheet, hashToken_(token));
  return attendee ? stripHash_(attendee) : null;
}

// Guest-facing lookup: only the fields a guest is allowed to see.
function getGuestTicket_(token) {
  var attendee = findAttendeeByToken_(token);
  if (!attendee) return null;
  return {
    ticketNumber: attendee.ticketNumber,
    firstName: attendee.firstName,
    lastName: attendee.lastName,
    adultCount: attendee.adultCount,
    childCount: attendee.childCount,
    totalGuestCount: attendee.totalGuestCount,
    includedAdultCount: attendee.includedAdultCount,
    extraAdultCount: attendee.extraAdultCount,
    donationAmountCents: attendee.donationAmountCents,
    ticketStatus: attendee.ticketStatus,
    checkedInAt: attendee.checkedInAt || null,
  };
}

function searchAttendees_(query) {
  var q = String(query || "").trim().toLowerCase();
  var attendees = getAttendees_();
  if (!q) return attendees;
  return attendees.filter(function (a) {
    return (
      String(a.ticketNumber).toLowerCase().indexOf(q) !== -1 ||
      (a.firstName + " " + a.lastName).toLowerCase().indexOf(q) !== -1 ||
      String(a.phoneLastFour).indexOf(q) !== -1
    );
  });
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

function registerAttendee_(input) {
  var firstName = String(input.firstName || "").trim();
  var lastName = String(input.lastName || "").trim();
  var phoneNumber = String(input.phoneNumber || "").trim();
  var adultCount = parseInt(input.adultCount, 10) || 0;
  var childCount = parseInt(input.childCount, 10) || 0;

  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!phoneNumber) throw new Error("Phone number is required.");
  if (adultCount + childCount <= 0) throw new Error("Party must include at least one guest.");

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getTicketsSheet_();
    var totals = calculatePartyTotals_(adultCount, childCount);
    var token = generateToken_();
    var id = "att_" + Utilities.getUuid();
    var ticketNumber = "SM-" + (1000 + sheet.getLastRow());
    var now = new Date().toISOString();

    var attendee = {
      id: id,
      ticketNumber: ticketNumber,
      qrTokenHash: hashToken_(token),
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      phoneLastFour: phoneNumber.replace(/\D/g, "").slice(-4),
      adultCount: totals.adultCount,
      childCount: totals.childCount,
      totalGuestCount: totals.totalGuestCount,
      includedAdultCount: totals.includedAdultCount,
      extraAdultCount: totals.extraAdultCount,
      donationAmountCents: totals.donationAmountCents,
      ticketStatus: "ready",
      deliveryStatus: "not-sent",
      registeredAt: now,
      checkedInAt: "",
      checkedInBy: "",
      checkInStation: "",
      notes: String(input.notes || ""),
    };

    sheet.appendRow(attendeeToRowArray_(attendee));

    var ticketUrl = TICKET_URL_BASE + token;
    var smsResult = sendSmsIfConfigured_(attendee, ticketUrl);
    if (smsResult.sent) {
      attendee.deliveryStatus = "sent";
      var rowIndex = findRowIndexById_(sheet, id);
      sheet.getRange(rowIndex, TICKET_HEADERS.indexOf("deliveryStatus") + 1).setValue("sent");
    }

    logActivity_(id, "registered", input.staffName, input.stationName);

    var result = stripHash_(attendee);
    result.qrToken = token;
    result.ticketUrl = ticketUrl;
    result.smsSent = smsResult.sent;
    return result;
  } finally {
    lock.releaseLock();
  }
}

function checkInAttendee_(attendeeId, staffName, stationName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getTicketsSheet_();
    var rowIndex = findRowIndexById_(sheet, attendeeId);
    if (rowIndex === -1) return { ok: false, reason: "not-found" };

    var row = sheet.getRange(rowIndex, 1, 1, TICKET_HEADERS.length).getValues()[0];
    var attendee = rowArrayToObject_(row);

    if (attendee.ticketStatus === "cancelled" || attendee.ticketStatus === "void") {
      return { ok: false, reason: attendee.ticketStatus, attendee: stripHash_(attendee) };
    }
    if (attendee.checkedInAt) {
      return { ok: false, reason: "already-checked-in", attendee: stripHash_(attendee) };
    }

    var now = new Date().toISOString();
    setCell_(sheet, rowIndex, "ticketStatus", "checked-in");
    setCell_(sheet, rowIndex, "checkedInAt", now);
    setCell_(sheet, rowIndex, "checkedInBy", staffName || "");
    setCell_(sheet, rowIndex, "checkInStation", stationName || "");

    attendee.ticketStatus = "checked-in";
    attendee.checkedInAt = now;
    attendee.checkedInBy = staffName || "";
    attendee.checkInStation = stationName || "";

    logActivity_(attendeeId, "checked-in", staffName, stationName);
    return { ok: true, attendee: stripHash_(attendee) };
  } finally {
    lock.releaseLock();
  }
}

function undoCheckIn_(attendeeId, staffName, stationName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getTicketsSheet_();
    var rowIndex = findRowIndexById_(sheet, attendeeId);
    if (rowIndex === -1) return { ok: false, reason: "not-found" };

    var row = sheet.getRange(rowIndex, 1, 1, TICKET_HEADERS.length).getValues()[0];
    var attendee = rowArrayToObject_(row);
    if (!attendee.checkedInAt) return { ok: false, reason: "not-checked-in", attendee: stripHash_(attendee) };

    setCell_(sheet, rowIndex, "ticketStatus", "ready");
    setCell_(sheet, rowIndex, "checkedInAt", "");
    setCell_(sheet, rowIndex, "checkedInBy", "");
    setCell_(sheet, rowIndex, "checkInStation", "");

    attendee.ticketStatus = "ready";
    attendee.checkedInAt = "";
    attendee.checkedInBy = "";
    attendee.checkInStation = "";

    logActivity_(attendeeId, "check-in-undone", staffName, stationName);
    return { ok: true, attendee: stripHash_(attendee) };
  } finally {
    lock.releaseLock();
  }
}

function cancelTicket_(attendeeId, staffName, stationName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getTicketsSheet_();
    var rowIndex = findRowIndexById_(sheet, attendeeId);
    if (rowIndex === -1) return { ok: false, reason: "not-found" };

    setCell_(sheet, rowIndex, "ticketStatus", "cancelled");
    var row = sheet.getRange(rowIndex, 1, 1, TICKET_HEADERS.length).getValues()[0];
    var attendee = rowArrayToObject_(row);
    attendee.ticketStatus = "cancelled";

    logActivity_(attendeeId, "cancelled", staffName, stationName);
    return { ok: true, attendee: stripHash_(attendee) };
  } finally {
    lock.releaseLock();
  }
}

function updateNotes_(attendeeId, notes, staffName, stationName) {
  var sheet = getTicketsSheet_();
  var rowIndex = findRowIndexById_(sheet, attendeeId);
  if (rowIndex === -1) return { ok: false, reason: "not-found" };

  setCell_(sheet, rowIndex, "notes", String(notes || ""));
  var row = sheet.getRange(rowIndex, 1, 1, TICKET_HEADERS.length).getValues()[0];
  var attendee = rowArrayToObject_(row);

  logActivity_(attendeeId, "note-updated", staffName, stationName);
  return { ok: true, attendee: stripHash_(attendee) };
}

// Mints a NEW token (old link stops working) — matches design doc
// guidance that resend should not reuse a token stored anywhere raw.
function resendTicket_(attendeeId, staffName, stationName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getTicketsSheet_();
    var rowIndex = findRowIndexById_(sheet, attendeeId);
    if (rowIndex === -1) return { ok: false, reason: "not-found" };

    var token = generateToken_();
    setCell_(sheet, rowIndex, "qrTokenHash", hashToken_(token));

    var row = sheet.getRange(rowIndex, 1, 1, TICKET_HEADERS.length).getValues()[0];
    var attendee = rowArrayToObject_(row);
    var ticketUrl = TICKET_URL_BASE + token;

    var smsResult = sendSmsIfConfigured_(attendee, ticketUrl);
    setCell_(sheet, rowIndex, "deliveryStatus", smsResult.sent ? "sent" : "not-sent");

    logActivity_(attendeeId, "ticket-resent", staffName, stationName);

    var result = stripHash_(attendee);
    result.qrToken = token;
    result.ticketUrl = ticketUrl;
    result.smsSent = smsResult.sent;
    return { ok: true, attendee: result };
  } finally {
    lock.releaseLock();
  }
}

function setCell_(sheet, rowIndex, headerName, value) {
  var col = TICKET_HEADERS.indexOf(headerName) + 1;
  sheet.getRange(rowIndex, col).setValue(value);
}

function rowArrayToObject_(row) {
  var obj = {};
  TICKET_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
  return obj;
}

function logActivity_(attendeeId, action, staffName, stationName) {
  var sheet = getActivitySheet_();
  sheet.appendRow([
    "act_" + Utilities.getUuid(),
    attendeeId,
    action,
    staffName || "",
    stationName || "",
    new Date().toISOString(),
  ]);
}

// ---------------------------------------------------------------------
// SMS — inert until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
// TWILIO_FROM_NUMBER are all set as Script Properties. No cost, no
// external calls happen until you add real Twilio credentials.
// ---------------------------------------------------------------------

function sendSmsIfConfigured_(attendee, ticketUrl) {
  var props = PropertiesService.getScriptProperties();
  var sid = props.getProperty("TWILIO_ACCOUNT_SID");
  var token = props.getProperty("TWILIO_AUTH_TOKEN");
  var from = props.getProperty("TWILIO_FROM_NUMBER");

  if (!sid || !token || !from) {
    return { sent: false, reason: "sms-not-configured" };
  }

  var message =
    "Hey " + attendee.firstName + "! Your Captain Smokey's BBQ ticket is ready: " +
    ticketUrl + " — see you there!";

  var url = "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json";
  var payload = {
    To: normalizePhoneForTwilio_(attendee.phoneNumber),
    From: from,
    Body: message,
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      payload: payload,
      headers: { Authorization: "Basic " + Utilities.base64Encode(sid + ":" + token) },
      muteHttpExceptions: true,
    });
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return { sent: true };
    return { sent: false, reason: "twilio-error-" + status, body: response.getContentText() };
  } catch (err) {
    return { sent: false, reason: "twilio-exception", error: String(err) };
  }
}

function normalizePhoneForTwilio_(phoneNumber) {
  var digits = String(phoneNumber || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.charAt(0) === "1") return "+" + digits;
  return "+" + digits;
}
