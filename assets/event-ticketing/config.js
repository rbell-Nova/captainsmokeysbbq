/**
 * Safe to be public — contains no secrets, only the Apps Script Web App
 * URL (once deployed). The permanent manager access key is never committed
 * here. Staff redeem a short-lived Crew Pass for an expiring device token.
 *
 * Leave APPS_SCRIPT_URL empty to keep every page running against the
 * in-memory mock repository. Once the backend in /backend/apps-script/
 * is deployed (see Code.gs header for steps), paste the deployment URL
 * below (ends in /exec) and every page automatically switches to the
 * real Google Sheets-backed data.
 */
(function (global) {
  "use strict";

  global.EventTicketing = Object.assign({}, global.EventTicketing, {
    CONFIG: {
      APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwXDJPz-qdkoCclQ3gHYAbbndD6SsPKIcje0HnAX0Rgyn4Oxx3e4KJTRU8Wm5T4j5cQ/exec",
      // Google OAuth Web client ID for manager "Sign in with Google" (public by
      // design; must match GOOGLE_OAUTH_CLIENT_ID in Apps Script). Empty = the
      // Google button is hidden and managers use the access key.
      GOOGLE_CLIENT_ID: "871180148558-fpks7ok7phuvvdcjfq095jpr555neusq.apps.googleusercontent.com",
    },
  });
})(window);
