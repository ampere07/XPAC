<?php

namespace App\Console\Commands;

use App\Services\AgentInvoiceService;
use App\Support\AgentProgramme;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Backfill every agent referral invoice, one calendar week at a time.
 *
 * Walks from the first week that has billable work up to the last week that has
 * fully ended, generating each in order. Every window is Monday 00:00:00 to
 * Sunday 23:59:59 and consecutive windows abut exactly, so the result is the
 * sequence a Monday cron would have produced had it never missed a week:
 *
 *     Aug 3  - Aug 9
 *     Aug 10 - Aug 16
 *     Aug 17 - Aug 23
 *
 * The week the run sits in is never billed - it has not finished yet.
 *
 * Nothing here decides what is billable. Each week is handed to the same
 * AgentInvoiceService::generateForWeek() the cron and the Generate button call,
 * so a backfilled invoice is identical to a scheduled one.
 *
 * Safe to run repeatedly, and safe against a database that already has invoices.
 * An owner already invoiced for a week is skipped, and a customer already billed
 * to that owner is refused by the database, so weeks that are already done
 * produce nothing and only the gaps fill in.
 *
 *     php artisan agents:backfill-invoices --dry-run
 *     php artisan agents:backfill-invoices
 *
 * Options:
 *     --from=YYYY-MM-DD   first week to generate; snapped back to its Monday.
 *                         Defaults to the week of the earliest referral or
 *                         incentive not yet billed - i.e. everything.
 *     --to=YYYY-MM-DD     last week to generate; snapped back to its Monday.
 *                         Defaults to the last week that has fully ended.
 *     --agent=ID          only the owner this agent belongs to (a team or
 *                         themselves), for testing one case
 *     --max-weeks=N       refuse to walk more than N weeks (default 520). A
 *                         guard against one malformed date dragging the
 *                         scan back to 1970.
 *     --dry-run           list the weeks that would be generated, writing
 *                         nothing. Each week is annotated with the unbilled
 *                         referrals and incentives in it, so empty weeks show.
 *     --quiet-log         write the run log without the per-customer detail
 *     --no-echo           do not mirror the run log to the console
 *
 * Every week appends to the same storage/logs/agent-invoices/Agent_Invoices.log
 * the scheduled run writes, tagged as a backfill.
 */
class BackfillAgentInvoices extends Command
{
    protected $signature = 'agents:backfill-invoices
                            {--from= : First week to generate (YYYY-MM-DD, snapped to its Monday)}
                            {--to= : Last week to generate (YYYY-MM-DD, snapped to its Monday)}
                            {--agent= : Only the owner this agent id belongs to}
                            {--max-weeks=520 : Refuse to walk more than this many weeks}
                            {--dry-run : List the weeks that would be generated, writing nothing}
                            {--quiet-log : Omit the per-customer [VERBOSE] detail from the log}
                            {--no-echo : Do not mirror the run log to the console}';

    protected $description = 'Generate every agent referral invoice from the beginning, aligned to Monday-Sunday weeks.';

    public function handle(AgentInvoiceService $service): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $agentId = $this->option('agent');
        $agentId = ($agentId === null || $agentId === '') ? null : (int) $agentId;

        $maxWeeks = (int) $this->option('max-weeks');
        if ($maxWeeks < 1) {
            $this->error('[BACKFILL] --max-weeks must be at least 1.');
            return self::FAILURE;
        }

        // The last week that has fully ended, asked of the service rather than
        // worked out again here - a backfill that stopped on a different week
        // from the one the cron bills would leave a permanent seam between them.
        $lastMonday = $service->periodFor()[0]->copy();

        try {
            $firstMonday = $this->resolveFirstMonday();
        } catch (Throwable $e) {
            $this->error('[BACKFILL] Could not read --from: ' . $e->getMessage());
            return self::FAILURE;
        }

        if ($firstMonday === null) {
            $this->warn('[BACKFILL] Nothing to bill - every completed referral and every awarded incentive is already on an invoice.');
            return self::SUCCESS;
        }

