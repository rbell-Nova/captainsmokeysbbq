/**
 * Shared shape definitions for the event ticketing / check-in system.
 *
 * This is plain JS with JSDoc typedefs, not TypeScript, because this repo
 * currently has no build step (it's a static HTML export, no package.json).
 * The typedefs exist so this file maps 1:1 onto `types/event-ticketing.ts`
 * described in the system design doc when the site is eventually rebuilt
 * as a real Next.js app — copy these shapes over almost verbatim.
 *
 * @typedef {"draft"|"open"|"closed"|"completed"} EventStatus
 *
 * @typedef {Object} EventDetails
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} startsAt ISO date string
 * @property {string} venue
 * @property {string} address
 * @property {EventStatus} status
 *
 * @typedef {"pending"|"ready"|"checked-in"|"cancelled"|"void"} TicketStatus
 * @typedef {"not-sent"|"pending"|"sent"|"delivered"|"failed"} DeliveryStatus
 *
 * @typedef {Object} EventAttendee
 * @property {string} id
 * @property {string} eventId
 * @property {string} ticketNumber
 * @property {string} qrToken           mock-only stand-in for a real hashed token
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} phoneNumber
 * @property {string} phoneLastFour
 * @property {number} adultCount
 * @property {number} childCount
 * @property {number} totalGuestCount
 * @property {number} includedAdultCount
 * @property {number} extraAdultCount
 * @property {number} donationAmountCents
 * @property {TicketStatus} ticketStatus
 * @property {DeliveryStatus} deliveryStatus
 * @property {string} registeredAt
 * @property {string|null} checkedInAt
 * @property {string|null} checkedInBy
 * @property {string|null} checkInStation
 * @property {string} notes
 *
 * @typedef {"checked-in"|"check-in-undone"|"cancelled"|"ticket-resent"|"note-updated"} CheckInAction
 *
 * @typedef {Object} CheckInActivity
 * @property {string} id
 * @property {string} eventId
 * @property {string} attendeeId
 * @property {CheckInAction} action
 * @property {string} staffName
 * @property {string} stationName
 * @property {string} createdAt
 */
