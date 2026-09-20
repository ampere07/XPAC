// What "Referred By" stores and what it shows.
//
// The field displays an agent's name and stores their user id, and the forms
// that carry it all go through the helpers here. Two things are locked down:
//
//   • a referral read out of a record and written straight back comes back
//     byte-identical, or an edit to an unrelated field would quietly move
//     somebody's commission; and
//   • a NUMBER IS NOT AN ID until it resolves to somebody on the agent roster.
//     The column is full of numbers that were never ids — phone numbers,
//     account numbers, codes like "1840" — and reading one of those as a user
//     id would show the wrong name and pay the wrong person.

import {
  agentDisplayName,
  agentOwnsReferral,
  agentReferralId,
  encodeAgentReferral,
  isAgentReferral,
} from './agentReferral';
import {
  buildAgentGroups,
  referredByEcho,
  referredByFields,
  referredByForSave,
  resolveReferredBy,
  selectionFromOption,
} from './referredByField';

// users.agent_id is the agent's TEAM, not their own id — the shape the pickers
// are actually fed.
const AGENTS = [
  { id: 37, first_name: 'Brigs', middle_initial: '', last_name: 'Ranay', agent_id: '2' },
  { id: 24, first_name: 'Edith', middle_initial: '', last_name: 'Naviza', agent_id: '2' },
  { id: 9398, first_name: 'Jherwen', middle_initial: 'T', last_name: 'Telen', agent_id: null },
  // Two accounts, one name: the case name matching could never settle.
  { id: 41, first_name: 'Joy', middle_initial: '', last_name: 'Iringan', agent_id: '3' },
  { id: 77, first_name: 'Joy', middle_initial: '', last_name: 'Iringan', agent_id: '3' },
];

const TEAMS = [
  { id: 2, team_name: 'Team Beth' },
  { id: 3, team_name: 'Team Ed' },
];

describe('the stored form of a referral', () => {
  it('is the plain agent id', () => {
    expect(encodeAgentReferral(37)).toBe('37');
    expect(encodeAgentReferral('37')).toBe('37');
    expect(agentReferralId('37')).toBe(37);
  });

  it('refuses an id it could not resolve later', () => {
    expect(encodeAgentReferral(null)).toBeNull();
    expect(encodeAgentReferral(undefined)).toBeNull();
    expect(encodeAgentReferral('')).toBeNull();
    expect(encodeAgentReferral(0)).toBeNull();
    expect(encodeAgentReferral(-1)).toBeNull();
    expect(encodeAgentReferral('abc')).toBeNull();
  });

  it.each([
    ['1e3'],
    ['4.5'],
    ['-7'],
    ['+7'],
    ['3 7'],
    ['Team Beth'],
    ['Walk in'],
    [''],
  ])('reads %s as free text, not a number', (value) => {
    expect(agentReferralId(value)).toBeNull();
  });

  it('refuses a leading zero, which no id ever has', () => {
    // "000201" is a code somebody typed. Reading it as id 201 would borrow that
    // user's name for a referral that was never theirs.
    expect(agentReferralId('000201')).toBeNull();
    expect(agentReferralId('09077694575')).toBeNull();
    expect(agentReferralId('0')).toBeNull();
  });
});

describe('a number is not an id until it resolves', () => {
  // The guard that makes bare ids safe to store in a column full of numbers.
  it.each([
    ['1840'],            // a bare number in agent-id range, but nobody's id
    ['9543115080'],      // a mobile number without its leading zero
    ['20220006245'],     // an account number
    ['699'],
  ])('shows %s exactly as stored when it is nobody on the roster', (legacy) => {
    expect(isAgentReferral(legacy, AGENTS)).toBe(false);
    expect(resolveReferredBy({ referred_by: legacy }, AGENTS))
      .toEqual({ label: legacy, agentId: null });
  });

  it('resolves a number that IS on the roster', () => {
    expect(isAgentReferral('37', AGENTS)).toBe(true);
    expect(resolveReferredBy({ referred_by: '37' }, AGENTS))
      .toEqual({ label: 'Brigs Ranay', agentId: 37 });
  });

  it('treats a non-agent id as free text, not as that person', () => {
    // 1840 may well be a real users.id — it just is not an agent's, so the
    // referral is not theirs and the number stays a number.
    const notAnAgent = [...AGENTS, { id: 1840, first_name: 'Some', last_name: 'Technician' }];
    expect(resolveReferredBy({ referred_by: '1840' }, AGENTS))
      .toEqual({ label: '1840', agentId: null });
    // ...and only the roster it is given decides. Hand it a roster containing
    // 1840 and it resolves — which is why the roster is the agent list, not
    // every user.
    expect(resolveReferredBy({ referred_by: '1840' }, notAnAgent).agentId).toBe(1840);
  });
});

