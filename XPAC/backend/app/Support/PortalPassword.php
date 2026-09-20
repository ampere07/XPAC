<?php

namespace App\Support;

use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * The customer portal's password convention: the primary contact number.
 *
 * A customer signs in with their account number and their mobile number. That
 * makes the password a phone number typed by a human, and a phone number has no
 * single spelling — the same subscriber is "09171234567" on an application form,
 * "9171234567" in an import, "+63 917 123 4567" when pasted from a contact card.
 * Every one of those was hashed verbatim by whichever path wrote the account, so
 * the stored hash matched only the exact spelling that happened to be in the
 * customers row at the time. Type the number any other way — including the way
 * the admin UI displays it — and the login answered "Invalid credentials".
 *
 * The old workaround for that was a leading-'0' retry in the login route, which
 * covered one spelling out of several and only for role_id 3. Worse, it did not
 * touch the real problem: nothing kept the hash in step with the number after
 * the account was created, so an account could be desynced with no way back
 * except editing the contact number to force a rehash. That is exactly the
 * "add a 0, save, remove it again" ritual operators had fallen into.
 *
 * This class makes one spelling canonical and hashes only that:
 *
 *     normalize('+63 917 123 4567') === '9171234567'
 *     normalize('09171234567')      === '9171234567'
 *     normalize('9171234567')       === '9171234567'
 *
 * so a number written any of those ways produces the same hash, and a customer
 * typing it any of those ways signs in.
 *
 * `matches()` additionally accepts the legacy spellings, because accounts hashed
 * before this class existed still hold whatever was typed then. A login that
 * succeeds only through one of those legacy forms is rehashed to the canonical
 * one (see the /login route), so each old account repairs itself the first time
 * its owner signs in and the legacy path stops being reached.
 */
class PortalPassword
{
    /**
     * Does the contact-number convention apply to this account?
     *
     * Seeded role 3, or a custom role that inherits from it — a hybrid customer
     * role is still a customer, and its holders were locked out by a check that
     * only ever compared role_id against the literal 3.
     */
    public static function isCustomer($user): bool
    {
        if (!$user) {
            return false;
        }

        if ((int) ($user->role_id ?? 0) === Role::CUSTOMER) {
            return true;
        }

        $role = $user->role ?? null;

        return $role instanceof Role && $role->baseRoleId() === Role::CUSTOMER;
    }
    /**
     * The canonical form of a phone number used as a portal password.
     *
     * Digits only, without the Philippine country code and without the national
     * trunk '0' — the shortest form that still identifies the subscriber, so
     * that every longer spelling collapses onto it.
     *
     * A value that is not a phone number at all (a staff password, an empty
     * string) is returned trimmed and otherwise untouched: this is only ever
     * applied to the customer convention, and it must not mangle anything else.
     */
    public static function normalize(?string $raw): string
    {
        $raw = trim((string) $raw);

        if ($raw === '') {
            return '';
        }

        $digits = preg_replace('/\D/', '', self::foldDigits($raw));

        // Not a phone number — leave it alone rather than turn it into one.
        if ($digits === '' || strlen($digits) < 7) {
            return $raw;
        }

        // +63 / 0063 / 63 country code, then the national trunk '0'.
        if (str_starts_with($digits, '0063')) {
            $digits = substr($digits, 4);
        } elseif (strlen($digits) >= 11 && str_starts_with($digits, '63')) {
            $digits = substr($digits, 2);
        }

        $digits = ltrim($digits, '0');

        return $digits === '' ? $raw : $digits;
    }

