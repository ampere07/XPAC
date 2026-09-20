<?php

namespace App\Support;

/**
 * When a service order is a pullout, and when that pullout closes the
 * customer's portal login.
 *
 * `users.active` is the column the sign-in gates on: routes/api.php refuses a
 * row with `active = 0` and answers `status: 'suspended'`. Exactly one act sets
 * it to 0 — a service order saved with a pullout repair category and the visit
 * marked Done — and that rule lived as a bare array literal repeated in four
 * places across two controllers, where the trigger and the re-entry guard could
 * drift apart without anything noticing. It lives here instead.
 *
 * Spelling is not part of the decision. "Pullout", "Pull Out", "for pullout"
 * and "FOR PULL OUT" are the same instruction typed by different people, so the
 * value is folded to lower case and stripped of whitespace before it is
 * compared. Anything else — including a blank category — is not a pullout.
 *
 * The `concern` column is deliberately NOT consulted. It used to be, which meant
 * a ticket raised with concern "for pullout" disabled the login the moment any
 * visit on it was marked Done, whatever work the technician actually recorded.
 * The repair category is the field the edit modal makes them choose when they
 * set the visit to Done, so the act that takes away a customer's login is now
 * one a person deliberately recorded.
 */
final class PulloutCategory
{
    /**
     * The accepted categories, folded the way `fold()` folds an input:
     * lower case, no whitespace.
     */
    private const CANONICAL = ['pullout', 'forpullout'];

    /** The visit status a pullout has to reach before it counts. */
    private const COMPLETED_VISIT = 'done';

    /** Lower-case and drop all whitespace, so spacing cannot change the meaning. */
    private static function fold(?string $value): string
    {
        return preg_replace('/\s+/u', '', strtolower(trim((string) $value)));
    }

    /** Is this repair category a pullout, however it is spelled? */
    public static function matches(?string $repairCategory): bool
    {
        return in_array(self::fold($repairCategory), self::CANONICAL, true);
    }

    /** Has this visit been completed? */
    public static function visitIsDone(?string $visitStatus): bool
    {
        return self::fold($visitStatus) === self::COMPLETED_VISIT;
    }

    /**
     * The whole rule: a pullout category AND a completed visit.
     *
     * Callers pass the values from the SAVED ROW, not from the request — a
     * request that merely claims Done must not disable a login the record never
     * recorded as pulled out, and a request that only sets the category must not
     * inherit a Done left behind by an earlier, unrelated visit.
     */
    public static function deactivatesPortalLogin(?string $repairCategory, ?string $visitStatus): bool
    {
        return self::matches($repairCategory) && self::visitIsDone($visitStatus);
    }
}