describe('reading a record into the form', () => {
  it('prefers the id the endpoint sent beside the referral', () => {
    // The list endpoints resolve the name server-side, so the raw value is
    // already the name — the id alongside it says who it belongs to.
    expect(resolveReferredBy({ referred_by: 'Brigs Ranay', referred_by_agent_id: 37 }, AGENTS))
      .toEqual({ label: 'Brigs Ranay', agentId: 37 });
  });

  it('reads the three payload shapes the forms are fed', () => {
    expect(resolveReferredBy({ Referred_By: 'x', Referred_By_Agent_ID: 24 }, AGENTS).agentId).toBe(24);
    expect(resolveReferredBy({ referredBy: 'x', referredByAgentId: 24 }, AGENTS).agentId).toBe(24);
    expect(resolveReferredBy({ referred_by: 'x', referred_by_agent_id: 24 }, AGENTS).agentId).toBe(24);
  });

  it('leaves legacy free text exactly as it stands', () => {
    expect(resolveReferredBy({ referred_by: 'Team Beth' }, AGENTS))
      .toEqual({ label: 'Team Beth', agentId: null });
    expect(resolveReferredBy({ referred_by: 'Walk in' }, AGENTS))
      .toEqual({ label: 'Walk in', agentId: null });
    expect(resolveReferredBy({ referred_by: 'Juan Dela Cruz' }, AGENTS))
      .toEqual({ label: 'Juan Dela Cruz', agentId: null });
  });

  it('keeps the stored value when the roster has not loaded yet', () => {
    // Blanking the field here would look like the referral was never set.
    expect(resolveReferredBy({ referred_by: '37' }, []))
      .toEqual({ label: '37', agentId: null });
  });

  it('keeps the stored value when the agent no longer exists', () => {
    expect(resolveReferredBy({ referred_by: '99999' }, AGENTS))
      .toEqual({ label: '99999', agentId: null });
  });

  it('never yields undefined, null or a blank for any input', () => {
    for (const record of [{}, null, undefined, { referred_by: null }, { referred_by: '' }]) {
      const out = resolveReferredBy(record, AGENTS);
      expect(out.label).toBe('');
      expect(out.agentId).toBeNull();
    }
  });

  it('hands the forms the two fields they hold', () => {
    expect(referredByFields({ referred_by: '24' }, AGENTS))
      .toEqual({ referredBy: 'Edith Naviza', referredById: 24 });
  });
});

describe('writing the form back', () => {
  it('stores the id of the agent that was picked', () => {
    expect(referredByForSave({ label: 'Brigs Ranay', agentId: 37 }, AGENTS)).toBe('37');
  });

  it('keeps free text as free text', () => {
    expect(referredByForSave({ label: 'Team Beth', agentId: null }, AGENTS)).toBe('Team Beth');
    expect(referredByForSave({ label: 'Walk in', agentId: null }, AGENTS)).toBe('Walk in');
    expect(referredByForSave({ label: '1840', agentId: null }, AGENTS)).toBe('1840');
    expect(referredByForSave({ label: '09077694575', agentId: null }, AGENTS)).toBe('09077694575');
  });

  it('stores nothing for an empty field', () => {
    expect(referredByForSave({ label: '', agentId: null }, AGENTS)).toBeNull();
    expect(referredByForSave({ label: '   ', agentId: null }, AGENTS)).toBeNull();
  });

  it('upgrades a legacy name to that agent id when exactly one agent has it', () => {
    expect(referredByForSave({ label: 'Brigs Ranay', agentId: null }, AGENTS)).toBe('37');
    expect(referredByForSave({ label: 'brigs  ranay', agentId: null }, AGENTS)).toBe('37');
  });

  it('refuses to guess when two agents share the name', () => {
    // Guessing between them is exactly how name matching paid the wrong person.
    expect(referredByForSave({ label: 'Joy Iringan', agentId: null }, AGENTS)).toBe('Joy Iringan');
  });

  it('still stores the right one when that name was picked from the list', () => {
    expect(referredByForSave({ label: 'Joy Iringan', agentId: 77 }, AGENTS)).toBe('77');
  });
});

