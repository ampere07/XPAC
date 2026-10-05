<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Export every unique account number found in transactions and payment_portal_logs to a CSV.
 *
 *   php artisan export:account-numbers
 *   php artisan export:account-numbers --path=/tmp/accounts.csv
 *
 * payment_portal_logs stores account_id, so its account numbers come through billing_accounts.
 * Read-only: nothing is written to the database.
 */
class ExportAccountNumbers extends Command
{
    protected $signature = 'export:account-numbers {--path= : Where to write the CSV (default: storage/app/exports/account_numbers_<timestamp>.csv)}';

    protected $description = 'Export unique account numbers from transactions and payment_portal_logs to CSV';

    public function handle(): int
    {
        $rows = DB::select("
            SELECT account_no,
                   GROUP_CONCAT(DISTINCT source ORDER BY source SEPARATOR ' + ') AS found_in
            FROM (
                SELECT TRIM(t.account_no) AS account_no, 'transactions' AS source
                FROM transactions t
                WHERE t.account_no IS NOT NULL AND TRIM(t.account_no) <> ''

                UNION ALL

                SELECT TRIM(ba.account_no), 'payment_portal_logs'
                FROM payment_portal_logs p
                JOIN billing_accounts ba ON ba.id = p.account_id
                WHERE ba.account_no IS NOT NULL AND TRIM(ba.account_no) <> ''
            ) x
            GROUP BY account_no
            ORDER BY account_no
        ");

        $path = $this->option('path')
            ?: storage_path('app/exports/account_numbers_' . date('Ymd_His') . '.csv');

        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0775, true);
        }

        $handle = fopen($path, 'w');
        if ($handle === false) {
            $this->error("Cannot write {$path}");
            return self::FAILURE;
        }

        fputcsv($handle, ['account_no', 'found_in']);
        foreach ($rows as $row) {
            fputcsv($handle, [$row->account_no, $row->found_in]);
        }
        fclose($handle);

        $this->info(count($rows) . " unique account numbers written to {$path}");

        return self::SUCCESS;
    }
}