        if ($given = $this->option('to')) {
            try {
                $requestedLast = Carbon::parse($given)->startOfDay()->startOfWeek(Carbon::MONDAY);
            } catch (Throwable $e) {
                $this->error('[BACKFILL] Could not read --to: ' . $e->getMessage());
                return self::FAILURE;
            }

            // A --to inside the current week would ask for a week that has not
            // finished. Clamped rather than refused, so "--to=today" behaves.
            $lastMonday = $requestedLast->lessThan($lastMonday) ? $requestedLast : $lastMonday;
        }

        if ($firstMonday->greaterThan($lastMonday)) {
            $this->warn(sprintf(
                '[BACKFILL] Nothing to do: the first week (%s) is after the last completed week (%s).',
                $firstMonday->format('Y-m-d'),
                $lastMonday->format('Y-m-d')
            ));
            return self::SUCCESS;
        }

        $weekCount = (int) $firstMonday->diffInWeeks($lastMonday) + 1;

        if ($weekCount > $maxWeeks) {
            $this->error(sprintf(
                '[BACKFILL] Refusing to walk %d weeks (%s to %s), which is over the --max-weeks limit of %d. '
                . 'Check for a row with a bad date, or raise the limit deliberately.',
                $weekCount,
                $firstMonday->format('Y-m-d'),
                $lastMonday->format('Y-m-d'),
                $maxWeeks
            ));
            return self::FAILURE;
        }

        $this->info(sprintf(
            '[BACKFILL] %d week(s), %s to %s%s%s',
            $weekCount,
            $firstMonday->format('Y-m-d'),
            $lastMonday->copy()->addDays(6)->format('Y-m-d'),
            $agentId !== null ? " (agent #{$agentId} only)" : '',
            $dryRun ? ' - DRY RUN, nothing will be written' : ''
        ));
        $this->line('');

        if ($dryRun) {
            return $this->listWeeks($firstMonday, $lastMonday);
        }

        $service->setVerbose(
            !$this->option('quiet-log'),
            !$this->option('no-echo')
        );

        $totals = [
            'weeks'            => 0,
            'weeks_failed'     => 0,
            'invoices_created' => 0,
            'invoices_skipped' => 0,
            'customers_billed' => 0,
            'amount_invoiced'  => 0.0,
            'pdf_failures'     => 0,
            'errors'           => 0,
        ];

        for ($monday = $firstMonday->copy(); $monday->lessThanOrEqualTo($lastMonday); $monday->addWeek()) {
            // periodFor() bills the week BEFORE the one its argument sits in, so
            // the Monday after the target week is the date that selects it. The
            // window itself is never restated here - it comes back from the
            // service, which is what keeps a backfilled week identical to a
            // scheduled one.
            $asOf = $monday->copy()->addWeek();

            $label = sprintf(
                '%s to %s',
                $monday->format('Y-m-d'),
                $monday->copy()->addDays(6)->format('Y-m-d')
            );

            $service->setTriggeredBy(sprintf('backfill (cli) - week %s', $label));

            try {
                $summary = $service->generateForWeek($asOf, $agentId);
            } catch (Throwable $e) {
                // One bad week does not abandon the rest - the weeks are
                // independent, and stopping here would leave a gap that no later
                // run has any way to notice.
                $totals['weeks_failed']++;
                $this->error(sprintf('  %s  FAILED: %s', $label, $e->getMessage()));
                continue;
            }

            $totals['weeks']++;
            $totals['invoices_created'] += $summary['invoices_created'];
            $totals['invoices_skipped'] += $summary['invoices_skipped'];
            $totals['customers_billed'] += $summary['customers_billed'];
            $totals['amount_invoiced']  += $summary['amount_invoiced'];
            $totals['pdf_failures']     += $summary['pdf_failures'];
            $totals['errors']           += $summary['errors'];

            $this->line(sprintf(
                '  %s  invoices: %-3d  already: %-3d  customers: %-3d  amount: %s%s',
                $label,
                $summary['invoices_created'],
                $summary['invoices_skipped'],
                $summary['customers_billed'],
                number_format($summary['amount_invoiced'], 2),
                $summary['errors'] > 0 ? "  ({$summary['errors']} error(s))" : ''
            ));
        }

