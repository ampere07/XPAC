<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * One answer to "which plan is this?", for a system that currently has four.
 *
 * `plan_list` is the master table and `billing_accounts.plan_id` points at it,
 * but that is only half the data. The other half names its plan in free text —
 * `customers.desired_plan`, `applications.desired_plan`, `service_orders.old_plan`
 * and `new_plan`, `pending_payments.plan` — and those columns hold every spelling
 * the last few years of data entry and migration produced:
 *
 *     PLAN-A          the id-ish form, with a dash
 *     PLAN A          the same thing, spaced
 *     PLAN A - 1500   the name with its price appended
 *     1500/50mbps     price and speed, no name at all
 *     Fiber 50 Mbps   the speed, described
 *
 * All five are one plan. Reported separately they become five plans, and any
 * figure grouped by plan — revenue mix, subscriber distribution, the pie on the
 * executive dashboard — is wrong by however the tail happens to split that day.
 *
 * This class is the single place that decides. Everything that needs to turn a
 * plan string into a plan goes through resolve(); everything that needs to print
 * one goes through label(). Two code paths spelling the same plan differently is
 * the bug this exists to make impossible.
 *
 * ── Matching is layered, and it refuses ties ──────────────────────────
 *
 * Four passes, each stricter than a person eyeballing the list would be:
 *
 *   1. exact       the normalised names are identical
 *   2. compact     identical once punctuation is dropped, so "PLAN-A" finds
 *                  "PLAN A"
 *   3. speed       the same Mbps figure, when exactly one plan carries it
 *   4. price       the same bare number, when exactly one plan carries it
 *
 * Passes 3 and 4 fire only when the signature belongs to exactly *one* plan.
 * Two plans at 50 Mbps make "50mbps" ambiguous, and quietly assigning an account
 * to whichever sorted first would move a subscriber — and their revenue —
 * between plans on a report management reads as fact. An ambiguous string stays
 * unresolved, which is visible and fixable; a confident wrong answer is neither.
 *
 * ── Why this is a read-side resolver, not a migration ─────────────────
 *
 * Nothing here writes. Backfilling the ids it infers is a separate, deliberate
 * act with a review step in front of it — see the `plans:audit` command, which
 * reports what it would change and only writes under --commit.
 *
 * The matching rules are deliberately identical to MONITOR's PlanReconciler.
 * The two systems report the same plans to the same people, and two matchers
 * that disagree in the tail would put two different subscriber counts on two
 * screens with no way to tell which was right.
 */
class PlanIdentity
{
    /** How a plan may be printed. See label(). */
    public const STYLE_NAME = 'name';
    public const STYLE_NAME_PRICE = 'name_price';
    public const STYLE_DASH = 'dash';

    /** The free-text plan columns this system still carries, table => column. */
    public const FREE_TEXT_COLUMNS = [
        'customers' => 'desired_plan',
        'applications' => 'desired_plan',
        'service_orders' => 'new_plan',
        'pending_payments' => 'plan',
    ];

    /** @var array<int,array{id:int,name:string,price:float}> keyed by plan id */
    private array $plans = [];

    /** @var array<string,int> normalised name => plan id */
    private array $byExact = [];

    /** @var array<string,int> alphanumeric-only name => plan id */
    private array $byCompact = [];

    /** @var array<string,int[]> "50mbps" => plan ids carrying that speed */
    private array $bySpeed = [];

    /** @var array<string,int[]> "1500" => plan ids carrying that number */
    private array $byNumber = [];

    /** Built once per request: the table is small and never changes mid-run. */
    private static ?self $shared = null;

    /**
     * The shared instance, built from `plan_list` on first use.
     *
     * Callers in a loop must use this rather than fromRows(), or a per-row
     * rebuild turns one query into one query per account — the N+1 this class is
     * otherwise in a good position to cause.
     */
    public static function make(): self
    {
        if (self::$shared === null) {
            self::$shared = self::fromRows(
                DB::table('plan_list')->select('id', 'plan_name', 'price')->get()->all()
            );
        }

        return self::$shared;
    }

    /** Drops the cache. For tests, and for a long-running worker. */
    public static function flush(): void
    {
        self::$shared = null;
    }

