/**
 * How long a topic's cached outcome stands. Shared by the store and the admin
 * analytics so the "still held" count never drifts from what the store does.
 * Dependency free on purpose: the admin folds import it without the database.
 */
export const DECLINE_TTL_MS = 24 * 3_600_000;
export const ACCEPT_TTL_MS = 30 * 24 * 3_600_000;
