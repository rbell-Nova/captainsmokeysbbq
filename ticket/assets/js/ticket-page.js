/**
 * Guest-facing ticket confirmation screen — what a guest sees reopening
 * their link. Rendering is shared with /register's confirmation view via
 * assets/event-ticketing/render-ticket-card.js so the two never drift.
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
 * Wallet buttons are placeholders — see render-ticket-card.js.
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