describe('the round trip the forms actually perform', () => {
  // Opening a record and saving it without touching this field must write back
  // what was there. Anything else moves a commission on an unrelated edit.
  it.each([
    ['an id referral', { referred_by: '37' }, '37'],
    ['a team name', { referred_by: 'Team Beth' }, 'Team Beth'],
    ['unstructured text', { referred_by: 'Walk in' }, 'Walk in'],
    ['a legacy full name', { referred_by: 'Juan Dela Cruz' }, 'Juan Dela Cruz'],
    ['a number that is nobody', { referred_by: '1840' }, '1840'],
    ['a mobile number', { referred_by: '09077694575' }, '09077694575'],
    ['an account number', { referred_by: '20220006245' }, '20220006245'],
    ['a name-and-id payload', { referred_by: 'Edith Naviza', referred_by_agent_id: 24 }, '24'],
  ])('%s survives open-then-save', (_label, record, expected) => {
    const fields = referredByFields(record, AGENTS);
    const stored = referredByForSave(
      { label: fields.referredBy, agentId: fields.referredById },
      AGENTS
    );
    expect(stored).toBe(expected);
  });

  it('survives open-then-save even with no roster loaded', () => {
    // The fetch failing must not rewrite anybody's referral.
    for (const raw of ['37', 'Team Beth', '1840', 'Juan Dela Cruz']) {
      const fields = referredByFields({ referred_by: raw }, []);
      expect(referredByForSave({ label: fields.referredBy, agentId: fields.referredById }, [])).toBe(raw);
    }
  });

  it('stores the newly picked agent after the user changes it', () => {
    const fields = referredByFields({ referred_by: '37' }, AGENTS);
    expect(fields.referredBy).toBe('Brigs Ranay');

    const picked = selectionFromOption('Edith Naviza', AGENTS[1]);
    expect(referredByForSave(picked, AGENTS)).toBe('24');
  });

  it('replaces a legacy value only when the user picks somebody', () => {
    const fields = referredByFields({ referred_by: 'Walk in' }, AGENTS);
    expect(fields).toEqual({ referredBy: 'Walk in', referredById: null });

    const picked = selectionFromOption('Brigs Ranay', AGENTS[0]);
    expect(referredByForSave(picked, AGENTS)).toBe('37');
  });

  it('takes the id from the clicked row, not from the name', () => {
    // Both Joys render the same label; only the option says which was clicked.
    expect(selectionFromOption('Joy Iringan', AGENTS[4])).toEqual({ label: 'Joy Iringan', agentId: 77 });
  });

  it('falls back to free text when the option carries no id', () => {
    expect(selectionFromOption('Team Beth', undefined)).toEqual({ label: 'Team Beth', agentId: null });
  });
});

