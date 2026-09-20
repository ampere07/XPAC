<?php

namespace Tests\Unit;

use App\Support\PortalPassword;
use Illuminate\Hashing\BcryptHasher;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The customer portal's "your password is your mobile number" convention.
 *
 * A phone number has no single spelling, and every write path used to hash
 * whichever one happened to be sitting in customers.contact_number_primary. The
 * customer then typed the number the way they know it and was told "Invalid
 * credentials" against a number that looks correct in the admin UI. The only
 * repair was editing the contact number to something different to force a
 * rehash — hence operators adding a leading '0', saving, and taking it off.
 *
 * What these lock down:
 *
 *   - every spelling of one number collapses to one canonical form, so a new
 *     account is reachable however its owner types the number;
 *   - a legacy hash, made from a raw spelling, still opens — and reports that it
 *     did NOT match canonically, which is what tells the login route to rehash;
 *   - a different number never opens, by any route;
 *   - a staff password is not treated as a phone number.
 */
class PortalPasswordTest extends TestCase
{
    /** Bcrypt directly: the driver must not vary with the app's hash config. */
    protected function setUp(): void
    {
        parent::setUp();
        Hash::swap(new BcryptHasher(['rounds' => 4]));
    }

    public function test_every_spelling_of_a_number_normalises_to_one_form(): void
    {
        $expected = '9171234567';

        foreach ([
            '09171234567',
            '9171234567',
            '+639171234567',
            '+63 917 123 4567',
            '0917-123-4567',
            '  09171234567  ',
            '00639171234567',
            '63 917 123 4567',
        ] as $spelling) {
            $this->assertSame($expected, PortalPassword::normalize($spelling), "normalising {$spelling}");
        }
    }

    public function test_digits_that_only_look_like_ascii_are_folded_not_dropped(): void
    {
        // Renders as "09171234567" in the admin UI and is not that byte string.
        // Stripping these as punctuation would shorten the number to "1234567"
        // and the account would never open.
        $this->assertSame('9171234567', PortalPassword::normalize("\u{FF10}\u{FF19}\u{FF11}\u{FF17}1234567"));
        $this->assertSame('9171234567', PortalPassword::normalize("\u{0660}\u{0669}\u{0661}\u{0667}1234567"));

        // Invisible characters are not digits; the non-digit strip removes them.
        foreach (["0917\u{200B}1234567", "0917\u{00A0}123\u{00A0}4567", "\u{200F}09171234567", "0917\u{2013}123\u{2013}4567"] as $raw) {
            $this->assertSame('9171234567', PortalPassword::normalize($raw), 'normalising ' . bin2hex($raw));
        }

        // And a customer typing the plain number still opens a legacy hash made
        // from the dirty spelling, via the number of record.
        $dirty = "0917\u{200B}1234567";
        $this->assertTrue(
            PortalPassword::matchesWithStoredNumber('09171234567', Hash::make($dirty), $dirty)
        );
    }

    public function test_a_staff_password_is_left_alone(): void
    {
        $this->assertSame('admin123', PortalPassword::normalize('admin123'));
        $this->assertSame('S3cret!', PortalPassword::normalize('  S3cret!  '));
    }

    public function test_a_canonically_hashed_number_opens_under_any_spelling(): void
    {
        $hash = PortalPassword::hash('0917-123-4567');

        foreach (['09171234567', '9171234567', '+639171234567', '0917 123 4567', ' 09171234567'] as $typed) {
            $canonical = null;
            $this->assertTrue(PortalPassword::matches($typed, $hash, $canonical), "typing {$typed}");
            $this->assertTrue($canonical, "typing {$typed} should take the canonical path");
        }
    }

    public function test_a_legacy_hash_opens_and_asks_to_be_rehashed(): void
    {
        // What the old write paths stored: the raw column value, hashed as-is.
        // "09171234567" is a legacy spelling — the canonical form drops the
        // trunk '0', so this hash is only reachable through the slow path.
        $hash = Hash::make('09171234567');

        foreach (['09171234567', '9171234567', '+639171234567'] as $typed) {
            $canonical = true;
            $this->assertTrue(PortalPassword::matches($typed, $hash, $canonical), "typed {$typed}");
            $this->assertFalse($canonical, 'a legacy match must ask the caller to rehash');
        }

        // A number whose raw spelling already happens to be canonical needs no
        // repair, and must not ask for one.
        $canonical = false;
        $this->assertTrue(PortalPassword::matches('09171234567', Hash::make('9171234567'), $canonical));
        $this->assertTrue($canonical);
    }

    public function test_a_punctuated_legacy_hash_opens_via_the_number_of_record(): void
    {
        // "0917-123-4567" cannot be reconstructed from what the customer types,
        // so the account's own stored number supplies the spelling.
        $hash = Hash::make('0917-123-4567');

        $canonical = true;
        $this->assertFalse(PortalPassword::matches('09171234567', $hash));
        $this->assertTrue(
            PortalPassword::matchesWithStoredNumber('09171234567', $hash, '0917-123-4567', $canonical)
        );
        $this->assertFalse($canonical);
    }

    public function test_a_different_number_never_opens(): void
    {
        $hash = PortalPassword::hash('09171234567');

        $this->assertFalse(PortalPassword::matches('09171234568', $hash));
        $this->assertFalse(PortalPassword::matches('09998887777', $hash));

        // Not even with the stored number vouching for it: the typed password
        // has to be the same number once both are normalised.
        $this->assertFalse(
            PortalPassword::matchesWithStoredNumber('09998887777', Hash::make('0917-123-4567'), '0917-123-4567')
        );
    }

    public function test_an_empty_password_never_opens(): void
    {
        $hash = PortalPassword::hash('09171234567');

        $this->assertFalse(PortalPassword::matches('', $hash));
        $this->assertFalse(PortalPassword::matches(null, $hash));
        $this->assertFalse(PortalPassword::matches('09171234567', ''));
    }

    public function test_hash_is_current_reports_drift(): void
    {
        $hash = PortalPassword::hash('09171234567');

        $this->assertTrue(PortalPassword::hashIsCurrent('09171234567', $hash));
        $this->assertTrue(PortalPassword::hashIsCurrent('+63 917 123 4567', $hash));
        $this->assertFalse(PortalPassword::hashIsCurrent('09998887777', $hash));
        $this->assertFalse(PortalPassword::hashIsCurrent('', $hash));
    }
}
