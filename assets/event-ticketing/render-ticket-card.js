/**
 * Shared ticket-card rendering, used by both /ticket/demo (a guest
 * reopening their link) and /register's confirmation screen (right after
 * they sign themselves up). Keeping this in one place is what keeps the
 * two screens from visually drifting apart — same card, same data, two
 * different entry points.
 *
 * Expects a `dom` object with: eventName, eventMeta, guestName,
 * ticketNumber, qrImg, summaryLine, and (optional) status.
 */
(function (global) {
  "use strict";

  function buildTicketUrl(token) {
    return `https://www.captainsmokeysbbq.com/ticket/${token}`;
  }

  function qrImageUrl(data) {
    const encoded = encodeURIComponent(data);
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encoded}`;
  }

  function renderTicketCard(dom, ET, event, attendee, token) {
    const ticketUrl = buildTicketUrl(token);
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

    if (dom.status) {
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

    return ticketUrl;
  }

  function wireWalletPlaceholders(appleBtn, googleBtn) {
    if (appleBtn) {
      appleBtn.addEventListener("click", () => {
        appleBtn.disabled = true;
        appleBtn.textContent = "Apple Wallet — coming soon";
      });
    }
    if (googleBtn) {
      googleBtn.addEventListener("click", () => {
        googleBtn.disabled = true;
        googleBtn.textContent = "Google Wallet — coming soon";
      });
    }
  }

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    renderTicketCard,
    wireWalletPlaceholders,
    buildTicketUrl,
    qrImageUrl,
  });
})(window);
