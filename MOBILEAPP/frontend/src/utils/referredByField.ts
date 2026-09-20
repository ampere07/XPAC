// The "Referred By" picker, in one place.
//
// Two forms carry this field on mobile — JO Assign and Customer Details Edit —
// and they had a verbatim copy of the grouping logic each. They now share this,
// because the two have to agree about more than how the list looks: they write
// the same column, and a form that reads a referral one way and writes it another
// turns an agent's referral into somebody else's on the next save.
//
// Mobile's Job Order Done form is deliberately NOT wired to this: its Referred By
// is a plain text box, not an agent picker, so it still writes whatever is typed.
// Editing an id-form referral there writes the resolved NAME back and loses the
// id — the same agent, said ambiguously again. Giving that screen a picker is the
// fix, and is the one difference left between mobile and the web portal.
//
// Kept byte-identical to ATSS2_0/frontend/src/utils/referredByField.ts apart from
// this note, so the two apps cannot disagree about what the column holds. The web
// copy carries the test suite for both (referredByField.test.ts); this app is an
// Expo project with no test runner, so a change made here has to be made there and
// re-run, or the shared behaviour goes unchecked.
//
// What is stored is the agent's user id — plain, "37" — not their name. What is
// SHOWN is always the agent's name. A stored value that is NOT an agent id, which
// includes numbers that were never ids, is shown and written back exactly as it
// stands. See utils/agentReferral.ts and the backend's App\Support\AgentReferral.

import { GroupedOption } from '../components/common/SearchableField';
import {
  agentDisplayName,
  encodeAgentReferral,
  findAgentById,
  findAgentByName,
} from './agentReferral';

/** What a form holds for this field: the name on screen, and the id behind it. */
export interface ReferredBySelection {
  /** The agent's full name, or the free text of a legacy referral. Shown in the input. */
  label: string;
  /** The agent's users.id, or null when the referral is free text. Stored. */
  agentId: number | null;
}

export const EMPTY_REFERRED_BY: ReferredBySelection = { label: '', agentId: null };

/**
 * The agent list grouped under the team headings the pickers show.
 *
 * `users.agent_id` is the agent's TEAM (a row in `agents`), not their own id —
 * which is why grouping keys off it while the referral stores `user.id`.
 *
 * Team names are headings here, not choices. A referral has to name one agent:
 * referred_by is what the commission is settled against when the job order is
 * approved, and a team name matches no agent, so choosing one would silently
 * leave the referral unpaid. Teams stay searchable — typing one still lists its
 * members to pick from.
 */
export const buildAgentGroups = (agents: any[], teams: any[]): GroupedOption[] => {
  if (!agents?.length) return [];

  const groups: Record<string, any[]> = {};
  const noTeam: any[] = [];

  agents.forEach(agent => {
    const option = { ...agent, name: agentDisplayName(agent) };

    if (agent?.agent_id) {
      const teamKey = String(agent.agent_id);
      if (!groups[teamKey]) groups[teamKey] = [];
      groups[teamKey].push(option);
    } else {
      noTeam.push(option);
    }
  });

  const grouped: GroupedOption[] = [];

  (teams || []).forEach(team => {
    const teamAgents = groups[String(team?.id)];
    if (teamAgents && teamAgents.length > 0) {
      grouped.push({
        label: team.team_name || `Team ${team.id}`,
        options: teamAgents,
      });
    }
  });

  if (noTeam.length > 0) {
    grouped.push({ label: 'No Team', options: noTeam });
  }

  return grouped;
};

/**
 * The stored referral on a record, whatever shape the endpoint hands it over in.
 *
 * The three forms are fed by three different payloads — an application, a
 * billing record and a job order — and each names the field its own way. Read
 * here so a new source only has to be added once.
 */
const rawReferralOf = (record: any): string => {
  if (!record) return '';

  const value =
    record.referred_by ??
    record.referredBy ??
    record.Referred_By ??
    record.Referred_By_Raw ??
    '';

  return value === null || value === undefined ? '' : String(value);
};

