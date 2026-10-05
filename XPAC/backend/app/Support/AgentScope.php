<?php

namespace App\Support;

/**
 * What a logged-in Agent may see outside the agent module: their own transactions, and the
 * customer accounts they referred.
 *
 *   Transactions  processed (or recorded) by the agent — processed_by_user / created_by_user hold
 *                 the email of whoever recorded the payment.
 *   Accounts      customers whose referred_by belongs to the agent, decided by
 *                 AgentProgramme::referralBelongsToAgent() — the same exact rule commissions are
 *                 settled with. referred_by holds the agent's id (picker-made referrals) or older
 *                 free text (their name/email); both are covered.
 *
 * Enforced server-side so a direct API call sees exactly what the screen does.
 */
class AgentScope
{
    public static function isAgent($user): bool
    {
        if (!$user) {
            return false;
        }

        return AgentAccess::isAgent($user)
            || strtolower(trim((string) ($user->role->role_name ?? ''))) === 'agent';
    }

    public static function email($user): string
    {
        return trim((string) ($user->email_address ?? $user->email ?? ''));
    }

    /** Limit a transactions query to the agent's own rows. */
    public static function limitTransactions($query, $user): void
    {
        $email = self::email($user);

        $query->where(function ($q) use ($email) {
            if ($email === '') {
                // No email to match on: an agent who cannot be identified sees nothing.
                $q->whereRaw('1 = 0');
                return;
            }
            $q->where('processed_by_user', $email)->orWhere('created_by_user', $email);
        });
    }

    /** May this agent see this transaction? */
    public static function ownsTransaction($user, $transaction): bool
    {
        $email = strtolower(self::email($user));
        if ($email === '' || !$transaction) {
            return false;
        }

        // The raw column: Transaction::getProcessedByUserAttribute() swaps in the processor's
        // full name when that relation is loaded.
        $processed = method_exists($transaction, 'getRawOriginal')
            ? $transaction->getRawOriginal('processed_by_user')
            : ($transaction->processed_by_user ?? null);
        $created = method_exists($transaction, 'getRawOriginal')
            ? $transaction->getRawOriginal('created_by_user')
            : ($transaction->created_by_user ?? null);

        return strtolower(trim((string) $processed)) === $email
            || strtolower(trim((string) $created)) === $email;
    }

    /**
     * SQL pre-filter for referrals that could be this agent's. A superset by design (name LIKEs);
     * ownsReferral() makes the exact decision on the rows it returns.
     */
    public static function narrowReferrals($query, string $column, $user): void
    {
        AgentReferral::narrow(
            $query,
            $column,
            $user->id ?? null,
            trim((string) ($user->first_name ?? '')),
            trim((string) ($user->last_name ?? '')),
            self::email($user)
        );
    }

    /** Is this stored referred_by value this agent's? */
    public static function ownsReferral($user, ?string $referredBy): bool
    {
        if ($referredBy === null || trim($referredBy) === '') {
            return false;
        }

        return AgentProgramme::referralBelongsToAgent(
            $referredBy,
            AgentReferral::fullNameOf($user),
            self::email($user),
            $user->id ?? null
        );
    }
}
