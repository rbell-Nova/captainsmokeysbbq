/**
 * Staff check-in page controller. All data access goes through
 * EventTicketing.createRepository() (assets/event-ticketing/repository.js),
 * which picks mock data or the real Apps Script backend based on
 * config.js — nothing in this file knows or cares which one it's using.
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

  const state = {
    event: null,
    attendees: [],
    activity: [],
    selectedId: null,
    filter: "all",
    query: "",
    loading: true,
    error: null,
    scanning: false,
    scannerState: "idle", // idle | starting | scanning | unsupported | denied | error
  };

  const scanner = {
    stream: null,
    detector: null,
    rafId: null,
    lastDetectAt: 0,
  };

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------

  const el = (id) => document.getElementById(id);

  const dom = {
    staffNameInput: el("staffNameInput"),
    stationNameInput: el("stationNameInput"),
    accessKeyInput: el("accessKeyInput"),
    saveSessionBtn: el("saveSessionBtn"),
    sessionSaved: el("sessionSaved"),

    eventName: el("eventName"),
    eventMeta: el("eventMeta"),
    eventStatusPill: el("eventStatusPill"),

    statRegisteredParties: el("statRegisteredParties"),
    statTotalGuests: el("statTotalGuests"),
    statAdults: el("statAdults"),
    statChildren: el("statChildren"),
    statCheckedInParties: el("statCheckedInParties"),
    statCheckedInGuests: el("statCheckedInGuests"),
    statRemainingParties: el("statRemainingParties"),
    statDonations: el("statDonations"),

    scannerVideo: el("scannerVideo"),
    scannerPlaceholder: el("scannerPlaceholder"),
    scannerReticle: el("scannerReticle"),
    scannerBadge: el("scannerBadge"),
    startScanBtn: el("startScanBtn"),
    stopScanBtn: el("stopScanBtn"),

    lookupInput: el("lookupInput"),
    lookupResults: el("lookupResults"),

    selectedEmpty: el("selectedEmpty"),
    selectedPanel: el("selectedPanel"),
    detailGrid: el("detailGrid"),
    detailNotes: el("detailNotes"),
    checkInBtn: el("checkInBtn"),
    undoBtn: el("undoBtn"),
    cancelBtn: el("cancelBtn"),
    saveNotesBtn: el("saveNotesBtn"),
    resendBtn: el("resendBtn"),

    filterRow: el("filterRow"),
    attendeeTableBody: el("attendeeTableBody"),
    directoryEmpty: el("directoryEmpty"),
    directoryLoading: el("directoryLoading"),

    activityList: el("activityList"),
    activityEmpty: el("activityEmpty"),

    toastStack: el("toastStack"),

    modalBackdrop: el("modalBackdrop"),
    modalTitle: el("modalTitle"),
    modalBody: el("modalBody"),
    modalConfirmBtn: el("modalConfirmBtn"),
    modalCancelBtn: el("modalCancelBtn"),
  };

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function fullName(a) {
    return `${a.firstName} ${a.lastName}`;
  }

  function currentSession() {
    return {
      staffName: (dom.staffNameInput.value || "Unnamed Staff").trim(),
      stationName: (dom.stationNameInput.value || "Unassigned Station").trim(),
    };
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function toast(message, variant) {
    const node = document.createElement("div");
    node.className = `toast toast--${variant || "info"}`;
    node.textContent = message;
    dom.toastStack.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  let modalConfirmHandler = null;

  function openConfirmModal({ title, body, confirmLabel, onConfirm }) {
    dom.modalTitle.textContent = title;
    dom.modalBody.textContent = body;
    dom.modalConfirmBtn.textContent = confirmLabel || "Confirm";
    modalConfirmHandler = onConfirm;
    dom.modalBackdrop.classList.remove("hidden");
  }

  function closeModal() {
    dom.modalBackdrop.classList.add("hidden");
    modalConfirmHandler = null;
  }

  dom.modalCancelBtn.addEventListener("click", closeModal);
  dom.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === dom.modalBackdrop) closeModal();
  });
  dom.modalConfirmBtn.addEventListener("click", async () => {
    const handler = modalConfirmHandler;
    closeModal();
    if (handler) await handler();
  });

  // ---------------------------------------------------------------------
  // staff / station session (localStorage only — see design doc section 8:
  // this is audit labeling, NOT authentication. Production writes must
  // still validate the authenticated organizer session server-side.)
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // data loading + summary
  // ---------------------------------------------------------------------

  async function loadAll() {
    state.loading = true;
    state.error = null;
    renderDirectoryLoadingState();
    try {
      const [event, attendees, activity] = await Promise.all([
        repo.getEventDetails(),
        repo.getAttendees(),
        repo.getRecentActivity(),
      ]);
      state.event = event;
      state.attendees = attendees;
      state.activity = activity;
    } catch (err) {
      state.error = err && err.message ? err.message : "Failed to load event data.";
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  async function refreshAttendeesAndActivity() {
    const [attendees, activity] = await Promise.all([repo.getAttendees(), repo.getRecentActivity()]);
    state.attendees = attendees;
    state.activity = activity;
    renderAll();
  }

  function renderEventHeader() {
    if (!state.event) return;
    dom.eventName.textContent = state.event.name;
    const date = new Date(state.event.startsAt);
    const dateStr = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    dom.eventMeta.textContent = `${dateStr} · ${state.event.venue}`;
    dom.eventStatusPill.textContent = state.event.status;
    dom.eventStatusPill.className = `status-pill status-pill--${state.event.status}`;
  }

  function renderSummary() {
    const attendees = state.attendees;
    const registeredParties = attendees.filter((a) => a.ticketStatus !== "cancelled" && a.ticketStatus !== "void").length;
    const totalGuests = attendees.reduce((sum, a) => sum + a.totalGuestCount, 0);
    const adults = attendees.reduce((sum, a) => sum + a.adultCount, 0);
    const children = attendees.reduce((sum, a) => sum + a.childCount, 0);
    const checkedIn = attendees.filter((a) => a.ticketStatus === "checked-in");
    const checkedInParties = checkedIn.length;
    const checkedInGuests = checkedIn.reduce((sum, a) => sum + a.totalGuestCount, 0);
    const remainingParties = registeredParties - checkedInParties;
    const donations = attendees
      .filter((a) => a.ticketStatus !== "cancelled" && a.ticketStatus !== "void")
      .reduce((sum, a) => sum + a.donationAmountCents, 0);

    dom.statRegisteredParties.textContent = registeredParties;
    dom.statTotalGuests.textContent = totalGuests;
    dom.statAdults.textContent = adults;
    dom.statChildren.textContent = children;
    dom.statCheckedInParties.textContent = checkedInParties;
    dom.statCheckedInGuests.textContent = checkedInGuests;
    dom.statRemainingParties.textContent = Math.max(remainingParties, 0);
    dom.statDonations.textContent = ET.formatCurrency(donations);
  }

  // ---------------------------------------------------------------------
  // directory (filters + responsive table/card list)
  // ---------------------------------------------------------------------

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "ready", label: "Ready" },
    { key: "checked-in", label: "Checked In" },
    { key: "cancelled", label: "Cancelled" },
    { key: "delivery-failed", label: "Delivery Failed" },
    { key: "donation-required", label: "Donation Required" },
  ];

  function renderFilterChips() {
    dom.filterRow.innerHTML = FILTERS.map(
      (f) => `<button type="button" class="filter-chip${f.key === state.filter ? " is-active" : ""}" data-filter="${f.key}">${f.label}</button>`
    ).join("");

    dom.filterRow.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.getAttribute("data-filter");
        renderDirectory();
        renderFilterChips();
      });
    });
  }

  function filteredAttendees() {
    let list = state.attendees.slice();

    if (state.filter === "ready") list = list.filter((a) => a.ticketStatus === "ready");
    else if (state.filter === "checked-in") list = list.filter((a) => a.ticketStatus === "checked-in");
    else if (state.filter === "cancelled") list = list.filter((a) => a.ticketStatus === "cancelled" || a.ticketStatus === "void");
    else if (state.filter === "delivery-failed") list = list.filter((a) => a.deliveryStatus === "failed");
    else if (state.filter === "donation-required") list = list.filter((a) => a.extraAdultCount > 0);

    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      list = list.filter(
        (a) =>
          fullName(a).toLowerCase().includes(q) ||
          a.ticketNumber.toLowerCase().includes(q) ||
          a.phoneLastFour.includes(q)
      );
    }

    return list.sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber));
  }

  function statusBadge(status) {
    return `<span class="badge badge--${status}">${status.replace("-", " ")}</span>`;
  }

  function deliveryBadge(status) {
    return `<span class="badge badge--${status}">${status.replace("-", " ")}</span>`;
  }

  function renderDirectoryLoadingState() {
    dom.directoryLoading.classList.remove("hidden");
    dom.directoryEmpty.classList.add("hidden");
    dom.attendeeTableBody.innerHTML = "";
  }

  function renderDirectory() {
    dom.directoryLoading.classList.add("hidden");

    if (state.error) {
      dom.attendeeTableBody.innerHTML = "";
      dom.directoryEmpty.textContent = `Error loading attendees: ${state.error}`;
      dom.directoryEmpty.classList.remove("hidden");
      return;
    }

    if (state.attendees.length === 0) {
      dom.attendeeTableBody.innerHTML = "";
      dom.directoryEmpty.textContent = "No one has registered for this event yet.";
      dom.directoryEmpty.classList.remove("hidden");
      return;
    }

    const list = filteredAttendees();

    if (list.length === 0) {
      dom.attendeeTableBody.innerHTML = "";
      dom.directoryEmpty.textContent = "No attendees match this filter or search.";
      dom.directoryEmpty.classList.remove("hidden");
      return;
    }

    dom.directoryEmpty.classList.add("hidden");

    dom.attendeeTableBody.innerHTML = list
      .map((a) => {
        const selected = a.id === state.selectedId;
        return `
        <div class="attendee-row${selected ? " is-selected" : ""}" data-id="${a.id}" role="button" tabindex="0">
          <div class="attendee-row__head">
            <span>${escapeHtml(fullName(a))}</span>
            ${statusBadge(a.ticketStatus)}
          </div>
          <div class="attendee-row__cell"><span class="label">Ticket</span><span>${escapeHtml(a.ticketNumber)}</span></div>
          <div class="attendee-row__cell"><span class="label">Party</span><span>${a.totalGuestCount} (${a.adultCount}A / ${a.childCount}C)</span></div>
          <div class="attendee-row__cell"><span class="label">Donation</span><span>${ET.formatCurrency(a.donationAmountCents)}</span></div>
          <div class="attendee-row__cell"><span class="label">Delivery</span><span>${deliveryBadge(a.deliveryStatus)}</span></div>
          <div class="attendee-row__cell"><span class="label">Checked In</span><span>${a.checkedInAt ? ET.formatDateTime(a.checkedInAt) : "—"}</span></div>
        </div>`;
      })
      .join("");

    dom.attendeeTableBody.querySelectorAll("[data-id]").forEach((row) => {
      row.addEventListener("click", () => selectAttendee(row.getAttribute("data-id")));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectAttendee(row.getAttribute("data-id"));
        }
      });
    });
  }

  el("directorySearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderDirectory();
  });

  // ---------------------------------------------------------------------
  // selected attendee panel
  // ---------------------------------------------------------------------

  function selectAttendee(id) {
    state.selectedId = id;
    renderDirectory();
    renderSelected();
  }

  function findSelected() {
    return state.attendees.find((a) => a.id === state.selectedId) || null;
  }

  function renderSelected() {
    const a = findSelected();

    if (!a) {
      dom.selectedEmpty.classList.remove("hidden");
      dom.selectedPanel.classList.add("hidden");
      return;
    }

    dom.selectedEmpty.classList.add("hidden");
    dom.selectedPanel.classList.remove("hidden");

    const items = [
      ["Guest Name", escapeHtml(fullName(a))],
      ["Ticket Number", escapeHtml(a.ticketNumber)],
      ["Phone", ET.maskPhone(a.phoneNumber)],
      ["Adults", a.adultCount],
      ["Children", a.childCount],
      ["Total Party Size", a.totalGuestCount],
      ["Included Adults", a.includedAdultCount],
      ["Extra Adults", a.extraAdultCount],
      ["Donation Due", ET.formatCurrency(a.donationAmountCents)],
      ["Registered", ET.formatDateTime(a.registeredAt)],
      ["Ticket Status", statusBadge(a.ticketStatus)],
      ["SMS Delivery", deliveryBadge(a.deliveryStatus)],
      ["Checked In At", a.checkedInAt ? ET.formatDateTime(a.checkedInAt) : "Not checked in"],
      ["Checked In By", a.checkedInBy || "—"],
      ["Station", a.checkInStation || "—"],
    ];

    dom.detailGrid.innerHTML = items
      .map(([label, value]) => `<div><div class="detail-item__label">${label}</div><div class="detail-item__value">${value}</div></div>`)
      .join("");

    dom.detailNotes.value = a.notes || "";

    const isCheckedIn = a.ticketStatus === "checked-in";
    const isBlocked = a.ticketStatus === "cancelled" || a.ticketStatus === "void";

    dom.checkInBtn.disabled = isCheckedIn || isBlocked;
    dom.checkInBtn.textContent = isCheckedIn ? "Already Checked In" : "Check In Party";
    dom.undoBtn.disabled = !isCheckedIn;
    dom.cancelBtn.disabled = a.ticketStatus === "cancelled";
  }

  dom.checkInBtn.addEventListener("click", async () => {
    const a = findSelected();
    if (!a) return;
    const { staffName, stationName } = currentSession();
    dom.checkInBtn.disabled = true;
    const result = await repo.checkInAttendee(a.id, staffName, stationName);

    if (result.ok) {
      toast(`Checked in ${fullName(result.attendee)} (party of ${result.attendee.totalGuestCount}).`, "success");
    } else if (result.reason === "already-checked-in") {
      toast(
        `Duplicate scan: already checked in by ${result.attendee.checkedInBy} at ${result.attendee.checkInStation} (${ET.formatDateTime(result.attendee.checkedInAt)}).`,
        "warning"
      );
    } else if (result.reason === "cancelled" || result.reason === "void") {
      toast(`This ticket is ${result.reason} and cannot be checked in.`, "danger");
    } else {
      toast("Could not check in this ticket — it was not found.", "danger");
    }

    await refreshAttendeesAndActivity();
    renderSelected();
  });

  dom.undoBtn.addEventListener("click", () => {
    const a = findSelected();
    if (!a) return;
    openConfirmModal({
      title: "Undo Check-In?",
      body: `This will mark ${fullName(a)}'s ticket as not checked in. Use this only to correct a mistake.`,
      confirmLabel: "Undo Check-In",
      onConfirm: async () => {
        const { staffName, stationName } = currentSession();
        const result = await repo.undoCheckIn(a.id, staffName, stationName);
        if (result.ok) toast(`Check-in undone for ${fullName(result.attendee)}.`, "info");
        else toast("Could not undo check-in.", "danger");
        await refreshAttendeesAndActivity();
        renderSelected();
      },
    });
  });

  dom.cancelBtn.addEventListener("click", () => {
    const a = findSelected();
    if (!a) return;
    openConfirmModal({
      title: "Cancel This Ticket?",
      body: `This will mark ${fullName(a)}'s ticket as cancelled. This cannot be checked in at the gate afterward.`,
      confirmLabel: "Cancel Ticket",
      onConfirm: async () => {
        const { staffName, stationName } = currentSession();
        const result = await repo.cancelTicket(a.id, staffName, stationName);
        if (result.ok) toast(`Ticket ${result.attendee.ticketNumber} cancelled.`, "warning");
        else toast("Could not cancel this ticket.", "danger");
        await refreshAttendeesAndActivity();
        renderSelected();
      },
    });
  });

  dom.saveNotesBtn.addEventListener("click", async () => {
    const a = findSelected();
    if (!a) return;
    const { staffName, stationName } = currentSession();
    const result = await repo.updateNotes(a.id, dom.detailNotes.value, staffName, stationName);
    if (result.ok) toast("Notes updated.", "success");
    else toast("Could not save notes.", "danger");
    await refreshAttendeesAndActivity();
  });

  dom.resendBtn.addEventListener("click", async () => {
    const a = findSelected();
    if (!a) return;
    const { staffName, stationName } = currentSession();
    dom.resendBtn.disabled = true;
    try {
      const result = await repo.resendTicket(a.id, staffName, stationName);
      dom.resendBtn.disabled = false;

      if (!result || !result.ok) {
        toast("Could not resend this ticket.", "danger");
        return;
      }

      const link = result.attendee.ticketUrl;
      if (result.attendee.smsSent) {
        toast(`New ticket link texted to ${fullName(result.attendee)}. Their old link no longer works.`, "success");
      } else {
        const copied = await copyToClipboard(link);
        toast(
          copied
            ? `SMS isn't connected yet — new ticket link copied to your clipboard to text manually. Old link no longer works.`
            : `SMS isn't connected yet — new link: ${link} (copy it to text manually). Old link no longer works.`,
          "warning"
        );
      }

      await refreshAttendeesAndActivity();
      renderSelected();
    } catch (err) {
      dom.resendBtn.disabled = false;
      toast(err && err.message ? err.message : "Could not resend this ticket.", "danger");
    }
  });

  // ---------------------------------------------------------------------
  // manual lookup
  // ---------------------------------------------------------------------

  let lookupDebounce = null;

  dom.lookupInput.addEventListener("input", () => {
    clearTimeout(lookupDebounce);
    lookupDebounce = setTimeout(runManualLookup, 180);
  });

  async function runManualLookup() {
    const query = dom.lookupInput.value.trim();
    if (!query) {
      dom.lookupResults.innerHTML = "";
      return;
    }
    const results = await repo.searchAttendees(query);
    if (results.length === 0) {
      dom.lookupResults.innerHTML = `<div class="empty-state">No matching tickets found. Double-check the ticket number, name, or last 4 digits of the phone number.</div>`;
      return;
    }
    dom.lookupResults.innerHTML = results
      .map(
        (a) => `
      <button type="button" class="lookup-result" data-id="${a.id}">
        <span>
          <span class="lookup-result__name">${escapeHtml(fullName(a))}</span><br/>
          <span class="lookup-result__meta">${escapeHtml(a.ticketNumber)} · party of ${a.totalGuestCount} · ${a.ticketStatus}</span>
        </span>
        ${statusBadge(a.ticketStatus)}
      </button>`
      )
      .join("");

    dom.lookupResults.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectAttendee(btn.getAttribute("data-id"));
        dom.lookupResults.innerHTML = "";
        dom.lookupInput.value = "";
      });
    });
  }

  // ---------------------------------------------------------------------
  // QR scanner
  // ---------------------------------------------------------------------

  function setScannerState(next, message) {
    state.scannerState = next;

    dom.scannerPlaceholder.classList.toggle("hidden", next === "scanning");
    dom.scannerVideo.classList.toggle("hidden", next !== "scanning");
    dom.scannerReticle.classList.toggle("hidden", next !== "scanning");
    dom.scannerBadge.classList.toggle("hidden", next !== "scanning");

    dom.startScanBtn.classList.toggle("hidden", next === "scanning");
    dom.stopScanBtn.classList.toggle("hidden", next !== "scanning");

    if (message) dom.scannerPlaceholder.textContent = message;
  }

  function extractToken(rawValue) {
    const value = String(rawValue || "").trim();
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "ticket" && parts[1]) return { token: parts[1], looksValid: true };
      return { token: value, looksValid: false };
    } catch {
      const looksValid = /^tk_[a-z0-9_]+$/i.test(value) || /^SM-\d+$/i.test(value);
      return { token: value, looksValid };
    }
  }

  async function handleScannedValue(rawValue) {
    const { token, looksValid } = extractToken(rawValue);

    if (!looksValid) {
      toast("Scanned code is not a Captain Smokey's BBQ event ticket.", "danger");
      return;
    }

    const attendee = await repo.findAttendeeByQrToken(token);

    if (!attendee) {
      toast(`Ticket not found for scanned code (${token}).`, "danger");
      return;
    }

    selectAttendee(attendee.id);

    if (attendee.ticketStatus === "checked-in") {
      toast(
        `Duplicate scan: ${fullName(attendee)} already checked in by ${attendee.checkedInBy} at ${attendee.checkInStation} (${ET.formatDateTime(attendee.checkedInAt)}).`,
        "warning"
      );
    } else if (attendee.ticketStatus === "cancelled" || attendee.ticketStatus === "void") {
      toast(`${fullName(attendee)}'s ticket is ${attendee.ticketStatus} — do not admit.`, "danger");
    } else {
      toast(`Ready to check in ${fullName(attendee)} (party of ${attendee.totalGuestCount}).`, "info");
    }
  }

  async function startScanning() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScannerState("unsupported", "This browser does not support camera access. Use manual lookup below.");
      return;
    }

    setScannerState("starting", "Requesting camera access…");

    try {
      scanner.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (err) {
      if (err && err.name === "NotAllowedError") {
        setScannerState("denied", "Camera access was denied. Enable it in your browser settings, or use manual lookup below.");
      } else {
        setScannerState("error", "Could not access a camera on this device. Use manual lookup below.");
      }
      return;
    }

    dom.scannerVideo.srcObject = scanner.stream;
    await dom.scannerVideo.play();
    setScannerState("scanning");
    state.scanning = true;

    if ("BarcodeDetector" in window) {
      try {
        scanner.detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        scanner.detector = null;
      }
    }

    if (!scanner.detector) {
      toast("This browser can't auto-scan QR codes yet — camera is on, but use manual lookup to check guests in.", "warning");
    }

    scanLoop();
  }

  function scanLoop() {
    if (!state.scanning) return;

    const runDetection = async () => {
      if (!state.scanning || !scanner.detector) return;
      const now = performance.now();
      if (now - scanner.lastDetectAt < 350) return; // throttle
      scanner.lastDetectAt = now;

      try {
        const codes = await scanner.detector.detect(dom.scannerVideo);
        if (codes && codes.length > 0 && codes[0].rawValue) {
          stopScanning();
          await handleScannedValue(codes[0].rawValue);
          return;
        }
      } catch {
        // transient detection errors are expected mid-frame; ignore and keep scanning
      }
    };

    const loop = () => {
      if (!state.scanning) return;
      runDetection();
      scanner.rafId = requestAnimationFrame(loop);
    };

    scanner.rafId = requestAnimationFrame(loop);
  }

  function stopScanning() {
    state.scanning = false;
    if (scanner.rafId) cancelAnimationFrame(scanner.rafId);
    scanner.rafId = null;
    if (scanner.stream) {
      scanner.stream.getTracks().forEach((t) => t.stop());
      scanner.stream = null;
    }
    dom.scannerVideo.srcObject = null;
    setScannerState("idle", "Camera preview will appear here once scanning starts.");
  }

  dom.startScanBtn.addEventListener("click", startScanning);
  dom.stopScanBtn.addEventListener("click", stopScanning);

  // ---------------------------------------------------------------------
  // activity feed
  // ---------------------------------------------------------------------

  function renderActivity() {
    if (state.activity.length === 0) {
      dom.activityList.innerHTML = "";
      dom.activityEmpty.classList.remove("hidden");
      return;
    }
    dom.activityEmpty.classList.add("hidden");

    const byId = new Map(state.attendees.map((a) => [a.id, a]));

    dom.activityList.innerHTML = state.activity
      .slice(0, 25)
      .map((entry) => {
        const attendee = byId.get(entry.attendeeId);
        const who = attendee ? `${fullName(attendee)} (${attendee.ticketNumber})` : entry.attendeeId;
        return `
        <div class="activity-item">
          <span>${escapeHtml(who)} — ${entry.action.replace(/-/g, " ")}</span>
          <span class="activity-item__who">${ET.formatDateTime(entry.createdAt)} · ${escapeHtml(entry.staffName)} @ ${escapeHtml(entry.stationName)}</span>
        </div>`;
      })
      .join("");
  }

  // ---------------------------------------------------------------------
  // render orchestration + init
  // ---------------------------------------------------------------------

  function renderAll() {
    renderEventHeader();
    renderSummary();
    renderFilterChips();
    renderDirectory();
    renderSelected();
    renderActivity();
  }

  function init() {
    loadSession();
    setScannerState("idle", "Camera preview will appear here once scanning starts.");
    loadAll();
  }

  init();
})();
