/**
 * App-side timestamp default for every `created_at` / `updated_at` column.
 *
 * The SQL-level default in the migrations was baked as the literal TEXT
 * `(datetime('now'))` (drizzle quoted it as a string), so a row that relies
 * on the DB default stores that literal, which sorts before every real
 * timestamp. Drizzle applies this function whenever an insert omits the
 * column, so builder inserts always get a real ISO-8601 UTC instant — the
 * same format the services write explicitly.
 */
export const isoNow = (): string => new Date().toISOString();
