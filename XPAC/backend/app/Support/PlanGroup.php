<?php

namespace App\Support;

/**
 * Plan-label / RADIUS-group identity.
 *
 * One place decides whether two plan labels name the same plan, because three
 * services used to answer it differently and each disagreement surfaced to an
 * operator as a discrepancy that was not real.
 *
 * The rule is the one Job Order account creation already applies when it decides
 * which User Manager group to create a subscriber in: the *first word* of the plan
 * label is the group. Everything after it is presentation — a price ("SWIFT 1000"),
 * a priced suffix ("STARTER - P799.00"), a disabled marker ("FLASH (Disabled)") —
 * and none of it reaches the device. Comparing whole labels therefore reports a
 * mismatch for two names that provision identically, which is the false discrepancy
 * this class exists to remove.
 *
 * @see \App\Http\Controllers\JobOrderController::class the creation path this mirrors
 */
final class PlanGroup
{
    /**
     * The first word of a plan label — the group name a device actually stores.
     *
     * Deliberately the plain first token of the trimmed label rather than a price
     * regex: `explode(' ', trim($plan))[0]` is what the Job Order path reduces to for
     * every label format this deployment uses, and a token split cannot be defeated
     * by a price format nobody anticipated.
     */
    public static function firstWord(?string $label): string
    {
        $label = self::normalize($label);

        if ($label === '') {
            return '';
        }

        return trim(explode(' ', $label)[0]);
    }

    /**
     * Reduce a priced plan label to the bare group name.
     *
     * Kept alongside {@see firstWord()} because a deployment whose labels read
     * "FIBER PLUS - P1499" means "FIBER PLUS", not "FIBER". Callers that compare use
     * {@see matches()}, which accepts either reading, so neither convention produces
     * a false mismatch.
     */
    public static function bare(?string $label): string
    {
        $label = self::normalize($label);

        if ($label === '') {
            return '';
        }

        if (str_contains($label, ' - ')) {
            return trim(explode(' - ', $label, 2)[0]);
        }

        return trim(strtok($label, ' ') ?: $label);
    }

    /**
     * Do these two labels name the same plan?
     *
     * Permissive by design, and only ever in the direction of agreement: a label is
     * matched on its whole value, on its bare group, or on its first word. Being
     * wrong here costs a discrepancy that is not raised; the opposite error puts a
     * healthy subscriber on an operator's worklist every single sweep.
     *
     * Two blanks agree — neither side has an opinion, which is not a disagreement.
     * One blank against a value does not.
     */
    public static function matches(?string $left, ?string $right): bool
    {
        $left  = self::normalize($left);
        $right = self::normalize($right);

        if ($left === '' && $right === '') {
            return true;
        }

        if ($left === '' || $right === '') {
            return false;
        }

        if (strcasecmp($left, $right) === 0) {
            return true;
        }

        $leftBare  = self::bare($left);
        $rightBare = self::bare($right);

        if ($leftBare !== '' && strcasecmp($leftBare, $rightBare) === 0) {
            return true;
        }

        // A bare group on one side against a priced label on the other.
        if ($leftBare !== '' && strcasecmp($left, $rightBare) === 0) {
            return true;
        }

        if ($rightBare !== '' && strcasecmp($right, $leftBare) === 0) {
            return true;
        }

        $leftWord  = self::firstWord($left);
        $rightWord = self::firstWord($right);

        return $leftWord !== '' && strcasecmp($leftWord, $rightWord) === 0;
    }

    /**
     * Trim, collapse whitespace, and drop the "(Disabled)" marker User Manager
     * appends to a parked group — it describes the account's state, not its plan.
     */
    private static function normalize(?string $label): string
    {
        $label = trim((string) $label);

        if ($label === '') {
            return '';
        }

        $label = preg_replace('/\s*\(Disabled\)\s*$/i', '', $label) ?? $label;
        $label = preg_replace('/\s+/', ' ', $label) ?? $label;

        return trim($label);
    }
}
