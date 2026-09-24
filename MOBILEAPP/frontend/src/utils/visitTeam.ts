/**
 * Reading the visiting team off an order's `technicians` column.
 *
 * The Start Timer modal asks for Technician 1/2/3 and stores them on the job or
 * service order as a `technicians` array. The Done and Edit forms record the
 * same three people as Visit By, Visit With and Visit With (Other) — same team,
 * two names for it — so the positions map straight across rather than the
 * technician entering them twice.
 *
 * Lives here because four screens need the same reading of that column and a
 * private copy in each is how they drift: one gets a fix for a payload shape and
 * the others silently keep mis-parsing it.
 */

/** Visit By, Visit With, Visit With (Other) — in Start Timer slot order. */
export type VisitTeam = [string, string, string];

/**
 * Parses an order's `technicians` value into the three visit slots.
 *
 * Accepts the array the model casts it to, the raw JSON string a cached or older
 * payload can still arrive as, and anything malformed — which yields three empty
 * strings rather than throwing, because a pre-fill helper must never be the
 * reason a form fails to open.
 *
 * 'None' is a real choice in slots 2 and 3 of the Start Timer modal and is
 * carried through verbatim: it means "nobody else attended", which is an answer,
 * not a blank.
 */
export const startTimeVisitTeam = (raw: unknown): VisitTeam => {
  let list: unknown = raw;

  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }

  if (!Array.isArray(list)) return ['', '', ''];

  const slot = (i: number): string => (typeof list[i] === 'string' ? list[i].trim() : '');

  return [slot(0), slot(1), slot(2)];
};
