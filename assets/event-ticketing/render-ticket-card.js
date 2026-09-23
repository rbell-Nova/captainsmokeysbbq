/**
 * Shared ticket-card rendering, used by both /ticket (a guest reopening
 * their link) and /register's confirmation screen (right after they
 * sign themselves up). Keeping this in one place is what keeps the two
 * screens from visually drifting apart — same card, same data, two
 * different entry points.
 *
 * Expects a `dom` object with: eventName, eventMeta, guestName,
 * ticketNumber, qrImg, summaryLine, and (optional) status and partyCounts.
 * With partyCounts present, the adult/child/total breakdown renders there
 * and summaryLine carries only the donation message.
 */
(function (global) {
  "use strict";

  // Ticket links use ?a=<token> rather than a path segment
  // (/ticket/<token>) because this is a static export with no
  // server-side routing — there's no way to make an arbitrary path
  // resolve to ticket/index.html without a request ever failing.
  // Must match Code.gs's TICKET_URL_BASE exactly.
  function buildTicketUrl(token) {
    return `https://www.captainsmokeysbbq.com/ticket/?a=${token}`;
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

    const adults = Number(attendee.adultCount) || 0;
    const children = Number(attendee.childCount) || 0;
    const total = Number(attendee.totalGuestCount) || adults + children;
    const donationText =
      attendee.donationAmountCents > 0
        ? `${ET.formatCurrency(attendee.donationAmountCents)} donation due at check-in`
        : "no donation due";

    if (dom.partyCounts) {
      renderPartyCounts(dom.partyCounts, [
        [adults === 1 ? "Adult" : "Adults", adults],
        [children === 1 ? "Child" : "Children", children],
        ["Total", total],
      ]);
      dom.summaryLine.textContent = donationText.charAt(0).toUpperCase() + donationText.slice(1);
    } else {
      const guestWord = total === 1 ? "guest" : "guests";
      dom.summaryLine.textContent = `${total} ${guestWord} · ${donationText}`;
    }

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

  // Built with DOM nodes (not innerHTML) so nothing from the sheet is
  // ever interpreted as markup.
  function renderPartyCounts(container, items) {
    while (container.firstChild) container.removeChild(container.firstChild);
    items.forEach(([label, value]) => {
      const cell = document.createElement("div");
      cell.className = "ticket-party__item";
      const num = document.createElement("span");
      num.className = "ticket-party__value";
      num.textContent = String(value);
      const text = document.createElement("span");
      text.className = "ticket-party__label";
      text.textContent = label;
      cell.appendChild(num);
      cell.appendChild(text);
      container.appendChild(cell);
    });
  }

  // Wallet passes are not implemented. The buttons ship disabled in the
  // HTML; this just guarantees they stay that way and read as unavailable
  // (no click that pretends to start an Add-to-Wallet flow).
  function wireWalletPlaceholders(appleBtn, googleBtn) {
    [
      [appleBtn, "Apple Wallet — coming soon"],
      [googleBtn, "Google Wallet — coming soon"],
    ].forEach(([btn, label]) => {
      if (!btn) return;
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.title = label;
    });
  }

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    renderTicketCard,
    wireWalletPlaceholders,
    buildTicketUrl,
    qrImageUrl,
  });
})(window);
