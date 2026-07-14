/**
 * Guest-facing ticket confirmation screen.
 *
 * Route target is /ticket/[token]. Data comes from
 * EventTicketing.createRepository() — mock data until
 * /assets/event-ticketing/config.js has a deployed Apps Script URL, then
 * the real Google Sheet via the backend's guest-safe "getGuestTicket"
 * action (see /backend/apps-script/Code.gs). Token is read from the URL:
 * this demo route takes it as ?a=<qrToken> (try tk_mock_1001 through
 * tk_mock_1016 — see mock-data.js) since there's no per-token dynamic
 * routing on a static export; a real deploy would put it in the path.
 *
 * QR rendering: uses a public QR image endpoint (api.qrserver.com) purely
 * so the code is actually scannable for testing the staff scanner end to
 * end. Production must NOT do this — real tickets should get a
 * server-rendered/self-hosted QR so the ticket token is never sent to a
 * third party. Replace before launch.
 *
 * Apple Wallet: the button below is a placeholder. A real .pkpass needs
 * an Apple Developer Program membership, a Pass Type ID certificate, and
 * somewhere capable of PKCS#7 signing — Apps Script can't do that part,
 * so this will need its own small server function once the certificate
 * side is sorted out. See event-ticketing-feature notes.
 */
(function () {
  "use strict";

  const ET = window.EventTicketing;
  const repo = ET.createRepository();

  const params = new URLSearchParams(window.location.search);
  const qrToken = params.get("a") || "tk_mock_1002";

  const el = (id) => document.getElementById(id);

  const dom = {
    eventName: el("ticketEventName"),
    eventMeta: el("ticketEventMeta"),
    guestName: el("ticketGuestName"),
    ticketNumber: el("ticketNumber"),
    qrImg: el("ticketQrImg"),
    summaryLine: el("ticketSummaryLine"),
    status: el("ticketStatus"),
    notFound: el("ticketNotFound"),
    card: el("ticketCard"),
    appleWalletBtn: el("appleWalletBtn"),
  };

  function buildTicketUrl(token) {
    return `https://www.captainsmokeysbbq.com/ticket/${token}`;
  }

  function qrImageUrl(data) {
    const encoded = encodeURIComponent(data);
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encoded}`;
  }

  async function render() {
    const attendee = await repo.getGuestTicket(qrToken);

    if (!attendee) {
      dom.card.classList.add("hidden");
      dom.notFound.classList.remove("hidden");
      return;
    }

    const event = await repo.getEventDetails();
    const ticketUrl = buildTicketUrl(qrToken);
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

    const guestWord = attendee.totalGuestCount === 1 ? "guest" : "guests";
    dom.summaryLine.textContent =
      attendee.donationAmountCents > 0
        ? `${attendee.totalGuestCount} ${guestWord} · ${ET.formatCurrency(attendee.donationAmountCents)} donation due at check-in`
        : `${attendee.totalGuestCount} ${guestWord} · no donation due`;

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

  dom.appleWalletBtn.addEventListener("click", () => {
    dom.appleWalletBtn.disabled = true;
    dom.appleWalletBtn.textContent = "Apple Wallet — coming soon";
  });

  render();
})();