    /**
     * Where the digit 0 sits in each non-ASCII decimal-digit block.
     *
     * A number typed on a phone keyboard, pasted out of Messenger, or carried
     * through a spreadsheet can arrive written in digits that render exactly
     * like ASCII ones and are not — fullwidth "０９１７…" most often. Stripping
     * them as punctuation would silently shorten the number; folding them to
     * ASCII keeps it intact, so the same subscriber's number still collapses
     * onto one canonical form. Mirrors the blocks APPLY's TextNormalizer folds.
     */
    private const DIGIT_ZEROS = [
        0xFF10,  // Fullwidth
        0x0660, 0x06F0,  // Arabic-Indic, Extended Arabic-Indic
        0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6,  // Indic
        0x0C66, 0x0CE6, 0x0D66,
        0x0E50, 0x0ED0, 0x0F20, 0x1040, 0x17E0, 0x1810,  // Thai … Mongolian
        0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6,  // Mathematical
    ];

    /**
     * Rewrite non-ASCII decimal digits as ASCII, leaving everything else alone.
     *
     * Invisible characters — a zero-width space, a non-breaking space, an RTL
     * mark — need no handling here: they are not digits, so the caller's
     * non-digit strip removes them. This exists only for characters that ARE
     * digits and would otherwise be thrown away with the punctuation.
     */
    private static function foldDigits(string $value): string
    {
        // Overwhelmingly the common case, and the only one worth being fast.
        if (preg_match('/[^\x00-\x7F]/', $value) !== 1) {
            return $value;
        }

        // Broken UTF-8 makes a /u pattern return null and lose the value.
        if (preg_match('//u', $value) !== 1) {
            $repaired = @mb_convert_encoding($value, 'UTF-8', 'UTF-8');
            $value = is_string($repaired) ? $repaired : '';
        }

        $folded = preg_replace_callback('/[^\x00-\x7F]/u', function (array $m) {
            $cp = mb_ord($m[0], 'UTF-8');

            if ($cp === false) {
                return $m[0];
            }

            foreach (self::DIGIT_ZEROS as $zero) {
                if ($cp >= $zero && $cp <= $zero + 9) {
                    return (string) ($cp - $zero);
                }
            }

            return $m[0];
        }, $value);

        return is_string($folded) ? $folded : $value;
    }

    /**
     * Hash a contact number for storage.
     *
     * Always the canonical form, so two paths writing the same subscriber's
     * number in different spellings produce the same hash.
     */
    public static function hash(?string $raw): string
    {
        return Hash::make(self::normalize($raw));
    }

    /**
     * Every spelling of `$raw` that some earlier code path may have hashed.
     *
     * Ordered cheapest-first and de-duplicated. The canonical form is checked by
     * `matches()` before any of these, so this list is only walked for accounts
     * that predate `hash()`.
     */
    public static function legacySpellings(?string $raw): array
    {
        $raw = (string) $raw;
        $trimmed = trim($raw);
        $digits = preg_replace('/\D/', '', $trimmed);
        $local = self::normalize($trimmed);

        $candidates = [
            $raw,
            $trimmed,
            $digits,
            '0' . $local,
            '63' . $local,
            '+63' . $local,
            '+63' . '0' . $local,
        ];

        return array_values(array_filter(array_unique($candidates), fn ($c) => $c !== '' && $c !== null));
    }

