<?php

namespace App\Console\Commands;

use App\Support\AgentProgramme;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Find referrals that name a TEAM instead of an agent, and write them to CSV.
 *
 * "Referred By" used to let a team heading be picked as well as an agent name.
 * A team name matches no agent, so JobOrderAgentPaymentService::referringAgent()
 * finds nobody and the referral is silently never paid — the approval succeeds
 * and nothing looks wrong. The forms no longer allow it; these are the rows that
 * were written while they did.
 *
 * Two files, because the two tables answer different questions:
 *
 *     customers   who is on the books with an unusable referrer
 *     job_orders  which installs will not settle a commission
 *
 * job_orders carries no referred_by column of its own — the referral lives on
 * the application the job order was raised from — so that export joins through
 * applications, exactly as the invoice and commission code does.
 *
 *     php artisan agents:export-team-referrals
 *     php artisan agents:export-team-referrals --from=2026-08-10
 *     php artisan agents:export-team-referrals --out=/tmp
 *
 * Reads only. Nothing is written to the database.
 */
class ExportTeamNameReferrals extends Command
{
    protected $signature = 'agents:export-team-referrals
                            {--from= : Only rows from this date onwards (YYYY-MM-DD). Defaults to the agent programme start date, or the whole history when it has none.}
                            {--out= : Directory for the CSV files. Defaults to storage/app/exports.}';

    protected $description = 'Export customers and job orders whose Referred By holds a team name rather than an agent.';

