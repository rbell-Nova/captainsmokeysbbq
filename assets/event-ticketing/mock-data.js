/**
 * Mock data for the staff check-in page. This stands in for the future
 * Google Sheets / Supabase source — see event-attendee-repository.js for
 * the swap point. Nothing here is fetched from a network; it is fabricated
 * on load and mutated in memory for the duration of the browser session.
 */
(function (global) {
  "use strict";

  const T = global.EventTicketing.calculatePartyTotals;
  const EVENT_ID = "evt_smokey_2026_fall_muster";

  const MOCK_EVENT = {
    id: EVENT_ID,
    name: "Captain Smokey's Fall Muster",
    description: "Annual community cookout and fundraiser.",
    startsAt: "2026-10-17T16:00:00-04:00",
    endsAt: "2026-10-17T20:00:00-04:00",
    venue: "American Legion Post 42",
    address: "118 Harbor Rd, Port Everly",
    registrationDeadline: "2026-10-10T23:59:00-04:00",
    status: "open",
  };

  function makeAttendee(seed) {
    const totals = T(seed.adultCount, seed.childCount);
    return Object.assign(
      {
        id: seed.id,
        eventId: EVENT_ID,
        ticketNumber: seed.ticketNumber,
        qrToken: seed.qrToken,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phoneNumber: seed.phoneNumber,
        phoneLastFour: seed.phoneNumber.replace(/\D/g, "").slice(-4),
        ticketStatus: seed.ticketStatus || "ready",
        deliveryStatus: seed.deliveryStatus || "sent",
        registeredAt: seed.registeredAt,
        checkedInAt: seed.checkedInAt || null,
        checkedInBy: seed.checkedInBy || null,
        checkInStation: seed.checkInStation || null,
        notes: seed.notes || "",
      },
      totals
    );
  }

  const MOCK_ATTENDEES = [
    makeAttendee({ id: "att_001", ticketNumber: "SM-1001", qrToken: "tk_mock_1001", firstName: "Dana", lastName: "Whitfield", phoneNumber: "555-201-4471", adultCount: 2, childCount: 1, ticketStatus: "checked-in", checkedInAt: "2026-10-17T16:12:00-04:00", checkedInBy: "Ryan", checkInStation: "Front Gate", registeredAt: "2026-09-30T10:02:00-04:00" }),
    makeAttendee({ id: "att_002", ticketNumber: "SM-1002", qrToken: "tk_mock_1002", firstName: "Marcus", lastName: "Ibe", phoneNumber: "555-330-9021", adultCount: 3, childCount: 2, ticketStatus: "ready", registeredAt: "2026-09-30T11:14:00-04:00" }),
    makeAttendee({ id: "att_003", ticketNumber: "SM-1003", qrToken: "tk_mock_1003", firstName: "Priya", lastName: "Anand", phoneNumber: "555-118-2290", adultCount: 1, childCount: 0, ticketStatus: "ready", registeredAt: "2026-10-01T09:41:00-04:00" }),
    makeAttendee({ id: "att_004", ticketNumber: "SM-1004", qrToken: "tk_mock_1004", firstName: "Cole", lastName: "Beaumont", phoneNumber: "555-402-7734", adultCount: 4, childCount: 3, ticketStatus: "checked-in", checkedInAt: "2026-10-17T16:20:00-04:00", checkedInBy: "Mike", checkInStation: "Check-in Table 2", registeredAt: "2026-10-01T14:55:00-04:00" }),
    makeAttendee({ id: "att_005", ticketNumber: "SM-1005", qrToken: "tk_mock_1005", firstName: "Sarah", lastName: "Nakamura", phoneNumber: "555-664-1183", adultCount: 2, childCount: 0, ticketStatus: "cancelled", registeredAt: "2026-10-02T08:03:00-04:00", notes: "Guest cancelled by phone 10/12." }),
    makeAttendee({ id: "att_006", ticketNumber: "SM-1006", qrToken: "tk_mock_1006", firstName: "Terrance", lastName: "Boyd", phoneNumber: "555-812-4409", adultCount: 3, childCount: 1, ticketStatus: "ready", deliveryStatus: "failed", registeredAt: "2026-10-02T16:30:00-04:00", notes: "SMS bounced — landline number, needs manual follow-up." }),
    makeAttendee({ id: "att_007", ticketNumber: "SM-1007", qrToken: "tk_mock_1007", firstName: "Yuki", lastName: "Tanaka", phoneNumber: "555-556-2201", adultCount: 2, childCount: 2, ticketStatus: "checked-in", checkedInAt: "2026-10-17T16:31:00-04:00", checkedInBy: "Ryan", checkInStation: "Front Gate", registeredAt: "2026-10-03T12:00:00-04:00" }),
    makeAttendee({ id: "att_008", ticketNumber: "SM-1008", qrToken: "tk_mock_1008", firstName: "Gabriel", lastName: "Ortiz", phoneNumber: "555-990-6612", adultCount: 5, childCount: 0, ticketStatus: "ready", registeredAt: "2026-10-04T09:12:00-04:00" }),
    makeAttendee({ id: "att_009", ticketNumber: "SM-1009", qrToken: "tk_mock_1009", firstName: "Helen", lastName: "Marsh", phoneNumber: "555-227-8834", adultCount: 2, childCount: 4, ticketStatus: "ready", registeredAt: "2026-10-04T18:47:00-04:00" }),
    makeAttendee({ id: "att_010", ticketNumber: "SM-1010", qrToken: "tk_mock_1010", firstName: "Ben", lastName: "Okafor", phoneNumber: "555-771-0043", adultCount: 1, childCount: 1, ticketStatus: "pending", deliveryStatus: "not-sent", registeredAt: "2026-10-05T07:20:00-04:00", notes: "Awaiting disclaimer confirmation email." }),
    makeAttendee({ id: "att_011", ticketNumber: "SM-1011", qrToken: "tk_mock_1011", firstName: "Renee", lastName: "Castillo", phoneNumber: "555-345-9987", adultCount: 2, childCount: 0, ticketStatus: "checked-in", checkedInAt: "2026-10-17T16:40:00-04:00", checkedInBy: "Mike", checkInStation: "Check-in Table 2", registeredAt: "2026-10-05T13:05:00-04:00" }),
    makeAttendee({ id: "att_012", ticketNumber: "SM-1012", qrToken: "tk_mock_1012", firstName: "Owen", lastName: "Pratt", phoneNumber: "555-889-2205", adultCount: 3, childCount: 0, ticketStatus: "ready", registeredAt: "2026-10-06T10:30:00-04:00" }),
    makeAttendee({ id: "att_013", ticketNumber: "SM-1013", qrToken: "tk_mock_1013", firstName: "Alicia", lastName: "Ferreira", phoneNumber: "555-118-6620", adultCount: 2, childCount: 2, ticketStatus: "ready", deliveryStatus: "pending", registeredAt: "2026-10-07T15:55:00-04:00" }),
    makeAttendee({ id: "att_014", ticketNumber: "SM-1014", qrToken: "tk_mock_1014", firstName: "Jamal", lastName: "Reeves", phoneNumber: "555-500-1187", adultCount: 4, childCount: 1, ticketStatus: "ready", registeredAt: "2026-10-08T09:00:00-04:00" }),
    makeAttendee({ id: "att_015", ticketNumber: "SM-1015", qrToken: "tk_mock_1015", firstName: "Nora", lastName: "Kildare", phoneNumber: "555-677-3341", adultCount: 2, childCount: 1, ticketStatus: "void", registeredAt: "2026-10-08T19:22:00-04:00", notes: "Duplicate registration — see SM-1014." }),
    makeAttendee({ id: "att_016", ticketNumber: "SM-1016", qrToken: "tk_mock_1016", firstName: "Victor", lastName: "Salas", phoneNumber: "555-224-9098", adultCount: 2, childCount: 0, ticketStatus: "ready", registeredAt: "2026-10-09T08:41:00-04:00" }),
  ];

  const MOCK_ACTIVITY = [
    { id: "act_001", eventId: EVENT_ID, attendeeId: "att_001", action: "checked-in", staffName: "Ryan", stationName: "Front Gate", createdAt: "2026-10-17T16:12:00-04:00" },
    { id: "act_002", eventId: EVENT_ID, attendeeId: "att_004", action: "checked-in", staffName: "Mike", stationName: "Check-in Table 2", createdAt: "2026-10-17T16:20:00-04:00" },
    { id: "act_003", eventId: EVENT_ID, attendeeId: "att_005", action: "cancelled", staffName: "Ryan", stationName: "Front Gate", createdAt: "2026-10-12T11:05:00-04:00" },
    { id: "act_004", eventId: EVENT_ID, attendeeId: "att_007", action: "checked-in", staffName: "Ryan", stationName: "Front Gate", createdAt: "2026-10-17T16:31:00-04:00" },
    { id: "act_005", eventId: EVENT_ID, attendeeId: "att_011", action: "checked-in", staffName: "Mike", stationName: "Check-in Table 2", createdAt: "2026-10-17T16:40:00-04:00" },
    { id: "act_006", eventId: EVENT_ID, attendeeId: "att_006", action: "ticket-resent", staffName: "Ryan", stationName: "Front Gate", createdAt: "2026-10-15T09:02:00-04:00" },
  ];

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    MOCK_EVENT,
    MOCK_ATTENDEES,
    MOCK_ACTIVITY,
  });
})(window);
