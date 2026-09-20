<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * How a "Referred By" value names one particular agent.
 *
 * `referred_by` is a single varchar on applications, customers and
 * service_orders, and it has always held free text: an agent's name, a team
 * name, or something like "Walk in" or "Neighbour". Everything that pays an
 * agent then had to guess which of those it was looking at, and matched a name
 * against the users table — which cannot tell two agents with the same name
 * apart, and silently pays whichever row comes back first.
 *
 * The picker now writes the agent's user id instead, so a referral made through
 * the UI identifies exactly one account and nothing has to be guessed. The id is
 * stored plain — "37" — in the same column, so nothing had to be migrated and no
 * second column was added.
 *
 * A NUMBER IS NOT ENOUGH TO MAKE IT AN ID.
 *
 * The column already holds free text that is entirely digits: mobile numbers
 * typed into the box, account numbers like "20220006245", and bare numbers such
 * as "1840" that sit squarely in user-id range. So a numeric value only counts
 * as a referral when it resolves to a user who is an AGENT — see agentIdIfAgent()
 * and the role test in prime(). A number that resolves to nobody, or to somebody who
 * is not an agent, is left alone and displayed exactly as stored.
 *
 * That guard is narrow, not absolute: a legacy value that happens to equal the
 * id of a real agent account is indistinguishable from a referral to them. Three
 * values in the current data sit in agent-id range — "000201", "699" and "1840"
 * — and are worth checking if a referral ever shows the wrong name.
 *
 * Everything non-numeric is left exactly as it was and still goes through the
 * tolerant name match in AgentProgramme::referralBelongsToAgent(), so legacy
 * referrals keep resolving the way they always have.
 *
 * The clients carry the same rules in agentReferral.ts, so all of them agree
 * about what a referral says.
 */
class AgentReferral
{
    /**
     * The role that makes a user an agent.
     *
     * Mirrors AGENT_ROLE_ID in agentReferral.ts and the role the "Referred By"
     * pickers list, so a value this class accepts as an id is exactly one the
     * picker could have written.
     */
    public const AGENT_ROLE_ID = 4;

    /**
     * id => full name, for ids already looked up in this request.
     *
     * A list endpoint resolves the same handful of agents over and over, so
     * without this a page of job orders would be one query per row. A null
     * records an id that is not an agent — either no such user, or a user who is
     * not one — so a number that merely looks like an id is not re-queried on
     * every row either.
     *
     * @var array<int, string|null>
     */
    private static array $names = [];

    /**
     * The stored form of a referral to the given agent, or null.
     *
     * Anything that is not a positive whole number is refused rather than
     * stored: a referral nobody can resolve is worse than no referral at all,
     * because it looks settled and pays nothing.
     */
    public static function encode($agentId): ?string
    {
        if ($agentId === null || $agentId === '' || !is_numeric($agentId)) {
            return null;
        }

        $id = (int) $agentId;

        return $id > 0 ? (string) $id : null;
    }

    /**
     * The user id this value COULD name, or null when it is plainly not one.
     *
     * This is the cheap syntactic half and says nothing about whether the id
     * belongs to an agent — "09077694575" gets a number back from here. Use
     * agentIdIfAgent() where that matters, or displayName(), which applies the
     * role test before it shows anything.
     */
    public static function agentId(?string $referredBy): ?int
    {
        $value = trim((string) $referredBy);

        // ctype_digit rather than is_numeric, so "1e3" and "4.5" read as free
        // text instead of silently becoming ids 1000 and 4. A leading "+" or "-"
        // is refused for the same reason.
        if ($value === '' || !ctype_digit($value)) {
            return null;
        }

        // Leading zeros mean this was never an id: "000201" is a code somebody
        // typed, and ids are not written that way.
        if (strlen($value) > 1 && $value[0] === '0') {
            return null;
        }

        return (int) $value > 0 ? (int) $value : null;
    }

    /**
     * The agent id this value names, or null.
     *
     * The full test: a number AND a user who is an agent. Costs a lookup, which
     * is cached, so prefer priming a page's values in one go.
     */
    public static function agentIdIfAgent(?string $referredBy): ?int
    {
        $id = self::agentId($referredBy);
        if ($id === null) {
            return null;
        }

        self::prime([$referredBy]);

        return self::$names[$id] !== null ? $id : null;
    }

    /** Does this referral name an agent? */
    public static function isAgentId(?string $referredBy): bool
    {
        return self::agentIdIfAgent($referredBy) !== null;
    }

    /**
     * A referral as it should be shown to a person.
     *
     * An agent id becomes their full name; everything else is returned untouched,
     * so every screen that displayed `referred_by` directly keeps showing what it
     * always did — including a number that is not an agent id.
     */
    public static function displayName(?string $referredBy): ?string
    {
        if ($referredBy === null) {
            return null;
        }

        $id = self::agentId($referredBy);
        if ($id === null) {
            return $referredBy;
        }

        self::prime([$referredBy]);

        // A number that is not an agent falls back to itself: it is somebody's
        // phone number or account number, and it should read as one.
        return self::$names[$id] ?? $referredBy;
    }

