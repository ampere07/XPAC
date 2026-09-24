<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Enforces "one live login per technician".
 *
 * A technician who is already signed in on another device does not get silently signed in a
 * second time. The login is refused with a 409 the client turns into a confirmation prompt,
 * and only a deliberate `force_login` retry takes the account over.
 *
 * Applies to technicians only. Every entry point is a no-op for other roles, so admin, agent
 * and customer logins keep behaving exactly as they did.
 *
 * Ending the other device's login takes three things, and all three are needed — any one of
 * them left out and the old device stays signed in:
 *
 *   the tracking row   removed, so the account no longer counts as signed in anywhere
 *   the session        destroyed through the configured session handler, so the cookie the
 *                      old device holds resolves to nothing
 *   remember_token     cleared, because a live recaller cookie would otherwise rebuild the
 *                      session on the old device's very next request and undo the takeover.
 *                      Auth::login() mints a fresh one for the new device straight after
 *
 * Sanctum personal access tokens are deleted alongside them. None are issued today — the login
 * route returns a placeholder token string — but "revoke everything that could still
 * authenticate as this user" is the guarantee, and it should not quietly stop holding the day
 * someone switches the mobile app to real tokens.
 *
 * Every method is safe to call repeatedly: deletes are by user id and unconditional, session
 * destruction ignores ids that are already gone, and the tracking row is written with
 * updateOrInsert against a unique user_id.
 */
class TechnicianSessionGuard
{
    /**
     * Compared case-insensitively against `roles.role_name`, which is free-text varchar.
     */
    private const ROLE_NAME = 'technician';

    private const TABLE = 'technician_active_sessions';

