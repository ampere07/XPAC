<?php

namespace App\Console\Commands;

use App\Models\BillingAccount;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Seed billing_accounts.prepaid_expires_at from the legacy "Services" CSV exports.
 *
 * Each CSV row carries a "Due Date - Payment Type" value such as "18 - Prepaid": the customer's
 * due day of the month. The expiry becomes the NEXT occurrence of that day counted from today:
 *
 *   today 09/29, due day 18  →  expiry 10/18  (Customer page shows "20 days left", inclusive)
 *   today 09/29, due day 29  →  expiry 09/29  (due today, "1 day left")
 *   today 09/29, due day 30  →  expiry 09/30
 *
 * A due day past the end of the target month (31 in a 30-day month) is clamped to that
 * month's last day. Expiries are written at 00:00:00, like most live rows, and are always
 * today or later, so this can never make an account due for restriction straight away.
 *
 * Only rows marked Prepaid in the CSV AND whose billing account is Prepaid in the database are
 * touched. This deliberately bypasses the Prepaid Override workflow: it is a one-off data
 * migration, so run it with --dry-run first and check the preview.
 */
class ImportPrepaidDueDates extends Command
{
    protected $signature = 'prepaid:import-due-dates
                            {--path= : Folder holding the Services*.csv exports (default: <repo>/XPAC/database)}
                            {--dry-run : Show what would change without writing}';

    protected $description = 'Set prepaid_expires_at from the due day in the legacy Services CSV exports';

    public function handle(): int
    {
        $dir = $this->option('path') ?: base_path('../database');
        $files = glob(rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . '*.csv') ?: [];

        if (empty($files)) {
            $this->error("No CSV files found in {$dir}");
            return Command::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $today = Carbon::today();

        // account_no => due day, prepaid rows only.
        $dueDays = [];
        $postpaidRows = 0;
        $badRows = 0;

        foreach ($files as $file) {
            $handle = fopen($file, 'r');
            $header = fgetcsv($handle);
            $accountCol = array_search('Account No', $header, true);
            $dueCol = array_search('Due Date - Payment Type', $header, true);

            if ($accountCol === false || $dueCol === false) {
                $this->warn('Skipping ' . basename($file) . ': missing "Account No" or "Due Date - Payment Type" column');
                fclose($handle);
                continue;
            }

            while (($row = fgetcsv($handle)) !== false) {
                $accountNo = trim((string) ($row[$accountCol] ?? ''));
                $dueValue = trim((string) ($row[$dueCol] ?? ''));

                if ($accountNo === '' || !preg_match('/^(\d{1,2})\s*-\s*(.+)$/', $dueValue, $m)) {
                    $badRows++;
                    continue;
                }

                if (!BillingAccount::isPrepaidType($m[2])) {
                    $postpaidRows++;
                    continue;
                }

                $day = (int) $m[1];
                if ($day < 1 || $day > 31) {
                    $badRows++;
                    continue;
                }

                $dueDays[$accountNo] = $day;
            }

            fclose($handle);
        }

        $this->info(count($files) . ' file(s): ' . count($dueDays) . " prepaid row(s), {$postpaidRows} postpaid skipped, {$badRows} unreadable");

        $accounts = BillingAccount::whereIn('account_no', array_keys($dueDays))
            ->get(['id', 'account_no', 'generation_type', 'prepaid_expires_at'])
            ->keyBy('account_no');

        $updated = 0;
        $unchanged = 0;
        $notPrepaidInDb = [];
        $preview = [];

        foreach ($dueDays as $accountNo => $day) {
            $account = $accounts->get((string) $accountNo);
            if (!$account) {
                continue;
            }

            if (!BillingAccount::isPrepaidType($account->generation_type)) {
                $notPrepaidInDb[] = $accountNo;
                continue;
            }

            $expiry = self::nextDueDate($today, $day);
            $old = $account->prepaid_expires_at ? Carbon::parse($account->prepaid_expires_at) : null;

            if ($old && $old->equalTo($expiry)) {
                $unchanged++;
                continue;
            }

            if (count($preview) < 20) {
                $preview[] = [
                    $accountNo,
                    $day,
                    $old ? $old->toDateTimeString() : '-',
                    $expiry->toDateString(),
                    $today->diffInDays($expiry) + 1,
                ];
            }

            if (!$dryRun) {
                DB::table('billing_accounts')->where('id', $account->id)->update([
                    'prepaid_expires_at' => $expiry->toDateTimeString(),
                    'updated_at' => now(),
                ]);
            }

            $updated++;
        }

        $notFound = count($dueDays) - $accounts->count();

        if ($preview) {
            $this->table(['Account No', 'Due Day', 'Old Expiry', 'New Expiry', 'Days Left'], $preview);
        }

        $this->table(['Metric', 'Count'], [
            [$dryRun ? 'Would update' : 'Updated', $updated],
            ['Already correct', $unchanged],
            ['Not prepaid in DB (skipped)', count($notPrepaidInDb)],
            ['Not found in DB', $notFound],
        ]);

        if ($notPrepaidInDb) {
            $this->line('Not prepaid in DB: ' . implode(', ', array_slice($notPrepaidInDb, 0, 50))
                . (count($notPrepaidInDb) > 50 ? ' ...' : ''));
        }

        if ($dryRun) {
            $this->warn('Dry run: nothing was written.');
        } else {
            Log::info('prepaid:import-due-dates applied', [
                'updated' => $updated,
                'unchanged' => $unchanged,
                'not_prepaid_in_db' => count($notPrepaidInDb),
                'not_found' => $notFound,
            ]);
        }

        return Command::SUCCESS;
    }

    /** Next occurrence of $day on or after $today, clamped to the month's last day. */
    public static function nextDueDate(Carbon $today, int $day): Carbon
    {
        $candidate = $today->copy()->startOfMonth();
        $candidate->day(min($day, $candidate->daysInMonth));

        if ($candidate->lessThan($today)) {
            $candidate = $today->copy()->startOfMonth()->addMonthNoOverflow();
            $candidate->day(min($day, $candidate->daysInMonth));
        }

        return $candidate->startOfDay();
    }
}