        $this->line('');
        $this->info(sprintf(
            '[BACKFILL] Done. Weeks: %d (failed %d), Invoices: %d, Already invoiced: %d, Customers: %d, '
            . 'Amount: %s, PDF failures: %d, Errors: %d',
            $totals['weeks'],
            $totals['weeks_failed'],
            $totals['invoices_created'],
            $totals['invoices_skipped'],
            $totals['customers_billed'],
            number_format($totals['amount_invoiced'], 2),
            $totals['pdf_failures'],
            $totals['errors']
        ));

        return ($totals['errors'] > 0 || $totals['weeks_failed'] > 0) ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Print the window sequence, with what is waiting in each week.
     *
     * Beside each week are the two things that can put an invoice on it: the
     * unbilled referrals installed in it, and the unbilled incentives awarded in
     * it. A week showing neither will produce no invoice. Listing the weeks
     * without this was actively misleading: a walk can span years of weeks while
     * only a handful hold anything, and the bare list gave no way to tell.
     *
     * It stays an indication rather than a promise. Ownership, teams and the
     * per-owner already-billed checks are all still applied by generateForWeek(),
     * so a week's invoice count can differ from the agents shown here.
     */
    private function listWeeks(Carbon $firstMonday, Carbon $lastMonday): int
    {
        $pending  = $this->pendingByWeek($firstMonday, $lastMonday);
        $withWork = 0;

        for ($monday = $firstMonday->copy(); $monday->lessThanOrEqualTo($lastMonday); $monday->addWeek()) {
            $end = $monday->copy()->addDays(6);
            $key = $monday->format('Y-m-d');

            $week = $pending[$key] ?? null;

            if ($week !== null) {
                $withWork++;
            }

            $this->line(sprintf(
                '  %s (%s) to %s (%s)   %s',
                $key,
                $monday->format('D'),
                $end->format('Y-m-d'),
                $end->format('D'),
                $week === null
                    ? '-'
                    : sprintf(
                        'referrals: %-4d  quotas: %-3d  incentive: %s',
                        $week['customers'],
                        $week['quotas'],
                        number_format($week['amount'], 2)
                    )
            ));
        }

        $this->line('');
        $this->info(sprintf(
            '[BACKFILL] Dry run - nothing written. %d of %d week(s) have unbilled referrals or '
            . 'incentives; the rest will generate no invoice.',
            $withWork,
            (int) $firstMonday->diffInWeeks($lastMonday) + 1
        ));

        if ($withWork === 0) {
            $this->warn('[BACKFILL] No week in this range has anything to bill - every referral and '
                . 'incentive in it is already on an invoice.');
        }

        return self::SUCCESS;
    }