    /**
     * Does `$input` unlock `$hash` under the contact-number convention?
     *
     * True for the canonical form and for any legacy spelling of the same
     * number. `$matchedCanonically` comes back false when only a legacy
     * spelling worked, which is the caller's cue to rehash.
     */
    public static function matches(?string $input, ?string $hash, ?bool &$matchedCanonically = null): bool
    {
        $matchedCanonically = false;

        if ($input === null || $input === '' || $hash === null || $hash === '') {
            return false;
        }

        if (Hash::check(self::normalize($input), $hash)) {
            $matchedCanonically = true;
            return true;
        }

        foreach (self::legacySpellings($input) as $candidate) {
            if (Hash::check($candidate, $hash)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Same as `matches()`, but also accepting a legacy hash of the account's own
     * stored contact number in a spelling `$input` cannot be rewritten into.
     *
     * `matches()` works from the typed password alone, so it can only try the
     * spellings it is able to construct — "0917…", "+63917…", digits. It cannot
     * guess that the hash was made from "0917-123-4567" or "0917 123 4567",
     * because punctuation has too many layouts to enumerate.
     *
     * The account's stored number supplies the missing spelling. Accepting on it
     * concedes nothing: the hash is still what proves the secret — `$storedNumber`
     * verbatim must verify against it — and `$input` must be that same phone
     * number once both are normalised. A caller that passes an unrelated number
     * as `$storedNumber` learns nothing it could not learn from `Hash::check`.
     *
     * Only reached for accounts hashed before `hash()` existed, and a success
     * here tells the caller to rehash — after which the account takes the fast
     * path forever.
     */
    public static function matchesWithStoredNumber(
        ?string $input,
        ?string $hash,
        ?string $storedNumber,
        ?bool &$matchedCanonically = null
    ): bool {
        if (self::matches($input, $hash, $matchedCanonically)) {
            return true;
        }

        $matchedCanonically = false;

        if ($input === null || $input === '' || $hash === null || $hash === '') {
            return false;
        }

        $storedNumber = trim((string) $storedNumber);

        if ($storedNumber === '') {
            return false;
        }

        // The typed password has to be the same number, not merely something the
        // stored spelling happens to hash to.
        if (self::normalize($input) !== self::normalize($storedNumber)) {
            return false;
        }

        foreach (self::legacySpellings($storedNumber) as $candidate) {
            if (Hash::check($candidate, $hash)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Re-point a customer's portal logins at their current primary number.
     *
     * Any path that writes contact_number_primary owes the users row this call.
     * Skipping it is what put 2,000 accounts out of step: the hash kept verifying
     * the number from the original application while the admin UI showed the
     * edited one, so the number on screen — the one support reads out, the one
     * the customer is told to use — was the one number that did not work.
     *
     * Lives here rather than in a controller because more than one endpoint edits
     * a customer, and each copy of this rule was a chance to forget it.
     *
     * The users row is found the way the rest of the system finds it: username is
     * the billing account number. A customer with no billing account has no
     * portal login yet, and nothing to sync.
     *
     * Best-effort: a failure must not fail the customer edit that succeeded.
     * Returns how many logins were repointed.
     */
    public static function sync($customer): int
    {
        $synced = 0;

        try {
            $number = trim((string) ($customer->contact_number_primary ?? ''));

            if ($number === '') {
                return 0;
            }

            $accountNos = DB::table('billing_accounts')
                ->where('customer_id', $customer->id)
                ->pluck('account_no');

            foreach ($accountNos as $accountNo) {
                $user = User::where('username', $accountNo)->first();

                if (!$user || !self::isCustomer($user)) {
                    continue;
                }

                if (self::hashIsCurrent($number, $user->password_hash)
                    && trim((string) $user->contact_number) === $number) {
                    continue;
                }

                $user->contact_number = $number;
                // The model mutator hashes this. Canonical spelling, so the
                // number verifies however the customer types it.
                $user->password_hash = self::normalize($number);
                $user->save();
                $synced++;

                Log::info('Portal credential resynced from customer update', [
                    'customer_id' => $customer->id,
                    'username' => $accountNo,
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('Failed to resync portal credential: ' . $e->getMessage(), [
                'customer_id' => $customer->id ?? null,
            ]);
        }

        return $synced;
    }

    /**
     * Is `$hash` already the hash of `$number` under this convention?
     *
     * Used by the sync paths to decide whether an account's password has drifted
     * from the contact number it is supposed to be, without needing to know how
     * it drifted.
     */
    public static function hashIsCurrent(?string $number, ?string $hash): bool
    {
        if ($number === null || trim($number) === '' || $hash === null || $hash === '') {
            return false;
        }

        return Hash::check(self::normalize($number), $hash);
    }
}
