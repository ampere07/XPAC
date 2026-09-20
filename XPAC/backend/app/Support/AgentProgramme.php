<?php

namespace App\Support;

use Carbon\Carbon;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Scope rules shared by everything that rewards an agent for a referral.
 *
 * Incentives and achievements both decide which of an agent's referrals count,
 * and they must never disagree: a referral that earns incentive progress has to
 * be the same referral that moves the weekly and monthly achievement counts, or
 * an agent sees two different totals for the same work and neither reconciles
 * with their Job Order list.
 *
 * Kept here rather than on either of them so neither owns the rule, and so a
 * controller does not have to reach into a cron service to ask what it is.
 */
class AgentProgramme
{
    /**
     * The day the agent programme starts counting, or null to count everything.
     *
     * An unreadable or malformed configured value counts everything, which
     * leaves behaviour as it was before a start date existed. Failing the other
     * way would silently stop every agent earning.
     */
    public static function startDate(): ?Carbon
    {
        $configured = config('agent.start_date');

        if ($configured === null || $configured === '') {
            return null;
        }

        try {
            return Carbon::parse($configured)->startOfDay();
        } catch (Throwable $e) {
            Log::warning('[Agent] Ignoring an unreadable agent.start_date: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * SQL for when a referral counts as onboarded.
     *
     * The installation date, falling back to when the job order was raised and
     * then to when the row was created — so a completed referral is never
     * silently uncounted for want of one field.
     *
     * @param  string  $table  the job_orders alias in the query being built
     */
    public static function onboardedAtSql(string $table = 'job_orders'): string
    {
        return "COALESCE({$table}.date_installed, {$table}.timestamp, {$table}.created_at)";
    }

    /**
     * Does this "Referred By" value belong to the given agent?
     *
     * A referral made through the agent picker holds the agent's user id, and
     * that settles it outright: an id names exactly one account, so it is
     * checked first and nothing else is consulted. Passing $agentId is what
     * lets a caller take that path — without it a numeric referral can only
     * ever be rejected, because it carries none of the agent's name.
     *
     * Older referrals are free text, so that match has to stay tolerant: every
     * word of the agent's name must appear in the referral, which accepts
     * "John Rusell Ampere" for an account named "John Ampere" while still
     * rejecting an unrelated name. An exact email match is accepted too.
     *
     * A NUMERIC referral never falls back to the name match, even when it is
     * not this agent's id — a number is not a name, and letting it reach the
     * tolerant branch could only ever produce a wrong answer. The "is it really
     * an agent" test AgentReferral applies for display is implicit here: every
     * caller takes $agentId off an agent roster, so an id that equals it is an
     * agent's by construction and a legacy number that matches no agent's id
     * falls out as unmatched — which is what it was before.
     *
     * Lives here because incentives, achievements and invoices all have to
     * agree about whose referral a customer is — a team invoice attributing a
     * customer to the wrong member would be visible on the document.
     *
     * The web and mobile apps carry the same rule in agentReferral.ts, and a
     * simulation checks all three still agree.
     */
    public static function referralBelongsToAgent(?string $referredBy, string $fullName, string $email, $agentId = null): bool
    {
        // A numeric referral is decided here and goes no further.
        $referralId = AgentReferral::agentId($referredBy);
        if ($referralId !== null) {
            return $agentId !== null
                && is_numeric($agentId)
                && (int) $agentId === $referralId;
        }

        $normalize = function ($value): string {
            $value = mb_strtolower((string) $value);
            $value = str_replace(['.', ','], ' ', $value);
            return trim(preg_replace('/\s+/', ' ', $value));
        };

        $ref = $normalize($referredBy);
        if ($ref === '') {
            return false;
        }

        // Compare the email against the RAW referral, not the normalized one:
        // $normalize turns dots into spaces, so "juan@x.com" would become
        // "juan@x com" and could never equal the address it came from.
        $em = trim(mb_strtolower($email));
        if ($em !== '' && trim(mb_strtolower((string) $referredBy)) === $em) {
            return true;
        }

        $fn = $normalize($fullName);
        if ($fn === '') {
            return false;
        }
        if ($ref === $fn) {
            return true;
        }

        $refTokens  = explode(' ', $ref);
        $nameTokens = array_filter(explode(' ', $fn), fn ($t) => mb_strlen($t) >= 2);
        if (empty($nameTokens)) {
            return false;
        }

        foreach ($nameTokens as $token) {
            if (!in_array($token, $refTokens, true)) {
                return false;
            }
        }

        return true;
    }
}