    /**
     * Load the names behind a set of referrals in one query.
     *
     * Call this before mapping over a list: displayName() on its own is one
     * query per id it has not seen, which on a page of records is a query a row.
     *
     * @param  iterable<string|null>  $values  raw referred_by values
     */
    public static function prime(iterable $values): void
    {
        $wanted = [];

        foreach ($values as $value) {
            if ($value !== null && !is_string($value)) {
                $value = (string) $value;
            }

            $id = self::agentId($value);
            if ($id !== null && !array_key_exists($id, self::$names)) {
                $wanted[$id] = true;
            }
        }

        if ($wanted === []) {
            return;
        }

        // Only agents count. A user who is not one is recorded as a miss, so a
        // legacy value that happens to equal their id keeps displaying as the
        // number it is rather than borrowing their name.
        //
        // Either signal makes somebody an agent: the agent role the pickers list
        // from, or an agent_balance row — the definition the incentive, invoice
        // and payout code all use. Accepting both means an agent whose role was
        // changed after the fact still resolves, rather than their past
        // referrals turning back into bare numbers on every screen.
        $rows = DB::table('users')
            ->leftJoin('agent_balance', 'agent_balance.agent_id', '=', 'users.id')
            ->whereIn('users.id', array_keys($wanted))
            ->where(function ($q) {
                $q->where('users.role_id', self::AGENT_ROLE_ID)
                  ->orWhereNotNull('agent_balance.agent_id');
            })
            ->distinct()
            ->get(['users.id', 'users.first_name', 'users.middle_initial', 'users.last_name']);

        foreach ($rows as $row) {
            $name = self::fullNameOf($row);
            self::$names[(int) $row->id] = $name !== '' ? $name : null;
        }

        // Ids that came back with no row are remembered as misses, so the
        // lookup is not repeated for every row that carries them.
        foreach (array_keys($wanted) as $id) {
            if (!array_key_exists($id, self::$names)) {
                self::$names[$id] = null;
            }
        }
    }

    /**
     * Display labels for a set of referrals, keyed by the stored value.
     *
     * @param  iterable<string|null>  $values
     * @return array<string, string>  stored value => label
     */
    public static function displayNames(iterable $values): array
    {
        $values = is_array($values) ? $values : iterator_to_array($values);

        self::prime($values);

        $labels = [];
        foreach ($values as $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $labels[(string) $value] = (string) self::displayName((string) $value);
        }

        return $labels;
    }

    /**
     * "First M. Last", the format the User model's full_name accessor uses and
     * the one the agent pickers show.
     *
     * @param  object|array|null  $user  anything carrying the three name columns
     */
    public static function fullNameOf($user): string
    {
        if ($user === null) {
            return '';
        }

        $get = static function ($key) use ($user) {
            if (is_array($user)) {
                return $user[$key] ?? '';
            }
            return $user->{$key} ?? '';
        };

        $first  = trim((string) $get('first_name'));
        $middle = trim((string) $get('middle_initial'));
        $last   = trim((string) $get('last_name'));

        // The dot is part of the format the pickers render, so a name built
        // here matches one built there — and a legacy referral written by the
        // old picker still equals the name shown for the new one.
        $middle = $middle !== '' ? rtrim($middle, '.') . '.' : '';

        return trim(preg_replace('/\s+/', ' ', trim("{$first} {$middle} {$last}")));
    }

    /**
     * Narrow a query to the referrals that could belong to one agent.
     *
     * This is the SQL half of the match and deliberately returns a superset:
     * the exact decision stays with AgentProgramme::referralBelongsToAgent(),
     * which every caller already applies afterwards. Its job is only to keep a
     * paged list from being filled with other agents' rows.
     *
     * The id clause is what makes a referral made through the picker findable
     * at all — a stored "37" contains none of the agent's name, so the LIKE
     * clauses alone would never return it.
     *
     * @param  \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder  $q
     * @param  string  $column  the referred_by column, qualified where the query joins
     */
    public static function narrow($q, string $column, $agentId, string $first, string $last, string $email): void
    {
        $q->where(function ($inner) use ($column, $agentId, $first, $last, $email) {
            $id = self::encode($agentId);
            if ($id !== null) {
                $inner->orWhere($column, $id);
            }

            if ($email !== '') {
                $inner->orWhere($column, $email);
            }

            if ($first !== '' || $last !== '') {
                $inner->orWhere(function ($name) use ($column, $first, $last) {
                    if ($first !== '') {
                        $name->where($column, 'like', '%' . $first . '%');
                    }
                    if ($last !== '') {
                        $name->where($column, 'like', '%' . $last . '%');
                    }
                });
            }
        });
    }

    /**
     * Drops every cached lookup.
     *
     * For tests and long-running workers, where an agent renamed mid-run would
     * otherwise keep the name it had when the process started.
     */
    public static function flush(): void
    {
        self::$names = [];
    }
}
