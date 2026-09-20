<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Support\Permissions;
use Tests\TestCase;

/**
 * The two clients carry a copy of the permission table so they can decide what
 * to draw without a round trip. A copy that drifts from the server's is worse
 * than no copy: the menu offers a page the API then refuses, or hides one the
 * user is entitled to.
 *
 * This reads the TypeScript files as text and compares them to the PHP table.
 * Text rather than a build step because the alternative — a generator, or a
 * shared JSON both languages read — is a larger change than the problem
 * warrants, and because a mismatch here is a one-line fix in whichever file is
 * behind.
 */
class PermissionsParityTest extends TestCase
{
    private const CLIENT_CATALOGS = [
        'web'    => '/../frontend/src/config/permissions.ts',
        'mobile' => '/../../MOBILEAPP/frontend/src/config/permissions.ts',
    ];

    /** @return array<string, string> client name => file contents */
    private function catalogs(): array
    {
        $found = [];

        foreach (self::CLIENT_CATALOGS as $client => $relative) {
            $path = base_path() . $relative;

            if (is_file($path)) {
                // Comments are stripped first: the scan below reads quoted
                // strings, and prose contains apostrophes.
                $found[$client] = preg_replace('#^\s*//.*$#m', '', file_get_contents($path));
            }
        }

        $this->assertNotEmpty($found, 'No client permission catalog found to compare against.');

        return $found;
    }

    /**
     * Pull a quoted string list out of a TS array literal.
     *
     * @return string[]
     */
    private function stringsIn(string $source, string $marker, string $close): array
    {
        $start = strpos($source, $marker);
        $this->assertNotFalse($start, "Could not find `$marker` in the client catalog.");

        $end = strpos($source, $close, $start);
        $this->assertNotFalse($end, "Could not find the end of `$marker` in the client catalog.");

        preg_match_all("/'([^']+)'/", substr($source, $start, $end - $start), $matches);

        return $matches[1];
    }

    /** Every page key exists on both sides, in both directions. */
    public function test_page_keys_match(): void
    {
        foreach ($this->catalogs() as $client => $source) {
            $clientPages = $this->stringsIn($source, 'export const PAGES = [', '] as const;');

            $missingFromClient = array_values(array_diff(Permissions::PAGES, $clientPages));
            $missingFromServer = array_values(array_diff($clientPages, Permissions::PAGES));

            $this->assertSame([], $missingFromClient, "Pages the $client client is missing.");
            $this->assertSame([], $missingFromServer, "Pages the $client client has that the server does not.");
        }
    }

    /** Every sub action exists on both sides. */
    public function test_action_keys_match(): void
    {
        $serverActions = array_merge(...array_values(Permissions::ACTIONS));

        foreach ($this->catalogs() as $client => $source) {
            $clientActions = $this->stringsIn($source, 'export const ACTIONS: Record<string, string[]> = {', '};');
            // The map's keys are page names; only the dotted entries are actions.
            $clientActions = array_values(array_filter($clientActions, fn ($key) => str_contains($key, '.')));

            $this->assertSame(
                [],
                array_values(array_diff($serverActions, $clientActions)),
                "Sub actions the $client client is missing."
            );
            $this->assertSame(
                [],
                array_values(array_diff($clientActions, $serverActions)),
                "Sub actions the $client client has that the server does not."
            );
        }
    }

    /**
     * Each seeded role holds the same keys on both sides.
     *
     * A drift here is the one that shows: the menu and the API disagree about
     * what a technician may open.
     */
    public function test_role_permissions_match(): void
    {
        foreach ($this->catalogs() as $client => $source) {
            foreach (Permissions::ROLE_PERMISSIONS as $roleId => $serverKeys) {
                $marker = "[ROLE.{$this->roleConstantName($roleId)}]: [";
                $clientKeys = $this->stringsIn($source, $marker, '],');

                // SuperAdmin's entry is written `[WILDCARD]` — an identifier
                // rather than a quoted string, so it does not come back from
                // the string scan.
                if ($serverKeys === [Permissions::WILDCARD] && $clientKeys === []) {
                    $this->assertStringContainsString(
                        $marker . 'WILDCARD]',
                        $source,
                        "The $client client does not grant SuperAdmin the wildcard."
                    );
                    continue;
                }

                sort($serverKeys);
                sort($clientKeys);

                $this->assertSame(
                    $serverKeys,
                    $clientKeys,
                    "Role $roleId differs between the server and the $client client."
                );
            }
        }
    }

    /** Every role lands on a page it actually holds. */
    public function test_each_role_lands_somewhere_it_may_go(): void
    {
        foreach (Permissions::ROLE_HOME as $roleId => $home) {
            $user = new class($roleId) {
                public $id = 1;
                public $role_id;
                public $role = null;

                public function __construct($roleId)
                {
                    $this->role_id = $roleId;
                }
            };

            $this->assertTrue(
                Permissions::allows($user, $home),
                "Role $roleId lands on '$home', which it does not hold."
            );
        }
    }

    /** Every key a seeded role holds is a key the system knows about. */
    public function test_role_permissions_are_all_known_keys(): void
    {
        $known = Permissions::all();

        foreach (Permissions::ROLE_PERMISSIONS as $roleId => $keys) {
            foreach ($keys as $key) {
                if ($key === Permissions::WILDCARD) {
                    continue;
                }

                $this->assertContains($key, $known, "Role $roleId holds unknown key '$key'.");
            }
        }
    }

    private function roleConstantName(int $roleId): string
    {
        return [
            Role::ADMINISTRATOR   => 'ADMINISTRATOR',
            Role::TECHNICIAN      => 'TECHNICIAN',
            Role::CUSTOMER        => 'CUSTOMER',
            Role::AGENT           => 'AGENT',
            Role::INVENTORY_STAFF => 'INVENTORY_STAFF',
            Role::OSP             => 'OSP',
            Role::SUPER_ADMIN     => 'SUPER_ADMIN',
            Role::HEAD_TECH       => 'HEAD_TECH',
        ][$roleId];
    }
}
