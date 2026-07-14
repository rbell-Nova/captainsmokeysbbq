/**
 * Guest-facing ticket page controller (demo build).
 *
 * Route target is /ticket/[token] once a real backend exists (see
 * design doc section 14): server receives the token, validates it,
 * and returns only guest-safe fields. There is no server here, so this
 * demo reads a mock attendee straight out of the same in-memory
 * repository the staff page uses, looked up by QR token via
 * ?a=<qrToken> (defaults to tk_mock_1002 — see mock-data.js for the
 * full list, tk_mock_1001 through tk_mock_1016). Swap this file's data
 * source for a real fetch('/api/tickets/' + token) once that route
 * exists — everything below this point (rendering) stays the same.
 *
 * QR rendering: uses a public QR image endpoint (api.qrserver.com) purely
 * so the code is actually scannable for testing the staff scanner end to
 * end. Production must NOT do this — real tickets should get a
 * server-rendered/self-hosted QR so the ticket token is never sent to a
 * third party. Replace before launch.
 */
(function () {
  "use strict";

  const ET = window.EventTicketing;
  const repo = ET.createMockRepository();

  const params = new URLSearchParams(window.location.search);
  const qrToken = params.get("a") || "tk_mock_1002";

  const el = (id) => document.getElementById(id);

  const dom = {
    eventName: el("ticketEventName"),
    eventMeta: el("ticketEventMeta"),
    guestName: el("ticketGuestName"),
    ticketNumber: el("ticketNumber"),
    qrImg: el("ticketQrImg"),
    qrFallback: el("ticketQrFallback"),
    adults: el("ticketAdults"),
    children: el("ticketChildren"),
    total: el("ticketTotal"),
    donation: el("ticketDonation"),
    donationNote: el("ticketDonationNote"),
    status: el("ticketStatus"),
    notFound: el("ticketNotFound"),
    card: el("ticketCard"),
  };

  function buildTicketUrl(token) {
    return `https://www.captainsmokeysbbq.com/ticket/${token}`;
  }

  function qrImageUrl(data) {
    const encoded = encodeURIComponent(data);
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encoded}`;
  }

  async function render() {
    const attendee = await repo.findAttendeeByQrToken(qrToken);

    if (!attendee) {
      dom.card.classList.add("hidden");
      dom.notFound.classList.remove("hidden");
      return;
    }

    const event = await repo.getEventDetails();
    const ticketUrl = buildTicketUrl(attendee.qrToken);
    const date = new Date(event.startsAt);
    const dateStr = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const timeStr = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    dom.eventName.textContent = event.name;
    dom.eventMeta.textContent = `${dateStr} · ${timeStr} · ${event.venue}`;
    dom.guestName.textContent = `${attendee.firstName} ${attendee.lastName}`;
    dom.ticketNumber.textContent = `Ticket ${attendee.ticketNumber}`;

    dom.qrImg.src = qrImageUrl(ticketUrl);
    dom.qrImg.alt = `QR code for ticket ${attendee.ticketNumber}`;
    dom.qrFallback.textContent = ticketUrl;

    dom.adults.textContent = attendee.adultCount;
    dom.children.textContent = attendee.childCount;
    dom.total.textContent = attendee.totalGuestCount;

    if (attendee.extraAdultCount > 0) {
      dom.donation.textContent = ET.formatCurrency(attendee.donationAmountCents);
      dom.donationNote.textContent = `First 2 adults included · ${attendee.extraAdultCount} extra adult${attendee.extraAdultCount > 1 ? "s" : ""} at $15 each`;
    } else {
      dom.donation.textContent = "$0.00";
      dom.donationNote.textContent = "Both adults included — no extra-adult donation due.";
    }

    if (attendee.ticketStatus === "checked-in") {
      dom.status.textContent = `Checked in ${ET.formatDateTime(attendee.checkedInAt)}`;
      dom.status.className = "badge badge--checked-in";
    } else if (attendee.ticketStatus === "cancelled" || attendee.ticketStatus === "void") {
      dom.status.textContent = attendee.ticketStatus;
      dom.status.className = "badge badge--cancelled";
    } else {
      dom.status.textContent = "Ready for check-in";
      dom.status.className = "badge badge--ready";
    }
  }

  render();
})();
