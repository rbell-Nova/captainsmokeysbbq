/**
 * EventAttendeeRepository — the single seam the UI talks to for attendee
 * data. Everything in check-in-app.js goes through this interface, never
 * touching MOCK_ATTENDEES directly, so the future data source can be
 * swapped in without touching any UI code:
 *
 *   getEventDetails()
 *   getAttendees()
 *   getRecentActivity()
 *   findAttendeeByQrToken(token)
 *   searchAttendees(query)
 *   checkInAttendee(attendeeId, staffName, stationName)
 *   undoCheckIn(attendeeId, staffName, stationName)
 *   cancelTicket(attendeeId, staffName, stationName)
 *   updateNotes(attendeeId, notes, staffName, stationName)
 *
 * FUTURE INTEGRATION POINT: a server-backed implementation
 * (google-sheets-event-attendee-repository.js today's equivalent of, or a
 * real fetch()-based repository once Next.js API routes exist) should
 * implement this exact same interface and be dropped in in-place of
 * MockEventAttendeeRepository below. It must run its actual data access
 * server-side — this mock is client-side only because there is no
 * server in this repo yet, and that is NOT how the production version may
 * work (see section 18 of the system design doc: no credentials in the
 * browser, atomic server-side check-in writes).
 */
(function (global) {
  "use strict";

  const ET = global.EventTicketing;

  function simulateLatency(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 220));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function matchesQuery(attendee, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      attendee.ticketNumber.toLowerCase().includes(q) ||
      attendee.qrToken.toLowerCase().includes(q) ||
      attendee.firstName.toLowerCase().includes(q) ||
      attendee.lastName.toLowerCase().includes(q) ||
      `${attendee.firstName} ${attendee.lastName}`.toLowerCase().includes(q) ||
      attendee.phoneLastFour.includes(q)
    );
  }

  class MockEventAttendeeRepository {
    constructor(event, attendees, activity) {
      this._event = event;
      this._attendees = attendees;
      this._activity = activity;
    }

    async getEventDetails() {
      await simulateLatency();
      return Object.assign({}, this._event);
    }

    async getAttendees() {
      await simulateLatency();
      return this._attendees.map((a) => Object.assign({}, a));
    }

    async getRecentActivity() {
      await simulateLatency(150);
      return this._activity
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((a) => Object.assign({}, a));
    }

    async findAttendeeByQrToken(token) {
      await simulateLatency(180);
      const clean = String(token || "").trim();
      const found = this._attendees.find((a) => a.qrToken === clean || a.ticketNumber === clean);
      return found ? Object.assign({}, found) : null;
    }

    async searchAttendees(query) {
      await simulateLatency(150);
      return this._attendees.filter((a) => matchesQuery(a, query)).map((a) => Object.assign({}, a));
    }

    /**
     * Mirrors the atomic server update described in the design doc:
     * "only update where checkedInAt is null and ticketStatus is ready".
     * In a real backend this is a single conditional SQL UPDATE; here it's
     * a guarded in-memory mutation so the UI logic can be written once and
     * carried over unchanged.
     */
    async checkInAttendee(attendeeId, staffName, stationName) {
      await simulateLatency();
      const attendee = this._attendees.find((a) => a.id === attendeeId);
      if (!attendee) {
        return { ok: false, reason: "not-found" };
      }
      if (attendee.ticketStatus === "cancelled" || attendee.ticketStatus === "void") {
        return { ok: false, reason: attendee.ticketStatus, attendee: Object.assign({}, attendee) };
      }
      if (attendee.checkedInAt) {
        return { ok: false, reason: "already-checked-in", attendee: Object.assign({}, attendee) };
      }

      attendee.ticketStatus = "checked-in";
      attendee.checkedInAt = nowIso();
      attendee.checkedInBy = staffName;
      attendee.checkInStation = stationName;

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "checked-in",
        staffName,
        stationName,
        createdAt: nowIso(),
      });

      return { ok: true, attendee: Object.assign({}, attendee) };
    }

    async undoCheckIn(attendeeId, staffName, stationName) {
      await simulateLatency();
      const attendee = this._attendees.find((a) => a.id === attendeeId);
      if (!attendee) return { ok: false, reason: "not-found" };
      if (!attendee.checkedInAt) return { ok: false, reason: "not-checked-in", attendee: Object.assign({}, attendee) };

      attendee.ticketStatus = "ready";
      attendee.checkedInAt = null;
      attendee.checkedInBy = null;
      attendee.checkInStation = null;

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "check-in-undone",
        staffName,
        stationName,
        createdAt: nowIso(),
      });

      return { ok: true, attendee: Object.assign({}, attendee) };
    }

    async cancelTicket(attendeeId, staffName, stationName) {
      await simulateLatency();
      const attendee = this._attendees.find((a) => a.id === attendeeId);
      if (!attendee) return { ok: false, reason: "not-found" };

      attendee.ticketStatus = "cancelled";

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "cancelled",
        staffName,
        stationName,
        createdAt: nowIso(),
      });

      return { ok: true, attendee: Object.assign({}, attendee) };
    }

    async updateNotes(attendeeId, notes, staffName, stationName) {
      await simulateLatency(150);
      const attendee = this._attendees.find((a) => a.id === attendeeId);
      if (!attendee) return { ok: false, reason: "not-found" };

      attendee.notes = notes;

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "note-updated",
        staffName,
        stationName,
        createdAt: nowIso(),
      });

      return { ok: true, attendee: Object.assign({}, attendee) };
    }

    async registerAttendee(fields) {
      await simulateLatency();

      const firstName = String(fields.firstName || "").trim();
      const lastName = String(fields.lastName || "").trim();
      const phoneNumber = String(fields.phoneNumber || "").trim();
      const adultCount = Number(fields.adultCount) || 0;
      const childCount = Number(fields.childCount) || 0;

      if (!firstName || !lastName) throw new Error("First and last name are required.");
      if (!phoneNumber) throw new Error("Phone number is required.");
      if (adultCount + childCount <= 0) throw new Error("Party must include at least one guest.");

      const totals = ET.calculatePartyTotals(adultCount, childCount);
      const token = `tk_mock_${Date.now()}`;
      const id = `att_${Date.now()}`;
      const ticketNumber = `SM-${1000 + this._attendees.length + 1}`;

      const attendee = Object.assign(
        {
          id,
          eventId: this._event.id,
          ticketNumber,
          qrToken: token,
          firstName,
          lastName,
          phoneNumber,
          phoneLastFour: phoneNumber.replace(/\D/g, "").slice(-4),
          ticketStatus: "ready",
          deliveryStatus: "not-sent",
          registeredAt: nowIso(),
          checkedInAt: null,
          checkedInBy: null,
          checkInStation: null,
          notes: fields.notes || "",
        },
        totals
      );

      this._attendees.push(attendee);

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "registered",
        staffName: fields.staffName || "",
        stationName: fields.stationName || "",
        createdAt: nowIso(),
      });

      return Object.assign({}, attendee, {
        ticketUrl: `https://www.captainsmokeysbbq.com/ticket/${token}`,
        smsSent: false,
      });
    }

    async getGuestTicket(token) {
      const attendee = await this.findAttendeeByQrToken(token);
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
        checkedInAt: attendee.checkedInAt,
      };
    }

    async resendTicket(attendeeId, staffName, stationName) {
      await simulateLatency();
      const attendee = this._attendees.find((a) => a.id === attendeeId);
      if (!attendee) return { ok: false, reason: "not-found" };

      const token = `tk_mock_${Date.now()}`;
      attendee.qrToken = token;

      this._activity.push({
        id: `act_${Date.now()}`,
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        action: "ticket-resent",
        staffName,
        stationName,
        createdAt: nowIso(),
      });

      return {
        ok: true,
        attendee: Object.assign({}, attendee, {
          ticketUrl: `https://www.captainsmokeysbbq.com/ticket/${token}`,
          smsSent: false,
        }),
      };
    }
  }

  /**
   * Real implementation — talks to the Apps Script Web App backend in
   * /backend/apps-script/Code.gs over fetch(). Implements the exact same
   * method set as MockEventAttendeeRepository above, so check-in-app.js
   * and ticket-page.js never need to know which one they're using.
   *
   * getAccessKey is a function (not a static value) so the caller can
   * pull the current value out of localStorage on every request, since
   * staff can update it without reloading the page.
   */
  class AppsScriptEventAttendeeRepository {
    constructor(baseUrl, getAccessKey) {
      this.baseUrl = baseUrl;
      this.getAccessKey = getAccessKey || (() => "");
    }

    async _call(action, params, method) {
      const key = this.getAccessKey() || "";
      let response;

      if (method === "POST") {
        response = await fetch(this.baseUrl, {
          method: "POST",
          body: JSON.stringify(Object.assign({ action, key }, params || {})),
        });
      } else {
        const url = new URL(this.baseUrl);
        url.searchParams.set("action", action);
        if (key) url.searchParams.set("key", key);
        Object.entries(params || {}).forEach(([k, v]) => {
          if (v !== undefined && v !== null) url.searchParams.set(k, v);
        });
        response = await fetch(url.toString());
      }

      const json = await response.json();
      if (!json.ok) throw new Error(json.error || "Request to the event backend failed.");
      return json.data;
    }

    async getEventDetails() { return this._call("getEvent"); }
    async getAttendees() { return this._call("getAttendees"); }
    async getRecentActivity() { return this._call("getActivity"); }
    async getGuestTicket(token) { return this._call("getGuestTicket", { token }); }
    async findAttendeeByQrToken(token) { return this._call("findByToken", { token }); }
    async searchAttendees(query) { return this._call("search", { q: query }); }
    async registerAttendee(fields) { return this._call("register", fields, "POST"); }

    async checkInAttendee(attendeeId, staffName, stationName) {
      return this._call("checkIn", { attendeeId, staffName, stationName }, "POST");
    }

    async undoCheckIn(attendeeId, staffName, stationName) {
      return this._call("undoCheckIn", { attendeeId, staffName, stationName }, "POST");
    }

    async cancelTicket(attendeeId, staffName, stationName) {
      return this._call("cancelTicket", { attendeeId, staffName, stationName }, "POST");
    }

    async updateNotes(attendeeId, notes, staffName, stationName) {
      return this._call("updateNotes", { attendeeId, notes, staffName, stationName }, "POST");
    }

    async resendTicket(attendeeId, staffName, stationName) {
      return this._call("resendTicket", { attendeeId, staffName, stationName }, "POST");
    }
  }

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    createMockRepository() {
      return new MockEventAttendeeRepository(ET.MOCK_EVENT, ET.MOCK_ATTENDEES, ET.MOCK_ACTIVITY);
    },

    createAppsScriptRepository(baseUrl, getAccessKey) {
      return new AppsScriptEventAttendeeRepository(baseUrl, getAccessKey);
    },

    /**
     * Picks the real backend when it's configured (see config.js),
     * otherwise falls back to the mock so every page keeps working
     * before the Apps Script backend is deployed.
     */
    createRepository() {
      const url = (global.EventTicketing.CONFIG || {}).APPS_SCRIPT_URL;
      if (url) {
        return new AppsScriptEventAttendeeRepository(url, () => localStorage.getItem("staffCheckIn.accessKey") || "");
      }
      return new MockEventAttendeeRepository(ET.MOCK_EVENT, ET.MOCK_ATTENDEES, ET.MOCK_ACTIVITY);
    },
  });
})(window);
