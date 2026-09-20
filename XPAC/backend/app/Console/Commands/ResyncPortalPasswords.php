<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use App\Support\PortalPassword;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Re-point every customer portal login at the contact number it is supposed to be.
 *
 * The portal password convention is the customer's primary contact number, but
 * for a long time nothing kept the two in step: the number could be edited
 * through a path that did not touch the users row, and the hash was written in
 * whatever spelling happened to be stored ("+63 917…", "0917…", "917…") so only
 * that one spelling ever worked. Both failures look identical to the customer —
 * "Invalid credentials" against a number that is visibly correct in the admin UI
 * — and the only repair available was editing the contact number to something
 * different (the "add a 0, save, take it off again" ritual) to force a rehash.
 *
 * The login route now repairs an account the first time its owner signs in
 * through a legacy spelling, and every write path keeps the hash current. This
 * command exists for the accounts that cannot wait for that: it fixes them all
 * in one pass, so nobody has to sign in through a broken login to have it fixed.
 *
 *     php artisan customers:resync-portal-passwords              # report only
 *     php artisan customers:resync-portal-passwords --apply
 *     php artisan customers:resync-portal-passwords --apply --account=A0001
 *
 * Reports by default and writes nothing until --apply is passed, because it does
 * overwrite passwords: an account whose password was deliberately set to
 * something other than the contact number is reset to the convention.
 */
class ResyncPortalPasswords extends Command
{
    protected $signature = 'customers:resync-portal-passwords
                            {--apply : Write the changes. Without this the command only reports.}
                            {--account= : Limit to one billing account number.}';

    protected $description = 'Rehash customer portal passwords from their primary contact number';

    /** How many rows to print before sending the rest to a CSV. */
    private const PREVIEW_ROWS = 25;

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $only = $this->option('account');

        // Narrow to customer roles up front rather than walking every staff row
        // and discarding it. A hybrid custom role that inherits from Customer is
        // still a customer, so it is included alongside the seeded role.
        $customerRoleIds = [Role::CUSTOMER];

        if (Schema::hasColumn('roles', 'base_role_id')) {
            $customerRoleIds = array_merge(
                $customerRoleIds,
                DB::table('roles')->where('base_role_id', Role::CUSTOMER)->pluck('id')->all()
            );
        }

        $query = User::query()
            ->whereNotNull('username')
            ->whereIn('role_id', array_unique($customerRoleIds));

        if ($only) {
            $query->where('username', $only);
        }

        $checked = 0;
        $drifted = 0;
        $fixed = 0;
        $noNumber = 0;
        $failed = 0;
        $rows = [];

        // Every check below is a bcrypt verification, which is deliberately slow
        // — tens of milliseconds each, by design. Across a full customer base
        // that is minutes of work, so say so and show it moving rather than
        // leaving an operator staring at a cursor wondering if it hung.
        $total = (clone $query)->count();
        $this->line("Customer logins to check: {$total}");
        $this->line($apply ? 'Writing changes (--apply).' : 'Reporting only. Nothing will be written.');
        $this->newLine();

        // Findings are written as they are discovered, not collected and dumped
        // at the end. A full scan is tens of minutes of bcrypt, and a run that is
        // interrupted at 80% should still leave behind the 80% it established.
        $path = storage_path('app/portal-password-resync-' . now()->format('Ymd-His') . '.csv');
        $csv = fopen($path, 'w');
        fputcsv($csv, ['account_no', 'contact_number', 'action']);
        $this->line("Findings are written to: {$path}");
        $this->newLine();

        $bar = $this->output->createProgressBar($total);
        $bar->setFormat(" %current%/%max% [%bar%] %percent:3s%%  %message%");
        $bar->setMessage('starting');
        $bar->start();

        $query->orderBy('id')->chunkById(200, function ($users) use (
            $apply, $bar, $csv, &$checked, &$drifted, &$fixed, &$noNumber, &$failed, &$rows
        ) {
            // One lookup per chunk, not one per account. Over a remote database
            // the per-account version was 10,000 round trips.
            $numbers = DB::table('billing_accounts')
                ->join('customers', 'customers.id', '=', 'billing_accounts.customer_id')
                ->whereIn('billing_accounts.account_no', $users->pluck('username')->all())
                ->pluck('customers.contact_number_primary', 'billing_accounts.account_no');

            foreach ($users as $user) {
                if (!PortalPassword::isCustomer($user)) {
                    continue;
                }

                $checked++;
                $bar->setMessage("out of step: {$drifted}   no number: {$noNumber}");
                $bar->advance();

                // username is the billing account number; that account names the
                // customer whose number is the password.
                $number = trim((string) ($numbers[$user->username] ?? $user->contact_number ?? ''));

                if ($number === '') {
                    $noNumber++;
                    $rows[] = $row = [$user->username, '-', 'no contact number on record'];
                    fputcsv($csv, $row);
                    continue;
                }

                if (PortalPassword::hashIsCurrent($number, $user->password_hash)) {
                    continue;
                }

                $drifted++;
                $rows[] = $row = [$user->username, $number, $apply ? 'rehashed' : 'would rehash'];
                fputcsv($csv, $row);

                if (!$apply) {
                    continue;
                }

                try {
                    $user->contact_number = $number;
                    // The model mutator hashes this.
                    $user->password_hash = PortalPassword::normalize($number);
                    $user->save();
                    $fixed++;
                } catch (Throwable $e) {
                    $failed++;
                    $this->error("  {$user->username}: {$e->getMessage()}");
                }
            }
        });

        $bar->finish();
        fclose($csv);
        $this->newLine(2);

        // A full customer base can put thousands of rows here, which scrolls the
        // summary off the screen and is unreadable anyway. Show a sample and put
        // the complete list in a file worth opening.
        $preview = self::PREVIEW_ROWS;

        if ($rows) {
            $this->table(['Account', 'Contact number', 'Action'], array_slice($rows, 0, $preview));

            if (count($rows) > $preview) {
                $this->comment('… ' . (count($rows) - $preview) . ' more not shown.');
            }

            $this->newLine();
            $this->line("Full list: {$path}");
        }

        $this->newLine();
        $this->line("customer logins checked : {$checked}");
        $this->line("out of step             : {$drifted}");
        $this->line("no contact number       : {$noNumber}");
        $this->line('already correct         : ' . ($checked - $drifted - $noNumber));

        if ($apply) {
            $this->line("rehashed                : {$fixed}");
            if ($failed) {
                $this->line("failed                  : {$failed}");
            }
        } elseif ($drifted) {
            $this->newLine();
            $this->comment("Nothing written. Re-run with --apply to rehash those {$drifted}.");
        } elseif ($checked === 0) {
            $this->newLine();
            $this->warn('No customer logins found at all. Check the database this is pointed at.');
        } else {
            $this->newLine();
            $this->info('Every customer login already matches its contact number. Nothing to do.');
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