/** The agent id an endpoint sent alongside the referral, if it sent one. */
const explicitAgentIdOf = (record: any): number | null => {
  if (!record) return null;

  const value =
    record.referred_by_agent_id ??
    record.referredByAgentId ??
    record.Referred_By_Agent_ID ??
    null;

  if (value === null || value === undefined || value === '') return null;

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * What to put in the field when a record is opened for editing.
 *
 * Two ways in, in order:
 *
 *   1. the agent id the endpoint sent beside the referral — it already knows who
 *      this is, and the value next to it is already their name;
 *   2. the stored value speaking for itself, which is what makes this work from
 *      a payload that was never taught to send the id.
 *
 * Route 2 is where the guard lives. A number is NOT taken as an id on sight: it
 * has to match somebody on the agent roster, because the column is full of
 * numbers that were never ids — phone numbers, account numbers, and codes like
 * "1840". Anything that does not resolve is free text and is handed back
 * untouched, id null, so saving writes it back exactly as it was.
 *
 * `agents` may still be loading, and callers pass [] on purpose during prefill.
 * Nothing resolves then, so the stored value is held as the label rather than
 * blanked, and calling this again once the roster lands fills the name in.
 */
export const resolveReferredBy = (record: any, agents: any[]): ReferredBySelection => {
  const raw = rawReferralOf(record);

  // 1. The endpoint named the agent outright. `raw` is already the name it
  //    resolved, so it stands in until the roster can confirm it.
  const explicit = explicitAgentIdOf(record);
  if (explicit !== null) {
    const agent = findAgentById(explicit, agents);
    return { label: agent ? agentDisplayName(agent) : raw, agentId: explicit };
  }

  // 2. The stored value on its own. Only a match on the roster counts.
  const agent = findAgentById(raw, agents);
  if (agent) {
    return { label: agentDisplayName(agent), agentId: Number(agent.id) };
  }

  // Free text, a number that is nobody's id, or a roster that has not loaded —
  // all three are shown exactly as stored and written back unchanged.
  return { label: raw, agentId: null };
};

/**
 * The same resolution, shaped as the two form fields the modals hold.
 *
 * Spread straight into a setFormData call so all three forms name the fields
 * the same way and a record read in one is written identically by the others.
 */
export const referredByFields = (
  record: any,
  agents: any[]
): { referredBy: string; referredById: number | null } => {
  const { label, agentId } = resolveReferredBy(record, agents);
  return { referredBy: label, referredById: agentId };
};

/**
 * What to write to `referred_by` when the form is saved.
 *
 * A chosen agent is stored as their id. Anything else is stored exactly as it
 * reads, so the team names and free text already in the column ("Team Beth",
 * "Walk in") survive an edit untouched.
 *
 * A legacy referral whose name still matches exactly one agent is upgraded to
 * that agent's id on the way out — the same agent, said unambiguously. The match
 * has to be unique: two agents sharing a name is precisely the case the old
 * name matching got wrong, and guessing between them here would repeat it.
 */
export const referredByForSave = (
  selection: ReferredBySelection,
  agents: any[]
): string | null => {
  const id = encodeAgentReferral(selection?.agentId);
  if (id) return id;

  const label = (selection?.label || '').trim();
  if (!label) return null;

  const matched = findAgentByName(label, agents);
  return matched ? encodeAgentReferral(matched.id) ?? label : label;
};

/**
 * The selection to hold after the user picks a row in the dropdown.
 *
 * SearchableField hands over the option it rendered as well as the label, so the
 * id comes straight from the agent that was clicked — nothing is looked back up
 * by name, and two agents with the same name stay distinct.
 */
export const selectionFromOption = (label: string, option?: any): ReferredBySelection => {
  const id = Number(option?.id);
  return {
    label,
    agentId: Number.isInteger(id) && id > 0 ? id : null,
  };
};

/**
 * What to write when a form only ECHOES the referral back.
 *
 * Some forms have no agent picker — a read-only box, a plain text field, or a
 * payload that simply passes the value through. They are handed the resolved
 * NAME, so writing what they hold would throw the id away and turn the referral
 * back into a string somebody has to match by name.
 *
 * So: while the label is still the one that was loaded, the id the record
 * carried is written back untouched. The moment somebody types over it, what
 * they typed is what gets stored — which is the whole point of a free-text box.
 */
export const referredByEcho = (record: any, label: string, agents: any[] = []): string | null => {
  const loaded = resolveReferredBy(record, []);
  const current = (label ?? "").trim();

  // Untouched: write back exactly the id the record carried. Done before any
  // name lookup, so two agents sharing a name cannot swap places on a save that
  // was not even editing this field.
  if (current === (loaded.label ?? "").trim()) {
    return encodeAgentReferral(loaded.agentId) ?? (current || null);
  }

  // Typed over. With a roster to check against, a name that belongs to exactly
  // one agent still becomes their id; without one, or for free text like
  // "Walk in", what was typed is what is stored.
  return referredByForSave({ label: current, agentId: null }, agents);
};
