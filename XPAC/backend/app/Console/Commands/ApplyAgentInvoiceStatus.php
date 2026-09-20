<?php

namespace App\Console\Commands;

use App\Models\AgentInvoice;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Set every agent invoice's status from a spreadsheet of client payments.
 *
 * The spreadsheet is per CLIENT; an invoice status is per INVOICE. The rule
 * bridging them is the one asked for: a client whose STATUS is not "Paid" is
 * unpaid, and an invoice carrying any unpaid client is Unpaid. An invoice whose
 * matched clients are all paid becomes Paid.
 *
 * Expected columns, by position, matching the exported file:
 *
 *     Agent name , Client's Name , AMOUNT , STATUS
 *
 * The agent column is filled only on the first row of each block, so it is
 * carried down. Rows with no client name are padding and are skipped. Names may
 * span lines inside quotes, which is why this reads with fgetcsv() rather than
 * splitting on commas.
 *
 * MATCHING
 * ---------------------------------------------------------------------------
 * Invoice customers are stored with a middle initial ("Jerome P. Penaflor") and
 * the spreadsheet has none ("Jerome Penaflor"), so an exact comparison would
 * miss nearly everything. Names are therefore reduced to first and last word,
 * lowercased and stripped of punctuation, and compared on that. Every name the
 * spreadsheet offers that no invoice claims, and every invoice customer the
 * spreadsheet never mentions, is reported rather than passed over quietly.
 *
 * SAFETY
 * ---------------------------------------------------------------------------
 * Reports by default and writes only with --apply, because this rewrites the
 * status of financial records in bulk and the matching is by name.
 *
 * An invoice none of whose customers appear in the spreadsheet is counted as
 * PAID, the sheet being taken as a record of what is outstanding rather than a
 * roll of every customer. Pass --unmatched=skip to leave those invoices at
 * whatever status they already carry, which is the cautious reading: a name the
 * matcher failed to line up then keeps its old status instead of being called
 * paid. The report lists every such name either way.
 *
 *     php artisan agents:apply-invoice-status --file=storage/app/invoicestatus.csv
 *     php artisan agents:apply-invoice-status --file=storage/app/invoicestatus.csv --apply
 */
class ApplyAgentInvoiceStatus extends Command
{
    protected $signature = 'agents:apply-invoice-status
                            {--file=storage/app/invoicestatus.csv : Path to the CSV, absolute or relative to the project root}
                            {--apply : Write the statuses. Without this the command only reports.}
                            {--paid-value=Paid : The STATUS spelling that counts as paid; everything else is unpaid}
                            {--unmatched=paid : What to do with an invoice no client in the sheet matches: paid|skip}
                            {--show-unmatched=25 : How many unmatched names to list before summarising}';

    protected $description = 'Set agent invoice statuses to Paid/Unpaid from a per-client CSV of payments.';