    /** @param iterable<object|array> $rows plan_list records */
    public static function fromRows(iterable $rows): self
    {
        $identity = new self();

        foreach ($rows as $row) {
            $row = (object) $row;

            $id = (int) ($row->id ?? 0);
            $name = trim((string) ($row->plan_name ?? ''));

            if ($id <= 0 || $name === '') {
                continue;
            }

            $identity->plans[$id] = [
                'id' => $id,
                'name' => $name,
                'price' => round((float) ($row->price ?? 0), 2),
            ];

            // First writer wins on the unique indexes. `plan_list.plan_name` is
            // unique in the schema, so a collision here means two names that
            // differ only in case or punctuation — either is as good an answer as
            // the other, and stability beats arbitrating between them.
            $identity->byExact[self::normalise($name)] ??= $id;
            $identity->byCompact[self::compact($name)] ??= $id;

            foreach (self::speeds($name) as $speed) {
                $identity->bySpeed[$speed][] = $id;
            }

            foreach (self::numbers($name) as $number) {
                $identity->byNumber[$number][] = $id;
            }

            // The plan's actual price is a signature too, not just any digits
            // that happen to be in its name. Without this a plan called "PLAN A"
            // priced at 1500 cannot be reached from "PLAN A - 1500" — which is
            // precisely the spelling the free-text columns are full of, because
            // the old application form rendered the price into the label.
            //
            // Floored at 100: below that a "price" collides with speeds, tier
            // numbers and contract lengths, and matching an account on a
            // two-digit number is how a ₱50 promo swallows a 50 Mbps plan.
            foreach ($identity->priceKeys($id) as $priceKey) {
                $identity->byNumber[$priceKey][] = $id;
            }
        }

        return $identity;
    }

    /**
     * The number-signature keys a plan's price should answer to.
     *
     * Both the whole-peso form and the two-decimal form, because the free text
     * carries both — "PLAN A - 1500" and "PLAN A - 1500.00" are the same label
     * printed by two different versions of the same form.
     *
     * @return string[]
     */
    private function priceKeys(int $id): array
    {
        $price = $this->plans[$id]['price'] ?? 0.0;

        if ($price < 100) {
            return [];
        }

        $keys = [(string) (int) round($price)];

        if (abs($price - round($price)) > 0.001) {
            $keys[] = number_format($price, 2, '.', '');
        }

        return array_values(array_unique($keys));
    }

    /** @return array<int,array{id:int,name:string,price:float}> */
    public function all(): array
    {
        return $this->plans;
    }

    /** @return array{id:int,name:string,price:float}|null */
    public function plan(?int $id): ?array
    {
        return $id === null ? null : ($this->plans[$id] ?? null);
    }

    public function exists(?int $id): bool
    {
        return $this->plan($id) !== null;
    }

    /**
     * The canonical plan id a value refers to, or null when nothing claims it
     * unambiguously.
     *
     * Accepts an id as well as a name, so a caller holding either can ask the
     * same question. A numeric string that is not a known plan id falls through
     * to name matching rather than being trusted — "1500" is a price in this
     * data far more often than it is a plan id.
     */
    public function resolve($value): ?int
    {
        if ($value === null) {
            return null;
        }

        if (is_int($value) || (is_string($value) && ctype_digit($value))) {
            $asId = (int) $value;

            if (isset($this->plans[$asId])) {
                return $asId;
            }
        }

        $raw = trim((string) $value);

        if ($raw === '') {
            return null;
        }

        $exact = self::normalise($raw);

        if ($exact !== '' && isset($this->byExact[$exact])) {
            return $this->byExact[$exact];
        }

        $compact = self::compact($raw);

        if ($compact !== '' && isset($this->byCompact[$compact])) {
            return $this->byCompact[$compact];
        }

        // Signature passes, unambiguous only. See the class comment.
        foreach (self::speeds($raw) as $speed) {
            $owners = array_unique($this->bySpeed[$speed] ?? []);

            if (count($owners) === 1) {
                return (int) reset($owners);
            }
        }

        foreach (self::numbers($raw) as $number) {
            $owners = array_unique($this->byNumber[$number] ?? []);

            if (count($owners) === 1) {
                return (int) reset($owners);
            }
        }

        return null;
    }