    public function handle(): int
    {
        $from = $this->option('from');

        if ($from) {
            try {
                $from = Carbon::parse($from)->startOfDay();
            } catch (Throwable $e) {
                $this->error("Could not read --from=\"{$from}\": " . $e->getMessage());
                return self::FAILURE;
            }
        } else {
            // The programme start date is the point before which no referral was
            // ever payable, so it is the natural floor for this hunt.
            //
            // NULL when the programme has no start date, and that is deliberate:
            // with no cut-off every referral counts, so an export that quietly
            // floored itself at some remembered date would under-report the very
            // records it exists to find. Pass --from to impose one by hand.
            $from = AgentProgramme::startDate();
        }

        $outDir = rtrim($this->option('out') ?: storage_path('app/exports'), '/\\');
        if (!is_dir($outDir) && !@mkdir($outDir, 0775, true) && !is_dir($outDir)) {
            $this->error("Could not create the output directory: {$outDir}");
            return self::FAILURE;
        }

        $labels = $this->teamLabels();
        if (empty($labels)) {
            $this->warn('No teams found, so nothing could have been referred to one. Nothing to export.');
            return self::SUCCESS;
        }

        $this->info(sprintf('Looking for referrals naming one of %d team labels, %s.',
            count($labels),
            $from ? 'from ' . $from->format('Y-m-d') . ' onwards' : 'across their whole history (no date floor)'));
        $this->line('  ' . implode(', ', array_map(fn ($l) => '"' . $l . '"', array_slice($labels, 0, 12)))
            . (count($labels) > 12 ? ', …' : ''));

        $stamp = $from ? $from->format('Y-m-d') : 'all';

        try {
            $customers = $this->writeCsv(
                $outDir . "/customers-referred-by-team-from-{$stamp}.csv",
                ['customer_id', 'account_no', 'first_name', 'middle_initial', 'last_name',
                 'email_address', 'contact_number_primary', 'city', 'referred_by', 'created_at'],
                $this->customers($labels, $from)
            );

            // The settlement columns arrived with the agent payment work, which
            // may not have reached this server yet. Reported when they are there
            // and quietly left out when they are not, so the export never fails
            // for want of a migration.
            $settlement = array_values(array_filter(
                ['commission_status', 'agent_paid_at', 'agent_paid_to'],
                fn ($c) => \Illuminate\Support\Facades\Schema::hasColumn('job_orders', $c)
            ));

            if (count($settlement) < 3) {
                $this->warn('  note: job_orders is missing ' . implode(', ',
                    array_diff(['commission_status', 'agent_paid_at', 'agent_paid_to'], $settlement))
                    . ' — those columns are omitted from the export.');
            }

            $jobOrders = $this->writeCsv(
                $outDir . "/job-orders-referred-by-team-from-{$stamp}.csv",
                array_merge(
                    ['job_order_id', 'application_id', 'onsite_status', 'billing_status', 'assigned_email',
                     'timestamp', 'date_installed', 'onboarded_at', 'first_name', 'last_name', 'referred_by'],
                    $settlement
                ),
                $this->jobOrders($labels, $from, $settlement)
            );
        } catch (Throwable $e) {
            $this->error('Export failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        $this->newLine();
        $this->line(sprintf('  %-58s %d row(s)', basename($customers['path']), $customers['rows']));
        $this->line(sprintf('  %-58s %d row(s)', basename($jobOrders['path']), $jobOrders['rows']));
        $this->newLine();
        $this->info('Written to ' . $outDir);

        if ($customers['rows'] === 0 && $jobOrders['rows'] === 0) {
            $this->line('Nothing matched — no referral names a team'
                . ($from ? ' on or after ' . $from->format('Y-m-d') : ' at any point in the records') . '.');
        }

        return self::SUCCESS;
    }

    /**
     * Every value the old dropdown could write as a "team" choice.
     *
     * The group headings were the team name, or "Team {id}" where a team had no
     * name, plus the literal "No Team" bucket that held agents belonging to no
     * team — that heading was selectable too, so it is just as unusable a
     * referrer as a real team name.
     *
     * @return array<int, string>
     */
    private function teamLabels(): array
    {
        $labels = ['No Team'];

        foreach (DB::table('agents')->select('id', 'team_name')->get() as $team) {
            $name = trim((string) $team->team_name);
            $labels[] = $name !== '' ? $name : 'Team ' . $team->id;
            // The heading fell back to "Team {id}" only when the name was blank,
            // but including both costs nothing and cannot produce a false match:
            // no agent is called "Team 7".
            $labels[] = 'Team ' . $team->id;
        }

        // Compared lowercased and trimmed, as everything else in this codebase
        // compares names.
        return array_values(array_unique($labels));
    }

    /** @return array<int, string> */
    private function needles(array $labels): array
    {
        return array_values(array_unique(array_map(
            fn ($l) => mb_strtolower(trim($l)),
            $labels
        )));
    }

    /** @param  Carbon|null  $from  null exports the whole history. */
    private function customers(array $labels, ?Carbon $from): iterable
    {
        $query = DB::table('customers')
            ->whereIn(DB::raw('LOWER(TRIM(referred_by))'), $this->needles($labels));

        if ($from !== null) {
            $query->where('created_at', '>=', $from->format('Y-m-d H:i:s'));
        }

        return $query
            ->orderBy('created_at')
            ->get([
                'id', 'account_no', 'first_name', 'middle_initial', 'last_name',
                'email_address', 'contact_number_primary', 'city', 'referred_by', 'created_at',
            ])
            ->map(fn ($r) => [
                $r->id, $r->account_no, $r->first_name, $r->middle_initial, $r->last_name,
                $r->email_address, $r->contact_number_primary, $r->city, $r->referred_by, $r->created_at,
            ]);
    }

    /** @param  Carbon|null  $from  null exports the whole history. */
    private function jobOrders(array $labels, ?Carbon $from, array $settlement): iterable
    {
        // The same "when did this become billable" expression the invoices use,
        // so the two cannot disagree about which week a job order falls in.
        $onboardedAt = AgentProgramme::onboardedAtSql('jo');

        $select = array_merge(
            [
                'jo.id as job_order_id', 'jo.application_id', 'jo.onsite_status', 'jo.billing_status',
                'jo.assigned_email', 'jo.timestamp', 'jo.date_installed',
                DB::raw("{$onboardedAt} as onboarded_at"),
                'a.first_name', 'a.last_name', 'a.referred_by',
            ],
            array_map(fn ($c) => 'jo.' . $c, $settlement)
        );

        $query = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(a.referred_by))'), $this->needles($labels));

        if ($from !== null) {
            $query->whereRaw("{$onboardedAt} >= ?", [$from->format('Y-m-d H:i:s')]);
        }

        return $query
            ->orderByRaw($onboardedAt)
            ->get($select)
            ->map(function ($r) use ($settlement) {
                $row = [
                    $r->job_order_id, $r->application_id, $r->onsite_status, $r->billing_status,
                    $r->assigned_email, $r->timestamp, $r->date_installed, $r->onboarded_at,
                    $r->first_name, $r->last_name, $r->referred_by,
                ];
                foreach ($settlement as $c) {
                    $row[] = $r->{$c} ?? null;
                }
                return $row;
            });
    }

    /**
     * @return array{path: string, rows: int}
     */
    private function writeCsv(string $path, array $header, iterable $rows): array
    {
        $handle = @fopen($path, 'w');
        if ($handle === false) {
            throw new \RuntimeException("Could not open {$path} for writing");
        }

        // A BOM, so Excel opens UTF-8 names correctly instead of mangling them.
        fwrite($handle, "\xEF\xBB\xBF");
        fputcsv($handle, $header);

        $count = 0;
        foreach ($rows as $row) {
            fputcsv($handle, array_map(fn ($v) => $v === null ? '' : (string) $v, $row));
            $count++;
        }

        fclose($handle);

        return ['path' => $path, 'rows' => $count];
    }
}