    /**
     * What is waiting in each week, bucketed into the Monday that opens it.
     *
     * Two queries for the whole range rather than two per week: a multi-year
     * walk would otherwise issue hundreds of round trips to render a dry run.
     *
     * @return array<string, array{customers: int, quotas: int, amount: float}>
     */
    private function pendingByWeek(Carbon $firstMonday, Carbon $lastMonday): array
    {
        $from = $firstMonday->format('Y-m-d H:i:s');
        $to   = $lastMonday->copy()->addDays(6)->endOfDay()->format('Y-m-d H:i:s');

        $byWeek = [];

        // Bucketed in PHP, not SQL: MySQL's WEEK() has its own mode rules and
        // would be a second place for the Monday boundary to be defined.
        $bucket = function (string $when) use (&$byWeek): string {
            $key = Carbon::parse($when)->startOfWeek(Carbon::MONDAY)->format('Y-m-d');

            if (!isset($byWeek[$key])) {
                $byWeek[$key] = ['customers' => 0, 'quotas' => 0, 'amount' => 0.0];
            }

            return $key;
        };

        $completedAt    = AgentProgramme::onboardedAtSql('jo');
        $programmeStart = AgentProgramme::startDate();

        $referrals = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(jo.onsite_status))'), ['done', 'completed'])
            ->whereNotNull('a.referred_by')
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                  ->from('agent_invoice_customers as aic')
                  ->whereColumn('aic.application_id', 'a.id');
            })
            ->whereRaw("{$completedAt} >= ?", [$from])
            ->whereRaw("{$completedAt} <= ?", [$to]);

        if ($programmeStart !== null) {
            $referrals->whereRaw("{$completedAt} >= ?", [$programmeStart->format('Y-m-d H:i:s')]);
        }

        foreach ($referrals->selectRaw("{$completedAt} as completed_at")->get() as $row) {
            if ($row->completed_at === null) {
                continue;
            }

            $byWeek[$bucket((string) $row->completed_at)]['customers']++;
        }

        $incentives = DB::table('agent_incentive_history')
            ->whereNull('agent_invoice_id')
            ->where('incentive_value', '>', 0)
            ->whereNotNull('processed_at')
            ->where('processed_at', '>=', $from)
            ->where('processed_at', '<=', $to)
            ->get(['incentive_value', 'processed_at']);

        foreach ($incentives as $row) {
            $key = $bucket((string) $row->processed_at);

            $byWeek[$key]['quotas']++;
            $byWeek[$key]['amount'] += (float) $row->incentive_value;
        }

        return $byWeek;
    }

    /**
     * The Monday of the first week to generate.
     *
     * With --from, that date snapped back to its Monday. Without it, the earlier
     * of the two things that can put an invoice on a week:
     *
     *   • a referral not yet billed to anyone, by its install date, and
     *   • an incentive not yet billed, by its `processed_at`.
     *
     * Both are needed because generateForOwner() invoices an owner that has
     * EITHER — a week of installs that completed no quota still bills its
     * commission, and a quota that completed in a week whose installs all fall
     * in the next one still bills its incentive. Anchoring on incentives alone
     * made the walk report nothing to do the moment every quota was claimed,
     * even with years of unbilled referrals sitting behind it.
     *
     * This mirrors the service's filters and is used only to choose where the
     * scan starts - every decision about what is actually billable stays with
     * generateForWeek(). If the two ever drift, the cost is some empty weeks at
     * the front of the walk, which generate nothing.
     *
     * @return Carbon|null  null when neither kind of work exists at all
     */
    private function resolveFirstMonday(): ?Carbon
    {
        if ($given = $this->option('from')) {
            return Carbon::parse($given)->startOfDay()->startOfWeek(Carbon::MONDAY);
        }

        $candidates = array_filter([
            $this->earliestUnbilledReferral(),
            $this->earliestUnbilledIncentive(),
        ]);

        if ($candidates === []) {
            return null;
        }

        return Carbon::parse(min($candidates))->startOfDay()->startOfWeek(Carbon::MONDAY);
    }

    /**
     * When the oldest referral that nobody has invoiced yet was installed.
     *
     * "Not billed" is judged against agent_invoice_customers, the same record
     * billableCustomers() consults. It checks per owner and this checks against
     * every owner, which is deliberate: a start date one week too early costs an
     * empty week, one week too late would silently skip real work.
     */
    private function earliestUnbilledReferral(): ?string
    {
        $completedAt = AgentProgramme::onboardedAtSql('jo');

        $query = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(jo.onsite_status))'), ['done', 'completed'])
            ->whereNotNull('a.referred_by')
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                  ->from('agent_invoice_customers as aic')
                  ->whereColumn('aic.application_id', 'a.id');
            });

        $programmeStart = AgentProgramme::startDate();
        if ($programmeStart !== null) {
            $query->whereRaw("{$completedAt} >= ?", [$programmeStart->format('Y-m-d H:i:s')]);
        }

        return $this->usableDate($query->selectRaw("MIN({$completedAt}) as earliest")->value('earliest'));
    }

    /** When the oldest incentive that no invoice has claimed was awarded. */
    private function earliestUnbilledIncentive(): ?string
    {
        $query = DB::table('agent_incentive_history')
            ->whereNull('agent_invoice_id')
            ->where('incentive_value', '>', 0)
            ->whereNotNull('processed_at');

        $programmeStart = AgentProgramme::startDate();
        if ($programmeStart !== null) {
            $query->where('processed_at', '>=', $programmeStart->format('Y-m-d H:i:s'));
        }

        return $this->usableDate($query->min('processed_at'));
    }

    /**
     * A date string worth walking from, or null.
     *
     * A zero date is MySQL's way of saying the column was never set; it parses
     * as year 0 and would drag the walk back two millennia.
     */
    private function usableDate($value): ?string
    {
        if ($value === null || $value === '' || str_starts_with((string) $value, '0000')) {
            return null;
        }

        return (string) $value;
    }
}
