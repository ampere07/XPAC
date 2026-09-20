<?php

namespace Tests\Unit;

use App\Support\AgentProgramme;
use App\Support\AgentReferral;
use PHPUnit\Framework\TestCase;

/**
 * What a "Referred By" value means.
 *
 * The pickers store the agent's user id — plain, "37" — and show their name.
 * Everything that pays an agent reads this column, so the two things these lock
 * down are: an id resolves to exactly one account, and the free text already in
 * the column keeps behaving exactly as it did.
 *
 * A NUMBER IS NOT ENOUGH TO MAKE IT AN ID. agentId() below is only the cheap
 * syntactic half — it hands back a number for "1840" and for a mobile number
 * written without its leading zero. Whether that number is an AGENT is decided
 * by displayName()/agentIdIfAgent(), which read the users table and so belong in
 * a feature test with a database behind it rather than here.
 *
 * The web and mobile clients carry the same rules in agentReferral.ts and
 * referredByField.ts; referredByField.test.ts asserts the same cases, so a
 * change made to one side and not the other fails on this side too.
 */
class AgentReferralTest extends TestCase
{
    public function test_the_stored_form_is_the_plain_id(): void
    {
        $this->assertSame('37', AgentReferral::encode(37));
        $this->assertSame('37', AgentReferral::encode('37'));
        $this->assertSame(37, AgentReferral::agentId('37'));
    }

    public function test_it_refuses_an_id_it_could_not_resolve_later(): void
    {
        // A referral nobody can resolve is worse than no referral at all: it
        // looks settled and pays nothing.
        $this->assertNull(AgentReferral::encode(null));
        $this->assertNull(AgentReferral::encode(''));
        $this->assertNull(AgentReferral::encode(0));
        $this->assertNull(AgentReferral::encode(-1));
        $this->assertNull(AgentReferral::encode('abc'));
    }

    /** @dataProvider notNumeric */
    public function test_anything_non_numeric_is_free_text(string $value): void
    {
        $this->assertNull(AgentReferral::agentId($value));
    }

    public static function notNumeric(): array
    {
        return [
            'exponent notation' => ['1e3'],
            'a decimal'         => ['4.5'],
            'a negative'        => ['-7'],
            'a signed number'   => ['+7'],
            'digits with a gap' => ['3 7'],
            'a team name'       => ['Team Beth'],
            'unstructured text' => ['Walk in'],
            'a legacy name'     => ['Juan Dela Cruz'],
            'nothing'           => [''],
        ];
    }

    /**
     * A leading zero is proof it was never an id.
     *
     * "000201" is a code somebody typed and "09077694575" is a phone number.
     * Reading either as a user id would borrow that account's name for a
     * referral that was never theirs — this is the one collision the guard can
     * rule out from the value alone, without asking the database.
     *
     * @dataProvider leadingZero
     */
    public function test_a_leading_zero_is_never_an_id(string $value): void
    {
        $this->assertNull(AgentReferral::agentId($value));
    }

    public static function leadingZero(): array
    {
        return [
            'a typed code'     => ['000201'],
            'a mobile number'  => ['09077694575'],
            'a long code'      => ['008150126991'],
            'zero itself'      => ['0'],
        ];
    }

    /**
     * The rest of the numeric free text parses as a number, and only the roster
     * lookup can tell it apart from a referral.
     *
     * Asserted so the boundary is written down: these values reach the role test
     * in prime(), and it is that test — not this one — that keeps them from
     * borrowing somebody's name.
     */
    public function test_other_numbers_are_only_syntactically_ids(): void
    {
        $this->assertSame(1840, AgentReferral::agentId('1840'));
        $this->assertSame(20220006245, AgentReferral::agentId('20220006245'));
    }

    public function test_it_builds_the_name_the_pickers_show(): void
    {
        $this->assertSame('Jherwen T. Telen', AgentReferral::fullNameOf(
            (object) ['first_name' => 'Jherwen', 'middle_initial' => 'T', 'last_name' => 'Telen']
        ));

        // A middle initial already carrying its dot must not gain a second one,
        // or the name stops equalling the one a legacy referral was written with.
        $this->assertSame('Jherwen T. Telen', AgentReferral::fullNameOf(
            (object) ['first_name' => 'Jherwen', 'middle_initial' => 'T.', 'last_name' => 'Telen']
        ));

        $this->assertSame('Brigs Ranay', AgentReferral::fullNameOf(
            ['first_name' => 'Brigs', 'middle_initial' => '', 'last_name' => 'Ranay']
        ));

        $this->assertSame('', AgentReferral::fullNameOf(null));
    }

