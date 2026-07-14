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
  }

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    createMockRepository() {
      return new MockEventAttendeeRepository(ET.MOCK_EVENT, ET.MOCK_ATTENDEES, ET.MOCK_ACTIVITY);
    },
  });
})(window);