    public function handle(): int
    {
        $apply     = (bool) $this->option('apply');
        $paidValue = strtolower(trim((string) $this->option('paid-value')));
        $listLimit = max((int) $this->option('show-unmatched'), 0);

        $unmatched = strtolower(trim((string) $this->option('unmatched')));
        if (!in_array($unmatched, ['paid', 'skip'], true)) {
            $this->error('[STATUS] --unmatched must be "paid" or "skip".');
            return self::FAILURE;
        }
        $unmatchedSkips = $unmatched === 'skip';

        $path = (string) $this->option('file');
        if (!str_starts_with($path, '/') && !preg_match('/^[A-Za-z]:/', $path)) {
            $path = base_path($path);
        }

        if (!is_readable($path)) {
            $this->error("[STATUS] Cannot read {$path}");
            return self::FAILURE;
        }

        try {
            $clients = $this->readCsv($path, $paidValue);
        } catch (Throwable $e) {
            $this->error('[STATUS] Could not read the CSV: ' . $e->getMessage());
            return self::FAILURE;
        }

        if ($clients === []) {
            $this->error('[STATUS] No client rows found. Check the column order: agent, client, amount, status.');
            return self::FAILURE;
        }

        $paidCount   = count(array_filter($clients, fn ($c) => $c['paid']));
        $unpaidCount = count($clients) - $paidCount;

        $this->info(sprintf(
            '[STATUS] %d client(s) read: %d paid, %d unpaid%s',
            count($clients),
            $paidCount,
            $unpaidCount,
            $apply ? '' : ' — REPORT ONLY, nothing will be written'
        ));

        foreach ($this->spellings($clients) as $spelling => $count) {
            $this->line(sprintf('    %-12s %-4d -> %s', $spelling, $count, $this->verdictFor($spelling, $paidValue)));
        }

        $this->line('');

        // Every invoice with its customers' names, in one pass.
        $invoices = AgentInvoice::with(['customers:id,agent_invoice_id,customer_name'])->get();

        if ($invoices->isEmpty()) {
            $this->warn('[STATUS] There are no agent invoices to update.');
            return self::SUCCESS;
        }

        $seen    = [];   // client keys an invoice actually claimed
        $plan    = [];
        $totals  = ['Paid' => 0, 'Unpaid' => 0, 'unchanged' => 0, 'skipped' => 0];

        foreach ($invoices as $invoice) {
            $matched = 0;
            $unpaid  = 0;

            foreach ($invoice->customers as $customer) {
                $key = $this->nameKey((string) $customer->customer_name);

                if ($key === '' || !isset($clients[$key])) {
                    continue;
                }

                $seen[$key] = true;
                $matched++;

                if (!$clients[$key]['paid']) {
                    $unpaid++;
                }
            }

            // An invoice none of whose customers appear in the sheet. Counted as
            // paid by default, on the instruction that the sheet lists only what
            // is outstanding, so anything absent from it has been settled.
            // --unmatched=skip leaves those invoices at whatever status they
            // already carry instead.
            if ($matched === 0 && $unmatchedSkips) {
                $totals['skipped']++;
                continue;
            }

            $status = $unpaid > 0 ? AgentInvoice::STATUS_UNPAID : AgentInvoice::STATUS_PAID;

            if ($invoice->status === $status) {
                $totals['unchanged']++;
                continue;
            }

            $totals[$status]++;
            $plan[] = [
                'id'      => $invoice->id,
                'number'  => $invoice->invoice_number,
                'owner'   => $invoice->team_name ?: $invoice->agent_name,
                'from'    => $invoice->status,
                'to'      => $status,
                'matched' => $matched,
                'unpaid'  => $unpaid,
            ];
        }

        foreach ($plan as $row) {
            $this->line(sprintf(
                '  %-16s %-22s %-10s -> %-7s (%d matched, %d unpaid)',
                $row['number'],
                mb_strimwidth((string) $row['owner'], 0, 22, '…'),
                $row['from'],
                $row['to'],
                $row['matched'],
                $row['unpaid']
            ));
        }

        $this->reportUnmatched($clients, $seen, $listLimit);

        $this->line('');
        $this->info(sprintf(
            '[STATUS] %d invoice(s): %d -> Paid, %d -> Unpaid, %d already correct, %d untouched.',
            $invoices->count(),
            $totals['Paid'],
            $totals['Unpaid'],
            $totals['unchanged'],
            $totals['skipped']
        ));

        if (!$unmatchedSkips) {
            $this->line('[STATUS] Invoices matching no client in the sheet were counted as Paid '
                . '(--unmatched=skip leaves them as they are).');
        }

        if (!$apply) {
            $this->warn('[STATUS] Report only. Re-run with --apply to write these statuses.');
            return self::SUCCESS;
        }

        if ($plan === []) {
            $this->info('[STATUS] Nothing to change.');
            return self::SUCCESS;
        }

        // Grouped into two updates rather than one per invoice: the set is known
        // before anything is written, so there is no reason to issue hundreds of
        // statements or to leave the table half-converted if one of them fails.
        try {
            DB::transaction(function () use ($plan) {
                foreach ([AgentInvoice::STATUS_PAID, AgentInvoice::STATUS_UNPAID] as $status) {
                    $ids = array_column(array_filter($plan, fn ($p) => $p['to'] === $status), 'id');

                    if ($ids !== []) {
                        AgentInvoice::whereIn('id', $ids)->update([
                            'status'     => $status,
                            'updated_by' => 'agents:apply-invoice-status',
                        ]);
                    }
                }
            });
        } catch (Throwable $e) {
            $this->error('[STATUS] Nothing was written: ' . $e->getMessage());
            return self::FAILURE;
        }

        $this->info(sprintf('[STATUS] Applied. %d invoice(s) updated.', count($plan)));

        return self::SUCCESS;
    }

