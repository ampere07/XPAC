<?php

namespace App\Console\Commands;

use App\Support\AgentProgramme;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Export one team's customers and job orders, as two separate CSV files.
 *
 * The team name comes from the `agents` table and is the only filter: pass an
 * agent and the team they belong to is looked up, or name the team directly.
 *
 *     php artisan agents:export-team-data --agent=40
 *     php artisan agents:export-team-data --team=7
 *     php artisan agents:export-team-data --team-name="Team Alpha"
 *
 * Always writes exactly two files, never one combined:
 *
 *     team_customers.csv
 *     team_job_orders.csv
 *
 * Values are written exactly as the database holds them — no reformatting, so
 * the export can be compared against the tables it came from.
 *
 * On what "belongs to the team" means
 * ----------------------------------------------------------------------------
 * By default a record belongs to the team when its "Referred By" IS the team
 * name. That is the literal reading, and it is what finds the rows written while
 * the old dropdown allowed a team heading to be picked instead of an agent.
 *
 * Referrals naming the team's individual agents are a different question, and a
 * much larger set, so they are opt-in:
 *
 *     --include-members   also export rows referred by that team's agents
 *
 * job_orders carries no referred_by column of its own — the referral lives on
 * the application the job order was raised from — so that export joins through
 * applications, exactly as the invoice and commission code does.
 *
 * Reads only. Nothing is written to the database.
 */
