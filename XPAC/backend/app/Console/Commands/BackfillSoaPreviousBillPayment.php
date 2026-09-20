<?php

namespace App\Console\Commands;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Restore the previous-bill columns on statements that lost them.
 *
 * Repairs exactly one shape of row: a statement whose
 *     payment_received_previous   (Payment Received From Previous Bill)
 *     remaining_balance_previous  (Remaining Balance From Previous Bill)
 * are BOTH blank or zero, while the bill it reports on -- the last invoice dated
 * before the statement -- carries invoices.received_payment > 0. The customer
 * paid, the invoice recorded it, and the statement showed 0.00.
 *
 * The previous invoice is the source of truth, not the transactions table:
 * payments in this database reach invoices.received_payment without always
 * leaving a transactions row, so transactions cannot see the money.
 *
 * Each repaired statement is rewritten from that invoice:
 *     balance_from_previous_bill = invoice.total_amount        (what was billed)
 *     payment_received_previous  = invoice.received_payment    (what was paid)
 *     remaining_balance_previous = total_amount - received_payment
 *
 * so the three columns reconcile as
 *     balance_from_previous_bill - payment_received_previous
 *         = remaining_balance_previous.
 *
 * total_amount_due is left ALONE unless --with-total is passed. Those statements
 * were already issued to customers, and for an account whose previous bill was
 * only part-paid, restating the total changes what was billed. A fully paid
 * previous bill leaves a remaining balance of 0 and so does not move the total
 * at all -- the run reports how many rows --with-total would actually change.
 *
 * Every run writes a before-image CSV and a ready-to-run rollback .sql under
 *     storage/app/soa-backfill/<timestamp>/
 * before touching a row, so any repair can be undone exactly.
 *
 *     php artisan soa:backfill-previous-bill-payment --dry-run
 *     php artisan soa:backfill-previous-bill-payment --account=20220000005
 *     php artisan soa:backfill-previous-bill-payment
 *
 * Options:
 *     --dry-run          report what would change and write nothing. Always run
 *                        this first.
 *     --account=NO       one account only, for verifying the repair by hand
 *     --from=YYYY-MM-DD  only statements dated on or after this
 *     --to=YYYY-MM-DD    only statements dated on or before this
 *     --limit=N          repair at most N statements, oldest-first ordering
 *                        preserved. For a cautious first batch.
 *     --with-total       also recompute total_amount_due as
 *                        remaining_balance_previous + amount_due. Changes billed
 *                        figures: read the count it reports before using it.
 *     --include-overpaid include statements whose previous invoice is paid for
 *                        MORE than it billed. Skipped by default, because the
 *                        bill amount cannot be trusted to derive a remainder.
 *     --chunk=500        rows per UPDATE batch / per transaction
 *
 * A statement whose PDF is already on Google Drive (print_link) keeps a stale
 * PDF: the numbers are fixed in the table, not in the file. The run counts those
 * so they can be regenerated afterwards.
 */
class BackfillSoaPreviousBillPayment extends Command
{
    protected $signature = 'soa:backfill-previous-bill-payment
        {--dry-run : Report what would change and write nothing}
        {--account= : Only this account_no}
        {--from= : Only statements dated on or after YYYY-MM-DD}
        {--to= : Only statements dated on or before YYYY-MM-DD}
        {--limit= : Repair at most N statements}
        {--with-total : Also recompute total_amount_due (changes billed figures)}
        {--include-overpaid : Include invoices paid for more than they billed}
        {--chunk=500 : Rows per UPDATE batch}';

    protected $description = 'Restore payment_received_previous / remaining_balance_previous on SOAs from the invoice they report on';

    /** Money is compared, never equated: anything under a centavo is noise. */
    private const EPSILON = 0.01;

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $withTotal = (bool) $this->option('with-total');
        $includeOverpaid = (bool) $this->option('include-overpaid');
        $chunkSize = max(1, (int) $this->option('chunk'));

        $this->line('');
        $this->info('SOA previous-bill payment backfill' . ($dryRun ? ' (DRY RUN)' : ''));
        $this->line(str_repeat('=', 72));