    /**
     * Why a value did not resolve — 'ambiguous' or 'unknown'.
     *
     * The two need different fixes and lumping them together is what makes an
     * audit report useless. Ambiguous means the plans themselves are named too
     * alike and the *plan list* wants attention; unknown means one account holds
     * a string nothing recognises and the *account* wants attention.
     */
    public function why($value): string
    {
        if ($this->resolve($value) !== null) {
            return 'resolved';
        }

        $raw = trim((string) $value);

        foreach (self::speeds($raw) as $speed) {
            if (count(array_unique($this->bySpeed[$speed] ?? [])) > 1) {
                return 'ambiguous';
            }
        }

        foreach (self::numbers($raw) as $number) {
            if (count(array_unique($this->byNumber[$number] ?? [])) > 1) {
                return 'ambiguous';
            }
        }

        return 'unknown';
    }

    /**
     * A plan printed one way, deliberately.
     *
     * The three styles are the three spellings already in the data. They are
     * offered as an explicit choice so a screen that wants the price in the label
     * asks for it, rather than a second code path inventing "NAME - PRICE" with
     * its own spacing and drifting from this one.
     */
    public function label(?int $id, string $style = self::STYLE_NAME): string
    {
        $plan = $this->plan($id);

        if ($plan === null) {
            return '';
        }

        switch ($style) {
            case self::STYLE_NAME_PRICE:
                // Trailing ".00" dropped: plan prices are whole pesos in this
                // data and "PLAN A - 1500.00" is noise on a card.
                $price = rtrim(rtrim(number_format($plan['price'], 2, '.', ''), '0'), '.');

                return $price === '' || $plan['price'] <= 0
                    ? $plan['name']
                    : "{$plan['name']} - {$price}";

            case self::STYLE_DASH:
                return str_replace(' ', '-', $plan['name']);

            default:
                return $plan['name'];
        }
    }

    /**
     * Lower-cased, punctuation-flattened, whitespace-collapsed.
     *
     * Separators become spaces rather than vanishing, so "1500/50mbps" yields the
     * tokens "1500" and "50mbps" instead of one run-on word.
     */
    public static function normalise(string $value): string
    {
        $value = strtolower(trim($value));
        $value = str_replace(['₱', 'php', 'pesos', 'peso'], ' ', $value);
        $value = preg_replace('/[^a-z0-9]+/', ' ', $value) ?? '';

        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    /** Alphanumeric only, so spacing and punctuation cannot separate a match. */
    public static function compact(string $value): string
    {
        return str_replace(' ', '', self::normalise($value));
    }

    /**
     * Every bandwidth figure in a string, as "<n>mbps".
     *
     * Handles the spellings the data carries — "50Mbps", "50 MBPS", "50mb",
     * "50 M" — and converts Gbps to its Mbps equivalent so a plan recorded both
     * ways still matches itself.
     *
     * @return string[]
     */
    public static function speeds(string $value): array
    {
        $normalised = self::normalise($value);
        $found = [];

        if (preg_match_all('/(\d+(?:\s*\.\s*\d+)?)\s*(gbps|gb|g|mbps|mb|m)\b/', $normalised, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $amount = (float) str_replace(' ', '', $match[1]);

                if ($amount <= 0) {
                    continue;
                }

                if (in_array($match[2], ['gbps', 'gb', 'g'], true)) {
                    $amount *= 1000;
                }

                // Formatted without decimals: 50.0 and 50 are the same speed and
                // must produce the same key.
                $found[] = rtrim(rtrim(number_format($amount, 2, '.', ''), '0'), '.') . 'mbps';
            }
        }

        return array_values(array_unique($found));
    }

    /**
     * Bare numbers in a string, used as a last-resort price signature.
     *
     * Numbers carrying a bandwidth unit are excluded — those were already tried
     * as speeds, and re-testing "50" from "50Mbps" as a price is how a 50 Mbps
     * plan gets matched to a ₱50 one.
     *
     * @return string[]
     */
    public static function numbers(string $value): array
    {
        $normalised = self::normalise($value);
        $speedTokens = [];

        if (preg_match_all('/(\d+(?:\s*\.\s*\d+)?)\s*(?:gbps|gb|g|mbps|mb|m)\b/', $normalised, $matches)) {
            $speedTokens = array_map(fn ($n) => str_replace(' ', '', $n), $matches[1]);
        }

        $found = [];

        if (preg_match_all('/\b(\d+)\b/', $normalised, $matches)) {
            foreach ($matches[1] as $number) {
                // One- and two-digit numbers are almost always a speed, a tier
                // index or a contract length rather than a price, and are far too
                // collision-prone to reassign a subscriber on.
                if (in_array($number, $speedTokens, true) || strlen($number) < 3) {
                    continue;
                }

                $found[] = $number;
            }
        }

        return array_values(array_unique($found));
    }
}