    /**
     * Client name => ['paid' => bool, 'status' => string, 'agent' => string].
     *
     * The agent column is carried down through the block it heads, and rows
     * without a client name are padding.
     */
    private function readCsv(string $path, string $paidValue): array
    {
        $handle = fopen($path, 'r');

        if ($handle === false) {
            throw new \RuntimeException('fopen failed');
        }

        fgetcsv($handle); // header

        $clients = [];
        $agent   = '';

        while (($row = fgetcsv($handle)) !== false) {
            $agentCell = $this->tidy($row[0] ?? '');
            $client    = $this->tidy($row[1] ?? '');
            $status    = $this->tidy($row[3] ?? '');

            if ($agentCell !== '') {
                $agent = $agentCell;
            }

            if ($client === '') {
                continue;
            }

            $key = $this->nameKey($client);

            if ($key === '') {
                continue;
            }

            $clients[$key] = [
                'name'   => $client,
                'agent'  => $agent,
                'status' => $status,
                'paid'   => strtolower($status) === $paidValue,
            ];
        }

        fclose($handle);

        return $clients;
    }

    /** How each STATUS spelling in the sheet was read, for the run's header. */
    private function spellings(array $clients): array
    {
        $counts = [];

        foreach ($clients as $client) {
            $label = $client['status'] === '' ? '(blank)' : $client['status'];
            $counts[$label] = ($counts[$label] ?? 0) + 1;
        }

        arsort($counts);

        return $counts;
    }

    private function verdictFor(string $spelling, string $paidValue): string
    {
        return strtolower($spelling) === $paidValue ? 'Paid' : 'Unpaid';
    }

    /**
     * Names in the sheet that no invoice claimed.
     *
     * Worth printing rather than counting: a name here is a payment the sheet
     * records against a customer no invoice bills, which is either a spelling
     * difference or a referral that was never invoiced. Both need a human.
     */
    private function reportUnmatched(array $clients, array $seen, int $limit): void
    {
        $missing = array_diff_key($clients, $seen);

        if ($missing === []) {
            return;
        }

        $this->line('');
        $this->warn(sprintf('[STATUS] %d client(s) in the sheet matched no invoice customer:', count($missing)));

        $shown = 0;

        foreach ($missing as $client) {
            if ($limit > 0 && $shown >= $limit) {
                $this->line(sprintf('    ... and %d more', count($missing) - $shown));
                break;
            }

            $this->line(sprintf(
                '    %-28s %-10s (agent: %s)',
                mb_strimwidth($client['name'], 0, 28, '…'),
                $client['status'],
                $client['agent']
            ));

            $shown++;
        }
    }

    /** Collapse whitespace and trim, leaving the name otherwise as written. */
    private function tidy($value): string
    {
        return trim(preg_replace('/\s+/', ' ', (string) $value));
    }

    /**
     * The comparable form of a name: first and last word, lowercased.
     *
     * Invoice customers carry a middle initial and the sheet does not, so the
     * middle of a name cannot be part of the comparison. Punctuation goes too,
     * which is what makes "Jerome P. Penaflor" and "Jerome Penaflor" the same
     * person.
     */
    private function nameKey(string $name): string
    {
        $clean = preg_replace('/[^a-z\s]/', '', strtolower($this->tidy($name)));
        $parts = array_values(array_filter(explode(' ', (string) $clean), fn ($p) => $p !== ''));

        if ($parts === []) {
            return '';
        }

        if (count($parts) === 1) {
            return $parts[0];
        }

        return $parts[0] . ' ' . $parts[count($parts) - 1];
    }
}