        try {
            $candidates = $this->fetchCandidates();
        } catch (Throwable $e) {
            $this->error('Could not read the affected statements: ' . $e->getMessage());

            return self::FAILURE;
        }

        if ($candidates === []) {
            $this->info('Nothing to repair: no statement matches the filters.');

            return self::SUCCESS;
        }

        [$repairs, $overpaid] = $this->planRepairs($candidates, $includeOverpaid, $withTotal);

        $this->reportPlan($candidates, $repairs, $overpaid, $includeOverpaid, $withTotal);

        if ($repairs === []) {
            $this->warn('Every candidate was skipped. Nothing to do.');

            return self::SUCCESS;
        }

        if ($dryRun) {
            $this->sample($repairs);
            $this->line('');
            $this->info('Dry run: nothing was written. Re-run without --dry-run to apply.');

            return self::SUCCESS;
        }

        $backupDir = $this->writeBackup($repairs, $withTotal);
        $this->line('');
        $this->info("Before-image and rollback written to: {$backupDir}");

        $applied = $this->apply($repairs, $withTotal, $chunkSize);

        $this->line('');
        $this->info("Repaired {$applied} statement(s).");
        $this->verify();

        return self::SUCCESS;
    }

    /**
     * The statements that lost their payment figure, each with the invoice it
     * reports on.
     *
     * The invoice is picked by date rather than by any stored link, because the
     * statement carries no invoice reference: the bill a statement reports on is
     * the last invoice dated before it.
     *
     * @return array<int, object>
     */
    private function fetchCandidates(): array
    {
        $filters = '';
        $bindings = [];

        if ($account = $this->option('account')) {
            $filters .= ' AND s.account_no = ?';
            $bindings[] = $account;
        }

        if ($from = $this->option('from')) {
            $filters .= ' AND DATE(s.statement_date) >= ?';
            $bindings[] = Carbon::parse($from)->format('Y-m-d');
        }

        if ($to = $this->option('to')) {
            $filters .= ' AND DATE(s.statement_date) <= ?';
            $bindings[] = Carbon::parse($to)->format('Y-m-d');
        }

        $limit = '';
        if ($n = (int) $this->option('limit')) {
            $limit = ' LIMIT ' . max(1, $n);
        }

        $sql = "
            WITH zeroed AS (
                SELECT
                    s.id,
                    s.account_no,
                    s.statement_date,
                    s.balance_from_previous_bill,
                    s.payment_received_previous,
                    s.remaining_balance_previous,
                    s.amount_due,
                    s.total_amount_due,
                    s.print_link
                FROM statement_of_accounts s
                WHERE s.statement_date IS NOT NULL
                  AND COALESCE(s.payment_received_previous, 0) = 0
                  AND COALESCE(s.remaining_balance_previous, 0) = 0
                  {$filters}
            ),
            withprev AS (
                SELECT
                    z.*,
                    (
                        SELECT i.id
                        FROM invoices i
                        WHERE i.account_no = z.account_no
                          AND i.invoice_date IS NOT NULL
                          AND DATE(i.invoice_date) < DATE(z.statement_date)
                        ORDER BY i.invoice_date DESC, i.id DESC
                        LIMIT 1
                    ) AS prev_invoice_id
                FROM zeroed z
            )
            SELECT
                w.*,
                i.invoice_date     AS prev_invoice_date,
                i.total_amount     AS prev_invoice_total,
                i.received_payment AS prev_invoice_paid,
                i.status           AS prev_invoice_status
            FROM withprev w
            JOIN invoices i ON i.id = w.prev_invoice_id
            WHERE COALESCE(i.received_payment, 0) > 0
            ORDER BY w.statement_date ASC, w.account_no ASC
            {$limit}
        ";

        return DB::select($sql, $bindings);
    }

    /**
     * Turn each candidate into the exact row it should become.
     *
     * @param  array<int, object>  $candidates
     * @return array{0: array<int, array<string, mixed>>, 1: array<int, object>}
     *         the repairs, and the overpaid rows held back
     */
    private function planRepairs(array $candidates, bool $includeOverpaid, bool $withTotal): array
    {
        $repairs = [];
        $overpaid = [];

        foreach ($candidates as $row) {
            $billed = (float) $row->prev_invoice_total;
            $paid = (float) $row->prev_invoice_paid;

            // Paid for more than it billed: the bill amount is not trustworthy,
            // so the remainder cannot be derived from it.
            if ($paid > $billed + self::EPSILON) {
                $overpaid[] = $row;

                if (!$includeOverpaid) {
                    continue;
                }
            }

            $remaining = round($billed - $paid, 2);
            $newTotal = $withTotal
                ? round($remaining + (float) $row->amount_due, 2)
                : null;

            $repairs[] = [
                'id' => (int) $row->id,
                'account_no' => $row->account_no,
                'statement_date' => $row->statement_date,
                'print_link' => $row->print_link,

                'old_balance' => $row->balance_from_previous_bill,
                'old_payment' => $row->payment_received_previous,
                'old_remaining' => $row->remaining_balance_previous,
                'old_total' => $row->total_amount_due,

                'new_balance' => round($billed, 2),
                'new_payment' => round($paid, 2),
                'new_remaining' => $remaining,
                'new_total' => $newTotal,

                'prev_invoice_id' => (int) $row->prev_invoice_id,
                'total_changes' => $newTotal !== null
                    && abs($newTotal - (float) $row->total_amount_due) > self::EPSILON,
            ];
        }

        return [$repairs, $overpaid];
    }

    /**
     * @param  array<int, object>  $candidates
     * @param  array<int, array<string, mixed>>  $repairs
     * @param  array<int, object>  $overpaid
     */
    private function reportPlan(array $candidates, array $repairs, array $overpaid, bool $includeOverpaid, bool $withTotal): void
    {
        $accounts = [];
        $money = 0.0;
        $staleP = 0;
        $totalMoves = 0;

        foreach ($repairs as $r) {
            $accounts[$r['account_no']] = true;
            $money += (float) $r['new_payment'];
            if (!empty($r['print_link'])) {
                $staleP++;
            }
            if ($r['total_changes']) {
                $totalMoves++;
            }
        }

        $dates = array_map(fn ($r) => substr((string) $r['statement_date'], 0, 10), $repairs);

        $this->table(['what', 'count'], [
            ['candidate statements', number_format(count($candidates))],
            ['to repair', number_format(count($repairs))],
            ['accounts affected', number_format(count($accounts))],
            ['payments to restore', '₱' . number_format($money, 2)],
            ['statement date range', $dates === [] ? '-' : min($dates) . ' .. ' . max($dates)],
            ['stale PDFs (print_link set)', number_format($staleP)],
            [
                'overpaid, ' . ($includeOverpaid ? 'INCLUDED' : 'skipped'),
                number_format(count($overpaid)),
            ],
            [
                'total_amount_due would change',
                $withTotal
                    ? number_format($totalMoves) . ' (--with-total is ON: these WILL change)'
                    : number_format(0) . ' (--with-total off: totals untouched)',
            ],
        ]);

        if ($overpaid !== [] && !$includeOverpaid) {
            $this->warn(
                count($overpaid) . ' statement(s) skipped: their previous invoice is paid for more than it billed. '
                . 'Pass --include-overpaid to repair them anyway (the remainder goes negative, i.e. a credit).'
            );
        }
    }

    /**
     * Old and new side by side for the two columns the report is about, plus the
     * balance the repair also rewrites.
     *
     * NULL is printed as NULL rather than 0.00: "no value" in these columns is
     * sometimes an empty column and sometimes a stored zero, and the preview is
     * the only place that distinction is visible.
     *
     * @param array<int, array<string, mixed>> $repairs
     */
    private function sample(array $repairs): void
    {
        $this->line('');
        $this->info('First ' . min(15, count($repairs)) . ' of ' . count($repairs) . ' -- old value -> new value:');

        $this->table(
            [
                'soa_id', 'account_no', 'statement',
                'payment OLD', 'payment NEW',
                'remaining OLD', 'remaining NEW',
                'balance OLD', 'balance NEW',
                'invoice',
            ],
            array_map(fn ($r) => [
                $r['id'],
                $r['account_no'],
                substr((string) $r['statement_date'], 0, 10),
                $this->money($r['old_payment']),
                $this->money($r['new_payment']),
                $this->money($r['old_remaining']),
                $this->money($r['new_remaining']),
                $this->money($r['old_balance']),
                $this->money($r['new_balance']),
                $r['prev_invoice_id'],
            ], array_slice($repairs, 0, 15))
        );

        $this->line(
            '  payment   = payment_received_previous  (Payment Received From Previous Bill)' . PHP_EOL
            . '  remaining = remaining_balance_previous (Remaining Balance From Previous Bill)' . PHP_EOL
            . '  balance   = balance_from_previous_bill (Balance From Previous Bill)'
        );
    }

    /** A money cell for the preview, keeping NULL distinct from 0.00. */
    private function money($value): string
    {
        return $value === null ? 'NULL' : number_format((float) $value, 2);
    }

    /**
     * Save the current values, and the SQL that puts them back.
     *
     * @param  array<int, array<string, mixed>>  $repairs
     * @return string the directory both files landed in
     */
    private function writeBackup(array $repairs, bool $withTotal): string
    {
        $dir = storage_path('app/soa-backfill/' . now()->format('Ymd_His'));

        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException("Could not create backup directory {$dir}");
        }

        $csv = fopen($dir . '/before.csv', 'w');
        fputcsv($csv, [
            'soa_id', 'account_no', 'statement_date',
            'old_balance_from_previous_bill', 'old_payment_received_previous',
            'old_remaining_balance_previous', 'old_total_amount_due',
            'new_balance_from_previous_bill', 'new_payment_received_previous',
            'new_remaining_balance_previous', 'new_total_amount_due',
            'prev_invoice_id', 'print_link',
        ]);

        $sqlLines = [
            '-- Rollback for the SOA previous-bill backfill run of ' . now()->format('Y-m-d H:i:s'),
            '-- Restores ' . count($repairs) . ' statement(s) to the values they held before the run.',
            '-- Review, then run inside a transaction.',
            '',
            'START TRANSACTION;',
            '',
        ];

        foreach ($repairs as $r) {
            fputcsv($csv, [
                $r['id'], $r['account_no'], $r['statement_date'],
                $r['old_balance'], $r['old_payment'], $r['old_remaining'], $r['old_total'],
                $r['new_balance'], $r['new_payment'], $r['new_remaining'],
                $r['new_total'] ?? '(unchanged)',
                $r['prev_invoice_id'], $r['print_link'],
            ]);

            $set = [
                'balance_from_previous_bill = ' . $this->sqlValue($r['old_balance']),
                'payment_received_previous = ' . $this->sqlValue($r['old_payment']),
                'remaining_balance_previous = ' . $this->sqlValue($r['old_remaining']),
            ];

            if ($withTotal) {
                $set[] = 'total_amount_due = ' . $this->sqlValue($r['old_total']);
            }

            $sqlLines[] = 'UPDATE statement_of_accounts SET ' . implode(', ', $set)
                . ' WHERE id = ' . (int) $r['id'] . ';';
        }

        fclose($csv);

        $sqlLines[] = '';
        $sqlLines[] = '-- ROLLBACK;';
        $sqlLines[] = '-- COMMIT;';
        file_put_contents($dir . '/rollback.sql', implode(PHP_EOL, $sqlLines) . PHP_EOL);

        return $dir;
    }

    /** A decimal literal, or NULL — never a quoted string, these are money columns. */
    private function sqlValue($value): string
    {
        return $value === null ? 'NULL' : (string) round((float) $value, 2);
    }

    /**
     * Write the repairs, one transaction per chunk.
     *
     * Each chunk is a single UPDATE with CASE arms rather than one statement per
     * row: 67k round trips to the database is minutes of latency, 130 batched
     * statements is seconds. Every interpolated value is cast to int or float
     * first, so no row content reaches the SQL as text.
     *
     * @param  array<int, array<string, mixed>>  $repairs
     */
    private function apply(array $repairs, bool $withTotal, int $chunkSize): int
    {
        $bar = $this->output->createProgressBar(count($repairs));
        $bar->start();

        $applied = 0;
        $stamp = now()->format('Y-m-d H:i:s');

        foreach (array_chunk($repairs, $chunkSize) as $chunk) {
            try {
                DB::transaction(function () use ($chunk, $withTotal, $stamp, &$applied) {
                    $ids = [];
                    $balance = [];
                    $payment = [];
                    $remaining = [];
                    $total = [];

                    foreach ($chunk as $r) {
                        $id = (int) $r['id'];
                        $ids[] = $id;
                        $balance[] = "WHEN {$id} THEN " . round((float) $r['new_balance'], 2);
                        $payment[] = "WHEN {$id} THEN " . round((float) $r['new_payment'], 2);
                        $remaining[] = "WHEN {$id} THEN " . round((float) $r['new_remaining'], 2);

                        if ($withTotal && $r['new_total'] !== null) {
                            $total[] = "WHEN {$id} THEN " . round((float) $r['new_total'], 2);
                        }
                    }

                    $set = [
                        'balance_from_previous_bill = CASE id ' . implode(' ', $balance) . ' ELSE balance_from_previous_bill END',
                        'payment_received_previous = CASE id ' . implode(' ', $payment) . ' ELSE payment_received_previous END',
                        'remaining_balance_previous = CASE id ' . implode(' ', $remaining) . ' ELSE remaining_balance_previous END',
                    ];

                    if ($total !== []) {
                        $set[] = 'total_amount_due = CASE id ' . implode(' ', $total) . ' ELSE total_amount_due END';
                    }

                    $set[] = "updated_by = 'soa-payment-backfill'";
                    $set[] = 'updated_at = ?';

                    $sql = 'UPDATE statement_of_accounts SET ' . implode(', ', $set)
                        . ' WHERE id IN (' . implode(',', $ids) . ')';

                    $applied += DB::update($sql, [$stamp]);
                });
            } catch (Throwable $e) {
                $bar->clear();
                $this->error('Batch failed and was rolled back: ' . $e->getMessage());
                $this->warn('Statements repaired before this batch stay repaired; rerun to continue.');
                $bar->display();

                break;
            }

            $bar->advance(count($chunk));
        }

        $bar->finish();
        $this->line('');

        return $applied;
    }

    /** How many statements still match the broken shape, across the whole table. */
    private function verify(): void
    {
        $left = DB::selectOne("
            WITH zeroed AS (
                SELECT s.id, s.account_no, s.statement_date
                FROM statement_of_accounts s
                WHERE s.statement_date IS NOT NULL
                  AND COALESCE(s.payment_received_previous, 0) = 0
                  AND COALESCE(s.remaining_balance_previous, 0) = 0
            )
            SELECT COUNT(*) AS remaining
            FROM zeroed z
            JOIN invoices i
              ON i.id = (
                    SELECT i2.id
                    FROM invoices i2
                    WHERE i2.account_no = z.account_no
                      AND i2.invoice_date IS NOT NULL
                      AND DATE(i2.invoice_date) < DATE(z.statement_date)
                    ORDER BY i2.invoice_date DESC, i2.id DESC
                    LIMIT 1
                 )
            WHERE COALESCE(i.received_payment, 0) > 0
        ");

        $remaining = (int) ($left->remaining ?? 0);

        if ($remaining === 0) {
            $this->info('Verified: no statement in the table still matches the broken shape.');

            return;
        }

        $this->warn(
            "Still matching table-wide: {$remaining}. That is expected when the run was filtered "
            . '(--account / --from / --to / --limit) or when rows were skipped as overpaid.'
        );
    }
}