describe('the forms that only echo the value back', () => {
  // The boxes with no agent picker — a read-only field, a plain text input, or a
  // payload that passes the value through. They are handed the resolved NAME, so
  // without this they would write the name back and lose the id.

  it('writes back the id the record carried while the box is untouched', () => {
    const record = { referred_by: 'Brigs Ranay', referred_by_agent_id: 37 };
    expect(referredByEcho(record, 'Brigs Ranay')).toBe('37');
  });

  it('keeps the exact id even when two agents share the shown name', () => {
    // The name alone could not tell 41 from 77; the record says which it is.
    const record = { referred_by: 'Joy Iringan', referred_by_agent_id: 77 };
    expect(referredByEcho(record, 'Joy Iringan', AGENTS)).toBe('77');
  });

  it('stores what was typed once somebody types over it', () => {
    const record = { referred_by: 'Brigs Ranay', referred_by_agent_id: 37 };
    expect(referredByEcho(record, 'Walk in', AGENTS)).toBe('Walk in');
    expect(referredByEcho(record, 'a friend', AGENTS)).toBe('a friend');
  });

  it('upgrades a typed name to that agent id when the roster is available', () => {
    const record = { referred_by: 'Walk in' };
    expect(referredByEcho(record, 'Edith Naviza', AGENTS)).toBe('24');
  });

  it('leaves a typed name alone when no roster was given', () => {
    // Which is what these forms did before the roster reached them.
    expect(referredByEcho({ referred_by: 'Walk in' }, 'Edith Naviza')).toBe('Edith Naviza');
  });

  it('leaves legacy values untouched through a save that did not edit them', () => {
    for (const raw of ['Team Beth', 'Walk in', '1840', '09077694575', 'Juan Dela Cruz']) {
      expect(referredByEcho({ referred_by: raw }, raw, AGENTS)).toBe(raw);
    }
  });

  it('handles a record that carries no referral at all', () => {
    expect(referredByEcho(null, '')).toBeNull();
    expect(referredByEcho({}, '')).toBeNull();
    expect(referredByEcho(null, 'Brigs Ranay', AGENTS)).toBe('37');
  });
});

describe('the picker list', () => {
  it('groups agents under their team and labels each with their name', () => {
    const groups = buildAgentGroups(AGENTS, TEAMS);

    expect(groups.map(g => g.label)).toEqual(['Team Beth', 'Team Ed', 'No Team']);
    expect(groups[0].options.map((o: any) => o.name)).toEqual(['Brigs Ranay', 'Edith Naviza']);
    expect(groups[2].options.map((o: any) => o.name)).toEqual(['Jherwen T Telen']);
  });

  it('keeps each option id, which is what gets stored', () => {
    const groups = buildAgentGroups(AGENTS, TEAMS);
    expect(groups[0].options.map((o: any) => o.id)).toEqual([37, 24]);
  });

  it('shows the label the resolver produces, so the picked row highlights', () => {
    const groups = buildAgentGroups(AGENTS, TEAMS);
    const option = groups[0].options[0];
    expect(resolveReferredBy({ referred_by: '37' }, AGENTS).label).toBe(option.name);
  });

  it('is empty rather than broken with nothing loaded', () => {
    expect(buildAgentGroups([], TEAMS)).toEqual([]);
    expect(buildAgentGroups(AGENTS, [])).toEqual([
      { label: 'No Team', options: [expect.objectContaining({ name: 'Jherwen T Telen' })] },
    ]);
  });
});

describe('deciding whose referral it is', () => {
  it('matches an id referral to that agent and nobody else', () => {
    expect(agentOwnsReferral('37', 'Brigs Ranay', 'brigs@x.com', 37)).toBe(true);
    expect(agentOwnsReferral('37', 'Edith Naviza', 'edith@x.com', 24)).toBe(false);
  });

  it('never falls back to the name for a numeric referral', () => {
    // A number is not a name; letting it reach the tolerant branch could only
    // ever produce a wrong answer.
    expect(agentOwnsReferral('37', 'Brigs Ranay', 'brigs@x.com')).toBe(false);
    expect(agentOwnsReferral('1840', 'Brigs Ranay', 'brigs@x.com', 37)).toBe(false);
  });

  it('leaves the legacy name matching exactly as it was', () => {
    expect(agentOwnsReferral('John Rusell Ampere', 'John Ampere', '', 5)).toBe(true);
    expect(agentOwnsReferral('Brigs Ranay', 'Brigs Ranay', '', 37)).toBe(true);
    expect(agentOwnsReferral('someone else', 'Brigs Ranay', '', 37)).toBe(false);
    expect(agentOwnsReferral('brigs@x.com', 'Brigs Ranay', 'brigs@x.com', 37)).toBe(true);
    expect(agentOwnsReferral('', 'Brigs Ranay', 'brigs@x.com', 37)).toBe(false);
  });
});

describe('the name shown for an agent', () => {
  it('is built the one way, so every screen agrees', () => {
    expect(agentDisplayName(AGENTS[0])).toBe('Brigs Ranay');
    expect(agentDisplayName(AGENTS[2])).toBe('Jherwen T Telen');
    expect(agentDisplayName({})).toBe('');
    expect(agentDisplayName(null)).toBe('');
  });
});
