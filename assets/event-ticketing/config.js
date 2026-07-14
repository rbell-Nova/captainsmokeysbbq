/**
 * Safe to be public — contains no secrets, only the Apps Script Web App
 * URL (once deployed). The staff access key is entered by staff at
 * runtime and kept in localStorage, never committed here.
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
      APPS_SCRIPT_URL: "",
    },
  });
})(window);