class ExportTeamData extends Command
{
    protected $signature = 'agents:export-team-data
                            {--agent= : A user id; the team they belong to is exported}
                            {--team= : An agents.id, exported directly}
                            {--team-name= : A team name, exported directly}
                            {--include-members : Also include rows referred by the team\'s individual agents}
                            {--from= : Only rows from this date onwards (YYYY-MM-DD)}
                            {--out= : Directory for the two CSV files. Defaults to storage/app/exports}';

    protected $description = "Export a team's customers and job orders to two separate CSV files.";

    /** Columns wanted from each table, in order. Missing ones are skipped. */
    private const CUSTOMER_COLUMNS = [
        'id', 'account_no', 'first_name', 'middle_initial', 'last_name',
        'email_address', 'contact_number_primary', 'contact_number_secondary',
        'address', 'location', 'barangay', 'city', 'region', 'address_coordinates',
        'housing_status', 'desired_plan', 'referred_by', 'group_name',
        'created_by', 'updated_by', 'created_at', 'updated_at',
    ];

    /**
     * Taken from the application a job order references through application_id.
     *
     * job_orders holds no name of its own — the customer's name lives on the
     * application — so these are joined in and appended after the job order's
     * own columns. referred_by comes from there too, and is the value the team
     * filter matches on.
     */
    private const APPLICANT_COLUMNS = ['referred_by', 'first_name', 'middle_initial', 'last_name'];

    private const JOB_ORDER_COLUMNS = [
        'id', 'application_id', 'account_id', 'timestamp', 'date_installed',
        'onsite_status', 'status', 'billing_status', 'billing_day', 'installation_fee',
        'assigned_email', 'modem_router_sn', 'router_model', 'lcpnap', 'port', 'vlan',
        'username', 'ip_address', 'connection_type', 'usage_type',
        'onsite_remarks', 'status_remarks',
        'commission_status', 'commission_value', 'incentive_value', 'agent_paid_at', 'agent_paid_to',
        'created_by_user_email', 'updated_by_user_email', 'created_at', 'updated_at',
    ];

    public function handle(): int
    {
        $outDir = rtrim($this->option('out') ?: storage_path('app/exports'), '/\\');
        if (!is_dir($outDir) && !@mkdir($outDir, 0775, true) && !is_dir($outDir)) {
            $this->error("Could not create the output directory: {$outDir}");
            return self::FAILURE;
        }

        $customersPath = $outDir . '/team_customers.csv';
        $jobOrdersPath = $outDir . '/team_job_orders.csv';

        $from = null;
        if ($given = $this->option('from')) {
            try {
                $from = Carbon::parse($given)->startOfDay();
            } catch (Throwable $e) {
                $this->error("Could not read --from=\"{$given}\": " . $e->getMessage());
                return self::FAILURE;
            }
        }

        try {
            $team = $this->resolveTeam();
        } catch (Throwable $e) {
            $this->error($e->getMessage());
            return self::FAILURE;
        }

        $customerColumns = $this->presentColumns('customers', self::CUSTOMER_COLUMNS);
        $jobOrderColumns = $this->presentColumns('job_orders', self::JOB_ORDER_COLUMNS);

        // An agent with no team has nothing to export. Both files are still
        // written, with their headers and no rows, so a caller always gets the
        // two files it expects rather than having to handle a missing one — and
        // nothing unrelated is swept in by falling back to a broader filter.
        if ($team === null || trim((string) $team->team_name) === '') {
            $this->warn($team === null
                ? 'That agent belongs to no team, so there is nothing to export.'
                : "Team #{$team->id} has no team name recorded, so there is nothing to filter on.");

            $this->writeCsv($customersPath, $customerColumns, []);
            $this->writeCsv($jobOrdersPath, array_merge($jobOrderColumns, self::APPLICANT_COLUMNS), []);

            $this->newLine();
            $this->line(sprintf('  %-24s %d row(s)  (headers only)', 'team_customers.csv', 0));
            $this->line(sprintf('  %-24s %d row(s)  (headers only)', 'team_job_orders.csv', 0));
            $this->info('Written to ' . $outDir);

            return self::SUCCESS;
        }

        $teamName = trim((string) $team->team_name);
        $needles = [mb_strtolower($teamName)];

        $this->info("Team: \"{$teamName}\" (agents.id {$team->id})");

        if ($this->option('include-members')) {
            $members = $this->teamMemberNames((int) $team->id);
            foreach ($members as $name) {
                $needles[] = mb_strtolower($name);
            }
            $this->line('  including referrals by its ' . count($members) . ' agent(s): '
                . (implode(', ', $members) ?: 'none'));
        } else {
            $this->line('  matching referrals that name the team itself'
                . ' (add --include-members to also include its agents)');
        }

        if ($from) {
            $this->line('  from ' . $from->format('Y-m-d') . ' onwards');
        }

        $needles = array_values(array_unique(array_filter($needles, fn ($n) => $n !== '')));

        try {
            $customers = $this->writeCsv(
                $customersPath,
                $customerColumns,
                $this->customerRows($customerColumns, $needles, $from)
            );

            $jobOrders = $this->writeCsv(
                $jobOrdersPath,
                array_merge($jobOrderColumns, self::APPLICANT_COLUMNS),
                $this->jobOrderRows($jobOrderColumns, $needles, $from)
            );
        } catch (Throwable $e) {
            $this->error('Export failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        $this->newLine();
        $this->line(sprintf('  %-24s %d row(s)%s', 'team_customers.csv', $customers['rows'],
            $customers['rows'] === 0 ? '  (headers only)' : ''));
        $this->line(sprintf('  %-24s %d row(s)%s', 'team_job_orders.csv', $jobOrders['rows'],
            $jobOrders['rows'] === 0 ? '  (headers only)' : ''));
        $this->newLine();
        $this->info('Written to ' . $outDir);

        return self::SUCCESS;
    }

    /**
     * The team to export: from an agent's membership, or named directly.
     *
     * Returns null when an agent was given but belongs to no team — which is a
     * valid outcome, not an error.
     */
    private function resolveTeam(): ?object
    {
        $agentId    = $this->option('agent');
        $teamId     = $this->option('team');
        $teamNameIn = $this->option('team-name');

        $given = array_filter([$agentId, $teamId, $teamNameIn], fn ($v) => $v !== null && $v !== '');
        if (count($given) === 0) {
            throw new \RuntimeException('Give one of --agent, --team or --team-name.');
        }
        if (count($given) > 1) {
            throw new \RuntimeException('Give only one of --agent, --team or --team-name.');
        }

        if ($teamNameIn !== null && $teamNameIn !== '') {
            $team = DB::table('agents')
                ->whereRaw('LOWER(TRIM(team_name)) = ?', [mb_strtolower(trim($teamNameIn))])
                ->first(['id', 'team_name']);

            if (!$team) {
                throw new \RuntimeException("No team in the agents table is named \"{$teamNameIn}\".");
            }

            return $team;
        }

        if ($teamId !== null && $teamId !== '') {
            $team = DB::table('agents')->where('id', (int) $teamId)->first(['id', 'team_name']);

            if (!$team) {
                throw new \RuntimeException("No agents row with id {$teamId}.");
            }

            return $team;
        }

        $user = DB::table('users')->where('id', (int) $agentId)->first(['id', 'agent_id']);
        if (!$user) {
            throw new \RuntimeException("No user with id {$agentId}.");
        }

        if (empty($user->agent_id)) {
            return null;   // belongs to no team
        }

        return DB::table('agents')->where('id', $user->agent_id)->first(['id', 'team_name']);
    }

    /**
     * The full names of the agents in a team, as a referral would spell them.
     *
     * @return array<int, string>
     */
    private function teamMemberNames(int $teamId): array
    {
        return DB::table('users')
            ->where('agent_id', $teamId)
            ->get(['first_name', 'middle_initial', 'last_name'])
            ->map(fn ($u) => trim(preg_replace('/\s+/', ' ',
                trim((string) $u->first_name) . ' ' . trim((string) $u->middle_initial) . ' ' . trim((string) $u->last_name))))
            ->filter(fn ($n) => $n !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Which of the wanted columns this database actually has.
     *
     * Several are recent additions, so a server part-way through the migrations
     * gets a narrower export rather than a failure.
     *
     * @return array<int, string>
     */
    private function presentColumns(string $table, array $wanted): array
    {
        $present = array_values(array_filter($wanted, fn ($c) => Schema::hasColumn($table, $c)));

        $missing = array_diff($wanted, $present);
        if ($missing) {
            $this->warn("  note: {$table} has no " . implode(', ', $missing) . ' — omitted from the export.');
        }

        return $present;
    }

    private function customerRows(array $columns, array $needles, ?Carbon $from): iterable
    {
        $query = DB::table('customers')
            ->whereIn(DB::raw('LOWER(TRIM(referred_by))'), $needles);

        if ($from && Schema::hasColumn('customers', 'created_at')) {
            $query->where('created_at', '>=', $from->format('Y-m-d H:i:s'));
        }

        return $query->orderBy('id')->get($columns)
            ->map(fn ($r) => array_map(fn ($c) => $r->{$c} ?? null, $columns));
    }

    private function jobOrderRows(array $columns, array $needles, ?Carbon $from): iterable
    {
        $onboardedAt = AgentProgramme::onboardedAtSql('jo');

        $query = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(a.referred_by))'), $needles);

        if ($from) {
            $query->whereRaw("{$onboardedAt} >= ?", [$from->format('Y-m-d H:i:s')]);
        }

        $select = array_map(fn ($c) => 'jo.' . $c, $columns);
        foreach (self::APPLICANT_COLUMNS as $c) {
            $select[] = 'a.' . $c;
        }

        return $query->orderBy('jo.id')->get($select)
            ->map(function ($r) use ($columns) {
                $row = array_map(fn ($c) => $r->{$c} ?? null, $columns);
                foreach (self::APPLICANT_COLUMNS as $c) {
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

        // A BOM, so Excel reads UTF-8 names correctly instead of mangling them.
        fwrite($handle, "\xEF\xBB\xBF");
        fputcsv($handle, $header);

        $count = 0;
        foreach ($rows as $row) {
            // Written as stored: only NULL becomes an empty cell, everything else
            // goes out byte for byte.
            fputcsv($handle, array_map(fn ($v) => $v === null ? '' : (string) $v, $row));
            $count++;
        }

        fclose($handle);

        return ['path' => $path, 'rows' => $count];
    }
}