    public function test_an_id_referral_belongs_to_exactly_one_agent(): void
    {
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('37', 'Brigs Ranay', 'brigs@x.com', 37));
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('37', 'Brigs Ranay', 'brigs@x.com', '37'));
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('37', 'Edith Naviza', 'edith@x.com', 24));
    }

    public function test_a_numeric_referral_never_falls_back_to_the_name_match(): void
    {
        // A number is not a name. Letting it reach the tolerant branch could only
        // ever produce a wrong answer, so a caller that does not pass the id gets
        // a rejection rather than a guess.
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('37', 'Brigs Ranay', 'brigs@x.com'));

        // And a number nobody holds matches nobody, which is what it did before.
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('1840', 'Brigs Ranay', 'brigs@x.com', 37));
    }

    public function test_the_legacy_name_matching_is_unchanged(): void
    {
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('John Rusell Ampere', 'John Ampere', '', 5));
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('Brigs Ranay', 'Brigs Ranay', '', 37));
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('brigs@x.com', 'Brigs Ranay', 'brigs@x.com', 37));

        $this->assertFalse(AgentProgramme::referralBelongsToAgent('someone else', 'Brigs Ranay', '', 37));
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('', 'Brigs Ranay', 'brigs@x.com', 37));
        $this->assertFalse(AgentProgramme::referralBelongsToAgent(null, 'Brigs Ranay', 'brigs@x.com', 37));

        // A team name matches nobody, which is what leaves those referrals unpaid
        // and is the behaviour agents:export-team-referrals exists to report on.
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('Team Beth', 'Brigs Ranay', 'brigs@x.com', 37));

        // A phone number still goes down the name path and still matches nobody.
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('09077694575', 'Brigs Ranay', 'brigs@x.com', 37));
    }

    public function test_the_three_argument_call_sites_still_behave_as_before(): void
    {
        // The id argument is optional, so nothing that has not been updated changed.
        $this->assertTrue(AgentProgramme::referralBelongsToAgent('Brigs Ranay', 'Brigs Ranay', ''));
        $this->assertFalse(AgentProgramme::referralBelongsToAgent('Walk in', 'Brigs Ranay', ''));
    }

    /** @dataProvider freeTextToDisplay */
    public function test_free_text_needs_no_lookup_to_display(?string $value, ?string $expected): void
    {
        // No database is touched for a value that is not a number, which is what
        // keeps the resolution free for the overwhelming majority of rows — and
        // is why this can be asserted without one.
        $this->assertSame($expected, AgentReferral::displayName($value));
    }

    public static function freeTextToDisplay(): array
    {
        return [
            'a team name'      => ['Team Beth', 'Team Beth'],
            'a legacy name'    => ['Juan Dela Cruz', 'Juan Dela Cruz'],
            'a mobile number'  => ['09077694575', '09077694575'],
            'unstructured'     => ['Walk in', 'Walk in'],
            'null'             => [null, null],
        ];
    }

    public function test_the_sql_narrowing_carries_the_id_clause(): void
    {
        // Without this clause a referral stored as "37" is invisible to every
        // list and every payout query — it holds none of the agent's name.
        $recorder = $this->queryRecorder();
        AgentReferral::narrow($recorder, 'a.referred_by', 37, 'Brigs', 'Ranay', 'brigs@x.com');

        $this->assertContains(['orWhere', 'a.referred_by', '37', null], $recorder->calls);
        $this->assertContains(['orWhere', 'a.referred_by', 'brigs@x.com', null], $recorder->calls);
    }

    public function test_the_narrowing_is_unchanged_when_there_is_no_id(): void
    {
        $recorder = $this->queryRecorder();
        AgentReferral::narrow($recorder, 'a.referred_by', null, 'Brigs', 'Ranay', '');

        // Only the two name LIKEs — no id clause was added.
        $this->assertCount(2, $recorder->calls);
        foreach ($recorder->calls as $call) {
            $this->assertSame('like', $call[2]);
        }
    }

    /** A stand-in for the query builder that records the clauses it is given. */
    private function queryRecorder(): object
    {
        return new class {
            public array $calls = [];

            public function where($a, $b = null, $c = null)
            {
                if (is_callable($a)) {
                    $a($this);
                    return $this;
                }
                $this->calls[] = ['where', $a, $b, $c];
                return $this;
            }

            public function orWhere($a, $b = null, $c = null)
            {
                if (is_callable($a)) {
                    $a($this);
                    return $this;
                }
                $this->calls[] = ['orWhere', $a, $b, $c];
                return $this;
            }
        };
    }
}
