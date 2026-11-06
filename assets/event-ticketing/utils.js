/**
 * Centralized party/donation calculation. Do not duplicate this logic
 * anywhere else (form, ticket page, staff page, or a future server route) —
 * import/copy this single function instead. The future backend must
 * recalculate these values independently rather than trusting client input.
 */
(function (global) {
  "use strict";

  const EXTRA_ADULT_DONATION_CENTS = 1500;
  const INCLUDED_ADULT_LIMIT = 2;

  function calculatePartyTotals(adultCount, childCount) {
    const adults = Math.max(0, Number(adultCount) || 0);
    const children = Math.max(0, Number(childCount) || 0);
    const includedAdultCount = Math.min(adults, INCLUDED_ADULT_LIMIT);
    const extraAdultCount = Math.max(adults - INCLUDED_ADULT_LIMIT, 0);
    const donationAmountCents = extraAdultCount * EXTRA_ADULT_DONATION_CENTS;
    const totalGuestCount = adults + children;

    return {
      adultCount: adults,
      childCount: children,
      includedAdultCount,
      extraAdultCount,
      donationAmountCents,
      totalGuestCount,
    };
  }

  function formatCurrency(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function maskPhone(phoneNumber) {
    const digits = String(phoneNumber || "").replace(/\D/g, "");
    const lastFour = digits.slice(-4);
    return lastFour ? `(•••) •••-${lastFour}` : "—";
  }

  function phoneLastFour(phoneNumber) {
    return String(phoneNumber || "").replace(/\D/g, "").slice(-4);
  }

  function formatDateTime(isoString) {
    if (!isoString) return "—";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    calculatePartyTotals,
    formatCurrency,
    maskPhone,
    phoneLastFour,
    formatDateTime,
  });
})(window);