    /**
     * Whether single-session enforcement applies to this user at all.
     *
     * loadMissing rather than load: the login route loads the same relation a few lines later
     * and there is no reason to pay for the query twice.
     */
    public static function applies(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        try {
            $user->loadMissing('role');
        } catch (\Throwable $e) {
            // A role that cannot be read is not a technician. Failing open here keeps a broken
            // relation from locking every login out.
            Log::warning('Could not resolve role for single-session check', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        if (! $user->role || ! $user->role->role_name) {
            return false;
        }

        return strtolower(trim((string) $user->role->role_name)) === self::ROLE_NAME;
    }

    /**
     * The session id this request is already carrying, or null when it has no session.
     *
     * This is what separates "signed in on another device" from "signing in again on the same
     * one". The SPA and the mobile app both keep their session cookie, so a repeat login from
     * the same device arrives with the id that was recorded last time and must not prompt.
     */
    public static function currentSessionId(Request $request): ?string
    {
        try {
            return $request->hasSession() ? $request->session()->getId() : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Is this technician signed in somewhere that is not the device making this request?
     *
     * exists() against the unique user_id index — this runs on every technician login, so it
     * stays a single indexed existence check and never pulls rows back.
     */
    public static function hasSessionElsewhere(User $user, ?string $currentSessionId): bool
    {
        try {
            $query = DB::table(self::TABLE)->where('user_id', $user->id);

            if ($currentSessionId !== null) {
                // A row with no session id recorded still counts as elsewhere; `!=` alone
                // would drop it, since NULL != 'x' is NULL rather than true.
                $query->where(function ($scoped) use ($currentSessionId) {
                    $scoped->whereNull('session_id')
                        ->orWhere('session_id', '!=', $currentSessionId);
                });
            }

            return $query->exists();
        } catch (\Throwable $e) {
            // The table being unreadable must not block technicians from working. Log loudly
            // and let the login through rather than stranding the field team.
            Log::error('Single-session check failed; allowing login', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * End every existing login for this technician so the current device can take over.
     *
     * The database work is one transaction: the tracking row, the Sanctum tokens and the
     * remember_token either all go or none do, because a half-applied takeover would leave the
     * account either signed in twice or signed in nowhere. Destroying the session payloads is
     * filesystem or cache work and happens after the commit — it cannot be rolled back, so it
     * must not run against a transaction that might still fail.
     *
     * Must be called before Auth::login(): clearing remember_token in memory is what makes
     * Laravel mint a fresh one for the new device instead of reusing the revoked value.
     *
     * @return int  how many previous logins were ended
     */
    public static function takeOver(User $user, Request $request): int
    {
        $previousSessionIds = DB::transaction(function () use ($user) {
            // lockForUpdate so two devices confirming the takeover at the same moment resolve
            // one after the other rather than both reading the same row and both claiming it.
            $sessionIds = DB::table(self::TABLE)
                ->where('user_id', $user->id)
                ->lockForUpdate()
                ->pluck('session_id')
                ->all();

            DB::table(self::TABLE)->where('user_id', $user->id)->delete();

            $user->tokens()->delete();

            // In memory as well as in the database — Auth::login() only issues a new recaller
            // token when the one it can see is empty.
            $user->setRememberToken(null);
            $user->save();

            return $sessionIds;
        });

        self::destroySessions($previousSessionIds, self::currentSessionId($request));

        Log::warning('Technician session taken over by a new device', [
            'user_id' => $user->id,
            'username' => $user->username,
            'sessions_revoked' => count($previousSessionIds),
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'at' => now()->toDateTimeString(),
        ]);

        ActivityLogService::warning(
            'technician_session_takeover',
            "Technician '{$user->username}' signed in on a new device; " . count($previousSessionIds) . ' previous session(s) were ended',
            $user->id,
            $user->id,
            'user',
            $user->id,
            [
                'sessions_revoked' => count($previousSessionIds),
                'ip' => $request->ip(),
            ]
        );

        return count($previousSessionIds);
    }

    /**
     * Record the session this technician is now signed in on.
     *
     * Call after the session id has been regenerated, otherwise the stored id is the pre-login
     * one and the technician's own next login on this device looks like a different device.
     */
    public static function register(User $user, Request $request): void
    {
        $now = now();

        try {
            DB::table(self::TABLE)->updateOrInsert(
                ['user_id' => $user->id],
                [
                    'session_id' => self::currentSessionId($request),
                    'ip_address' => $request->ip(),
                    'user_agent' => self::trimUserAgent($request->userAgent()),
                    'logged_in_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]
            );
        } catch (\Throwable $e) {
            // The user is already authenticated at this point. Losing the bookkeeping row
            // weakens the next single-session check; it is not a reason to fail their login.
            Log::error('Could not record technician session', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Drop the tracking row on logout, so the technician is not asked to confirm a takeover
     * against a login they already ended themselves.
     *
     * Takes a user id and a session id because logout is reachable with a session that has
     * already lapsed, where Auth::id() is null and the session id is all that is left. A
     * no-op for every non-technician: they have no row to delete.
     */
    public static function release(?int $userId, ?string $sessionId): void
    {
        if (! $userId && ! $sessionId) {
            return;
        }

        try {
            $query = DB::table(self::TABLE);

            if ($userId) {
                $query->where('user_id', $userId);
            } else {
                $query->where('session_id', $sessionId);
            }

            $query->delete();
        } catch (\Throwable $e) {
            Log::warning('Could not release technician session record', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Ask the configured session handler to destroy each payload.
     *
     * Going through the handler rather than touching storage/framework/sessions directly keeps
     * this correct if the deployment ever moves off the file driver. Handlers treat an id that
     * is already gone as success, which is what makes a repeated takeover harmless.
     */
    private static function destroySessions(array $sessionIds, ?string $keepSessionId): void
    {
        $sessionIds = array_filter(array_unique($sessionIds), function ($sessionId) use ($keepSessionId) {
            // Never destroy the session this request is running on — that is the device being
            // signed in, and it is about to become the surviving session.
            return ! empty($sessionId) && $sessionId !== $keepSessionId;
        });

        if ($sessionIds === []) {
            return;
        }

        try {
            $handler = app('session')->driver()->getHandler();
        } catch (\Throwable $e) {
            Log::error('Could not resolve the session handler to end previous logins', [
                'error' => $e->getMessage(),
            ]);

            return;
        }

        foreach ($sessionIds as $sessionId) {
            try {
                $handler->destroy($sessionId);
            } catch (\Throwable $e) {
                // One unreachable payload should not stop the rest. The cleared remember_token
                // still stops that device from re-authenticating past its session lifetime.
                Log::warning('Could not destroy a previous session payload', [
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * user_agent is varchar(255) and real ones overflow it.
     */
    private static function trimUserAgent(?string $userAgent): ?string
    {
        if ($userAgent === null || trim($userAgent) === '') {
            return null;
        }

        return substr($userAgent, 0, 255);
    }
}
