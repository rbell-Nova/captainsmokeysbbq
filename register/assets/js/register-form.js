/**
 * Public guest self-registration page. Unlike the staff pages, this
 * calls repo.registerAttendee() with no access key — see Code.gs's
 * "register" case, which is deliberately public. A hidden honeypot
 * field (#websiteInput) is sent along and rejected server-side if
 * filled in, since real visitors never see or fill it.
 */
(function () {
  "use strict";

  const ET = window.EventTicketing;
  const repo = ET.createRepository();

  const el = (id) => document.getElementById(id);

  const dom = {
    formView: el("registerFormView"),
    form: el("registerForm"),
    firstNameInput: el("firstNameInput"),
    lastNameInput: el("lastNameInput"),
    phoneInput: el("phoneInput"),
    adultCountInput: el("adultCountInput"),
    childCountInput: el("childCountInput"),
    disclaimerCheckbox: el("disclaimerCheckbox"),
    websiteInput: el("websiteInput"),
    submitBtn: el("registerSubmitBtn"),
    livePartySummary: el("livePartySummary"),

    ticketCard: el("ticketCard"),
    eventName: el("ticketEventName"),
    eventMeta: el("ticketEventMeta"),
    guestName: el("ticketGuestName"),
    ticketNumber: el("ticketNumber"),
    qrImg: el("ticketQrImg"),
    summaryLine: el("ticketSummaryLine"),
    status: el("ticketStatus"),
    deliveryNote: el("deliveryNote"),

    toastStack: el("toastStack"),
  };

  function toast(message, variant) {
    const node = document.createElement("div");
    node.className = `toast toast--${variant || "info"}`;
    node.textContent = message;
    dom.toastStack.appendChild(node);
    setTimeout(() => node.remove(), 5000);
  }

  function updateLiveSummary() {
    const totals = ET.calculatePartyTotals(
      Number(dom.adultCountInput.value) || 0,
      Number(dom.childCountInput.value) || 0
    );
    const guestWord = totals.totalGuestCount === 1 ? "guest" : "guests";
    dom.livePartySummary.textContent =
      totals.donationAmountCents > 0
        ? `${totals.totalGuestCount} ${guestWord} · ${ET.formatCurrency(totals.donationAmountCents)} donation due at check-in`
        : `${totals.totalGuestCount} ${guestWord} · no donation due`;
  }

  dom.adultCountInput.addEventListener("input", updateLiveSummary);
  dom.childCountInput.addEventListener("input", updateLiveSummary);
  updateLiveSummary();

  dom.form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!dom.disclaimerCheckbox.checked) {
      toast("Please acknowledge the disclaimer before continuing.", "danger");
      return;
    }

    const fields = {
      firstName: dom.firstNameInput.value.trim(),
      lastName: dom.lastNameInput.value.trim(),
      phoneNumber: dom.phoneInput.value.trim(),
      adultCount: Number(dom.adultCountInput.value) || 0,
      childCount: Number(dom.childCountInput.value) || 0,
      website: dom.websiteInput.value, // honeypot — always empty for real people
    };

    dom.submitBtn.disabled = true;
    dom.submitBtn.textContent = "Getting your ticket…";

    try {
      const attendee = await repo.registerAttendee(fields);
      const event = await repo.getEventDetails();

      ET.renderTicketCard(
        { eventName: dom.eventName, eventMeta: dom.eventMeta, guestName: dom.guestName, ticketNumber: dom.ticketNumber, qrImg: dom.qrImg, summaryLine: dom.summaryLine, status: dom.status },
        ET,
        event,
        attendee,
        attendee.qrToken
      );

      dom.deliveryNote.textContent = attendee.smsSent
        ? "We've also texted your ticket link to your phone."
        : "We couldn't text this automatically yet — please save this page or screenshot the QR code below.";

      dom.formView.classList.add("hidden");
      dom.ticketCard.classList.remove("hidden");
      dom.ticketCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast(err && err.message ? err.message : "Could not create your ticket — please try again.", "danger");
      dom.submitBtn.disabled = false;
      dom.submitBtn.textContent = "Get My Ticket";
    }
  });

  ET.wireWalletPlaceholders(el("appleWalletBtn"), el("googleWalletBtn"));
})();
