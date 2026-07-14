/**
 * Guest-facing ticket confirmation screen — what a guest sees reopening
 * their link. Rendering is shared with /register's confirmation view via
 * assets/event-ticketing/render-ticket-card.js so the two never drift.
 *
 * Route: /ticket/?a=<token> (query string, not a path segment — this is
 * a static export with no server-side routing, so /ticket/<token> can't
 * resolve to anything). Data comes from EventTicketing.createRepository()
 * — mock data until /assets/event-ticketing/config.js has a deployed
 * Apps Script URL, then the real Google Sheet via the backend's
 * guest-safe "getGuestTicket" action (see /backend/apps-script/Code.gs).
 * No ?a= present falls back to a mock guest for quick testing (try
 * tk_mock_1001 through tk_mock_1016 — see mock-data.js).
 *
 * Wallet buttons are placeholders — see render-ticket-card.js.
 */
(function () {
  "use strict";

  const ET = window.EventTicketing;

  const params = new URLSearchParams(window.location.search);
  const qrToken = params.get("a") || "tk_mock_1002";
  const repo = qrToken.indexOf("tk_mock_") === 0 ? ET.createMockRepository() : ET.createRepository();

  const el = (id) => document.getElementById(id);

  const dom = {
    eventName: el("ticketEventName"),
    eventMeta: el("ticketEventMeta"),
    guestName: el("ticketGuestName"),
    ticketNumber: el("ticketNumber"),
    qrImg: el("ticketQrImg"),
    summaryLine: el("ticketSummaryLine"),
    status: el("ticketStatus"),
  };

  const notFound = el("ticketNotFound");
  const card = el("ticketCard");

  async function render() {
    const attendee = await repo.getGuestTicket(qrToken);

    if (!attendee) {
      card.classList.add("hidden");
      notFound.classList.remove("hidden");
      return;
    }

    const event = await repo.getEventDetails();
    ET.renderTicketCard(dom, ET, event, attendee, qrToken);
  }

  ET.wireWalletPlaceholders(el("appleWalletBtn"), el("googleWalletBtn"));

  render();
})();
