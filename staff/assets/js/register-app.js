/**
 * Admin registration page controller. Staff-only — there is no public
 * registration form (see event-ticketing-feature notes: signups are
 * taken by phone/in person and entered here). Talks to the same
 * repository interface as check-in-app.js via EventTicketing.createRepository().
 */
(function () {
  "use strict";

  const ET = window.EventTicketing;
  const repo = ET.createRepository();

  const STORAGE_KEYS = {
    staffName: "staffCheckIn.staffName",
    stationName: "staffCheckIn.stationName",
    accessKey: "staffCheckIn.accessKey",
  };

  const el = (id) => document.getElementById(id);

  const dom = {
    staffNameInput: el("staffNameInput"),
    stationNameInput: el("stationNameInput"),
    accessKeyInput: el("accessKeyInput"),
    saveSessionBtn: el("saveSessionBtn"),
    sessionSaved: el("sessionSaved"),

    form: el("registerForm"),
    firstNameInput: el("firstNameInput"),
    lastNameInput: el("lastNameInput"),
    phoneInput: el("phoneInput"),
    adultCountInput: el("adultCountInput"),
    childCountInput: el("childCountInput"),
    notesInput: el("notesInput"),
    disclaimerCheckbox: el("disclaimerCheckbox"),
    submitBtn: el("registerSubmitBtn"),

    livePartyTotal: el("livePartyTotal"),
    liveDonation: el("liveDonation"),

    confirmationSection: el("confirmationSection"),
    confirmationGrid: el("confirmationGrid"),
    copyLinkBtn: el("copyLinkBtn"),
    copyMessageBtn: el("copyMessageBtn"),
    registerAnotherBtn: el("registerAnotherBtn"),

    toastStack: el("toastStack"),
  };

  let lastResult = null;

  function toast(message, variant) {
    const node = document.createElement("div");
    node.className = `toast toast--${variant || "info"}`;
    node.textContent = message;
    dom.toastStack.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------
  // staff session (shared localStorage keys with check-in-app.js)
  // -------------------------------------------------------------

  function loadSession() {
    dom.staffNameInput.value = localStorage.getItem(STORAGE_KEYS.staffName) || "";
    dom.stationNameInput.value = localStorage.getItem(STORAGE_KEYS.stationName) || "";
    dom.accessKeyInput.value = localStorage.getItem(STORAGE_KEYS.accessKey) || "";
  }

  function saveSession() {
    localStorage.setItem(STORAGE_KEYS.staffName, dom.staffNameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.stationName, dom.stationNameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.accessKey, dom.accessKeyInput.value.trim());
    dom.sessionSaved.classList.remove("hidden");
    setTimeout(() => dom.sessionSaved.classList.add("hidden"), 1800);
    toast("Staff session saved on this device.", "success");
  }

  dom.saveSessionBtn.addEventListener("click", saveSession);

  function currentSession() {
    return {
      staffName: (dom.staffNameInput.value || "Unnamed Staff").trim(),
      stationName: (dom.stationNameInput.value || "Unassigned Station").trim(),
    };
  }

  // -------------------------------------------------------------
  // live totals preview
  // -------------------------------------------------------------

  function updateLiveTotals() {
    const totals = ET.calculatePartyTotals(
      Number(dom.adultCountInput.value) || 0,
      Number(dom.childCountInput.value) || 0
    );
    dom.livePartyTotal.textContent = totals.totalGuestCount;
    dom.liveDonation.textContent = ET.formatCurrency(totals.donationAmountCents);
  }

  dom.adultCountInput.addEventListener("input", updateLiveTotals);
  dom.childCountInput.addEventListener("input", updateLiveTotals);

  // -------------------------------------------------------------
  // submit
  // -------------------------------------------------------------

  dom.form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!dom.disclaimerCheckbox.checked) {
      toast("The guest must acknowledge the disclaimer before creating a ticket.", "danger");
      return;
    }

    const { staffName, stationName } = currentSession();
    const fields = {
      firstName: dom.firstNameInput.value.trim(),
      lastName: dom.lastNameInput.value.trim(),
      phoneNumber: dom.phoneInput.value.trim(),
      adultCount: Number(dom.adultCountInput.value) || 0,
      childCount: Number(dom.childCountInput.value) || 0,
      notes: dom.notesInput.value.trim(),
      staffName,
      stationName,
    };

    dom.submitBtn.disabled = true;
    dom.submitBtn.textContent = "Creating…";

    try {
      const attendee = await repo.registerAttendee(fields);
      lastResult = attendee;
      renderConfirmation(attendee);
      dom.form.reset();
      dom.adultCountInput.value = 2;
      dom.childCountInput.value = 0;
      updateLiveTotals();
      toast(`Ticket ${attendee.ticketNumber} created for ${attendee.firstName} ${attendee.lastName}.`, "success");
    } catch (err) {
      toast(err && err.message ? err.message : "Could not create this ticket.", "danger");
    } finally {
      dom.submitBtn.disabled = false;
      dom.submitBtn.textContent = "Create Ticket";
    }
  });

  function renderConfirmation(attendee) {
    dom.confirmationSection.classList.remove("hidden");

    const items = [
      ["Guest Name", `${attendee.firstName} ${attendee.lastName}`],
      ["Ticket Number", attendee.ticketNumber],
      ["Adults", attendee.adultCount],
      ["Children", attendee.childCount],
      ["Total Party Size", attendee.totalGuestCount],
      ["Donation Due", ET.formatCurrency(attendee.donationAmountCents)],
      ["SMS Status", attendee.smsSent ? "Sent automatically" : "Not sent — copy the link/message below"],
    ];

    dom.confirmationGrid.innerHTML = items
      .map(([label, value]) => `<div><div class="detail-item__label">${label}</div><div class="detail-item__value">${value}</div></div>`)
      .join("");

    dom.confirmationSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  dom.copyLinkBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const copied = await copyToClipboard(lastResult.ticketUrl);
    toast(copied ? "Ticket link copied." : lastResult.ticketUrl, copied ? "success" : "info");
  });

  dom.copyMessageBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    const message = `Hey ${lastResult.firstName}! Your Captain Smokey's BBQ ticket is ready: ${lastResult.ticketUrl} — see you there!`;
    const copied = await copyToClipboard(message);
    toast(copied ? "Text message copied — paste it into your messaging app." : message, copied ? "success" : "info");
  });

  dom.registerAnotherBtn.addEventListener("click", () => {
    dom.confirmationSection.classList.add("hidden");
    dom.firstNameInput.focus();
  });

  loadSession();
  updateLiveTotals();
})();
