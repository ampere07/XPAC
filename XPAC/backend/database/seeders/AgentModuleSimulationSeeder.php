<?php

namespace Database\Seeders;

use App\Models\AgentInvoice;
use App\Http\Controllers\CommissionController;
use App\Models\JobOrder;
use App\Models\User;
use App\Services\AgentIncentiveService;
use App\Services\AgentInvoicePdfService;
use App\Services\AgentInvoiceService;
use App\Services\JobOrderAgentPaymentService;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A complete, self-consistent agent module for a local database.
 *
 * The agent module cannot be understood from a static fixture. Commission is
 * settled when a job order is approved, incentives are awarded by a cron that
 * can only see progress accumulating across weeks, and invoices bill a calendar
 * week that has already ended and claim whatever the cron awarded inside it.
 * A dataset that just INSERTs rows into those three tables would be arithmetic
 * with no history behind it, and would not reproduce a single one of the
 * behaviours worth testing.
 *
 * So this seeder builds the estate and then RUNS THE REAL SERVICES over a
 * simulated seven-week timeline, travelling the clock with Carbon::setTestNow()
 * so each cron stamps the date it would actually have run on:
 *
 *     for each week 2026-07-20 .. 2026-09-06
 *         installs happen on weekdays, and each is approved the next day
 *         the incentive cron runs every morning
 *         the invoice cron runs on Monday, billing the week that just ended
 *
 * What comes out is a database whose agent_incentive_history, agent_invoices
 * and agent_invoice_customers were produced the way production produces them,
 * carrying real batch numbers, real carry-over, real claims and a real
 * one-week lag between earning an incentive and billing it.
 *
 *     php artisan db:seed --class=AgentModuleSimulationSeeder
 *
 * Destructive and idempotent: it clears the agent estate first, so running it
 * twice gives the same database rather than two overlapping ones. Intended for
 * a local simulation database only - it truncates users, applications and
 * job_orders.
 */
class AgentModuleSimulationSeeder extends Seeder
{
    /** The programme's first week (a Monday) and how many weeks to simulate. */
    private const FIRST_MONDAY = '2026-07-20';
    private const WEEKS = 7;

    /**
     * The roster.
     *
     * Rates mirror what production actually carries: commission 100, quota 10,
     * incentive 100, with one agent left on the older 1000 incentive so the
     * per-job-order rate snapshot has something to prove. `countable` is how
     * many of their referrals will finish successfully, which is what decides
     * how many quotas they complete - at a quota of 10, 28 countable referrals
     * is two paid batches with 8 carried into the next.
     */
    private const ROSTER = [
        // team,          first,     last,        commission, quota, incentive, countable, noise, spread
        ['Team Beth',   'Brigs',    'Ranay',        100.00, 10,  100.00, 28, 3],
        ['Team Beth',   'Edith',    'Naviza',       100.00, 10,  100.00, 14, 2],
        ['Team Beth',   'Lanie',    'Madamba',      100.00, 10,  100.00,  7, 2],
        ['Team Ed',     'Allan',    'Inosante',     150.00, 10,  100.00, 22, 3],
        ['Team Ed',     'Mabhe',    'Cortez',       100.00, 10, 1000.00, 11, 1],
        ['Team Mabhe',  'Ronnie',   'Salas',        100.00, 10,  100.00, 16, 2],
        ['Team Mabhe',  'Dexter',   'Yulo',         120.00, 10,  100.00,  9, 1],
        [null,          'Carmela',  'Tan',          100.00, 10,  100.00, 25, 3],
        [null,          'Jomar',    'Bautista',     100.00, 10,  100.00, 12, 2],
        [null,          'Rhea',     'Delgado',      120.00,  0,    0.00,  8, 1],  // not on the quota scheme
        [null,          'Nilo',     'Prado',        100.00, 10,  100.00,  0, 0],  // no referrals at all
        // High volume, concentrated into August, so the weekly (25) and monthly
        // (100) achievement tiers are actually reachable. Nobody on an even
        // spread of ~4 installs a week ever gets near either.
        [null,          'Beth',     'Villaflor',    100.00, 10,  100.00, 128, 4, 'burst'],
    ];

    /** Surnames and given names for the referred customers. */
    private const GIVEN = ['Mario','Luisa','Ferdinand','Grace','Rolando','Melody','Arnel','Divina',
        'Ernesto','Cristina','Joel','Marissa','Danilo','Vilma','Reynaldo','Josefina','Bong','Aileen',
        'Rodel','Charmaine','Noel','Editha','Ariel','Loida','Wilfredo','Jocelyn','Marlon','Perlita'];
    private const FAMILY = ['Dela Cruz','Santos','Reyes','Bautista','Ocampo','Villanueva','Ramos',
        'Mendoza','Aquino','Castillo','Flores','Torres','Gonzales','Rivera','Domingo','Navarro'];

    private array $summary = [];

    /**
     * What each job order becomes, and when.
     *
     * Job orders are seeded OPEN and are closed by the timeline on the day they
     * were installed. Seeding them already finished would put every referral in
     * front of the very first cron run, which would award every quota in the
     * programme on day one - the incentive cron has no upper date bound, so a
     * job order dated three weeks out still counts the moment it reads Done.
     *
     * @var array<int, array{date: Carbon, onsite: string, pre: ?string}>
     */
    private array $plan = [];

    public function run(): void
    {
        // Deterministic: the same command produces the same database.
        mt_srand(20260904);

        $this->command->info('Clearing the agent estate...');
        $this->clear();

        $this->command->info('Seeding reference data...');
        $this->seedReference();

        $this->command->info('Seeding teams and agents...');
        $agents = $this->seedAgents();

        $this->command->info('Seeding referrals and job orders...');
        $this->seedReferrals($agents);

        $this->command->info('Running the seven-week timeline (approvals, incentive cron, invoice cron)...');
        $this->runTimeline();

        $this->report();
    }

    // =====================================================================

    private function clear(): void
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        foreach ([
            'agent_invoice_customers', 'agent_invoices', 'agent_incentive_history',
            'agent_commission_history', 'agent_bonus_history', 'agent_achievement_claims',
            'agent_achievement_periods', 'agent_balance', 'job_orders', 'applications',
            'users', 'agents',
        ] as $table) {
            if (DB::getSchemaBuilder()->hasTable($table)) {
                DB::table($table)->truncate();
            }
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
    }

    private function seedReference(): void
    {
        // The eight locked roles, so role_id 4 means Agent exactly as it does live.
        (new RolesSeeder())->run();

        // The fallback commission rate, used when an agent's own rate is zero.
        if (DB::table('billing_config')->count() === 0) {
            DB::table('billing_config')->insert([
                'agent_commission' => 100.00,
                'updated_by'       => 'AgentModuleSimulationSeeder',
                'created_at'       => now(),
                'updated_at'       => now(),
            ]);
        }
    }

    /** @return array<int, array> the roster, with ids filled in */
    private function seedAgents(): array
    {
        $teamIds = [];
        foreach (['Team Beth', 'Team Ed', 'Team Mabhe'] as $name) {
            $teamIds[$name] = DB::table('agents')->insertGetId([
                'team_name'  => $name,
                'created_by' => 'AgentModuleSimulationSeeder',
                'created_at' => Carbon::parse(self::FIRST_MONDAY)->subMonth(),
            ]);
        }

        $agents = [];

        foreach (self::ROSTER as $entry) {
            [$team, $first, $last, $commission, $quota, $incentive, $countable, $noise] = $entry;
            $spread = $entry[8] ?? 'even';
            $teamId   = $team ? $teamIds[$team] : null;
            $username = strtolower($first . '.' . $last);

            $userId = DB::table('users')->insertGetId([
                'first_name'    => $first,
                'last_name'     => $last,
                'username'      => $username,
                'email_address' => $username . '@atssfiber.ph',
                'password_hash' => bcrypt('password1234'),
                'contact_number'=> '09' . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT),
                'role_id'       => 4,
                'agent_id'      => $teamId,
                'active'        => 1,
                'created_at'    => Carbon::parse(self::FIRST_MONDAY)->subMonth(),
                'updated_at'    => Carbon::parse(self::FIRST_MONDAY)->subMonth(),
            ]);

            // Holding this row is what makes them an agent to every part of the
            // module - the incentive cron, the invoice run and the payout screens
            // all define an agent as "has a row here".
            DB::table('agent_balance')->insert([
                'agent_id'         => $userId,
                'balance'          => 0.00,
                'commission'       => $commission,
                'commission_value' => 0.00,
                'incentives'       => 0.00,
                'incentives_value' => $incentive,
                'quota'            => $quota,
                'created_at'       => Carbon::parse(self::FIRST_MONDAY)->subMonth(),
                'updated_at'       => Carbon::parse(self::FIRST_MONDAY)->subMonth(),
            ]);

            $agents[] = [
                'user_id'   => $userId,
                'team'      => $team,
                'team_id'   => $teamId,
                'name'      => $first . ' ' . $last,
                'countable' => $countable,
                'spread'    => $spread,
                'noise'     => $noise,
                'quota'     => $quota,
            ];
        }

        return $agents;
    }

    /**
     * Referrals, written the way production writes them.
     *
     * Roughly seven in ten carry the agent's user id, which is what the modern
     * "Referred By" picker stores; the rest are the free text that predates it -
     * the agent's own name, which the tolerant matcher still resolves, and team
     * names and walk-ins, which belong to no individual agent and are therefore
     * never billed. Production carries all of these today.
     */
    private function seedReferrals(array $agents): void
    {
        $weeks = $this->weeks();
        $applications = [];

        foreach ($agents as $agent) {
            $total = $agent['countable'] + $agent['noise'];

            for ($i = 0; $i < $total; $i++) {
                $isCountable = $i < $agent['countable'];

                // An even spread puts work in every billing week. A burst
                // concentrates it into the middle four (all of August), which is
                // what makes 25-in-a-week and 100-in-a-month achievable.
                $week = $agent['spread'] === 'burst'
                    ? $weeks[2 + min(3, intdiv($i, 32))]
                    : $weeks[$i % count($weeks)];
                $install = $week->copy()->addDays(mt_rand(0, 4));   // Mon-Fri

                $referredBy = $this->referralValue($agent, $i);

                [$onsite, $preInstalled] = $isCountable
                    ? $this->countableStatus($i)
                    : $this->noiseStatus($i);

                $applications[] = [
                    'first_name'           => self::GIVEN[mt_rand(0, count(self::GIVEN) - 1)],
                    'last_name'            => self::FAMILY[mt_rand(0, count(self::FAMILY) - 1)],
                    'middle_initial'       => chr(mt_rand(65, 90)),
                    'mobile_number'        => '09' . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT),
                    'installation_address' => mt_rand(1, 400) . ' Purok ' . mt_rand(1, 7) . ', Bacolod City',
                    'desired_plan'         => ['FIBER 1500', 'FIBER 2000', 'FIBER 999'][mt_rand(0, 2)],
                    'referred_by'          => $referredBy,
                    'status'               => 'Approved',
                    'timestamp'            => $install->copy()->subDays(mt_rand(3, 10)),
                    'created_at'           => $install->copy()->subDays(mt_rand(3, 10)),
                    'updated_at'           => $install,
                    '_install'             => $install,
                    '_onsite'              => $onsite,
                    '_pre'                 => $preInstalled,
                ];
            }
        }

        // A handful of referrals that belong to nobody, which every real week has.
        foreach (['Walk in', 'NONE', 'N/A', 'Facebook', 'friend'] as $k => $value) {
            $week    = $weeks[$k % count($weeks)];
            $install = $week->copy()->addDays(mt_rand(0, 4));
            $applications[] = [
                'first_name'           => self::GIVEN[mt_rand(0, count(self::GIVEN) - 1)],
                'last_name'            => self::FAMILY[mt_rand(0, count(self::FAMILY) - 1)],
                'middle_initial'       => chr(mt_rand(65, 90)),
                'mobile_number'        => '09' . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT),
                'installation_address' => mt_rand(1, 400) . ' Purok ' . mt_rand(1, 7) . ', Bacolod City',
                'desired_plan'         => 'FIBER 1500',
                'referred_by'          => $value,
                'status'               => 'Approved',
                'timestamp'            => $install->copy()->subDays(5),
                'created_at'           => $install->copy()->subDays(5),
                'updated_at'           => $install,
                '_install'             => $install,
                '_onsite'              => 'Done',
                '_pre'                 => null,
            ];
        }

        foreach ($applications as $row) {
            $install = $row['_install'];
            $onsite  = $row['_onsite'];
            $pre     = $row['_pre'];
            unset($row['_install'], $row['_onsite'], $row['_pre']);

            $appId = DB::table('applications')->insertGetId($row);

            // Seeded OPEN. The timeline closes it on its scheduled day.
            $jobOrderId = DB::table('job_orders')->insertGetId([
                'application_id'   => $appId,
                'onsite_status'    => 'In Progress',
                'timestamp'        => $install,
                'installation_fee' => 500.00,
                'status'           => 'Pending',
                'created_at'       => $install->copy()->subDays(2),
                'updated_at'       => $install->copy()->subDays(2),
            ]);

            $this->plan[$jobOrderId] = [
                'date'   => $install->copy()->startOfDay(),
                'onsite' => $onsite,
                'pre'    => $pre,
            ];
        }
    }

    /**
     * Close every job order scheduled for this day.
     *
     * The pre-installation marker is written the day before, which is what lets
     * a referral earn quota progress before the install itself is finished - the
     * one case where the incentive cron counts a job order the invoice run will
     * not bill.
     */
    private function advanceJobOrders(Carbon $day): void
    {
        foreach ($this->plan as $jobOrderId => $step) {
            if ($step['pre'] !== null && $step['date']->copy()->subDay()->isSameDay($day)) {
                DB::table('job_orders')->where('id', $jobOrderId)->update([
                    'pre_installed'          => $step['pre'],
                    'pre_installed_datetime' => $day->copy()->setTime(14, 0),
                    'preinstalled_updated_by'=> 'AgentModuleSimulationSeeder',
                    'updated_at'             => $day,
                ]);
            }

            if (!$step['date']->isSameDay($day)) {
                continue;
            }

            $finished  = in_array(strtolower($step['onsite']), ['done', 'completed'], true);

            DB::table('job_orders')->where('id', $jobOrderId)->update([
                'onsite_status'  => $step['onsite'],
                'date_installed' => $finished ? $step['date'] : null,
                'status'         => $finished ? 'Done' : 'Pending',
                'updated_at'     => $day,
            ]);
        }
    }

    /** How this particular referral was written down. */
    private function referralValue(array $agent, int $i): string
    {
        // 7 in 10 by id (the picker), 2 in 10 by the agent's own name (legacy
        // free text the matcher still resolves), 1 in 10 by team name (which
        // resolves to nobody, and is exactly why production has hundreds of
        // "Team Beth" referrals earning no individual agent anything).
        $r = $i % 10;

        if ($r <= 6) {
            return (string) $agent['user_id'];
        }

        if ($r <= 8) {
            return $agent['name'];
        }

        return $agent['team'] ?? $agent['name'];
    }

    /** A status that counts toward a quota. */
    private function countableStatus(int $i): array
    {
        // Mostly closed installs, with one in eight counting early on the
        // pre-installation marker instead.
        if ($i % 8 === 7) {
            return ['Pending', 'preinstalled'];
        }

        return [$i % 3 === 0 ? 'Completed' : 'Done', null];
    }

    /** A status that must earn nothing. */
    private function noiseStatus(int $i): array
    {
        return [
            ['Failed', 'Cancelled', 'Pending', 'In Progress'][$i % 4],
            // A site prepared and then abandoned - the case that must not pay.
            $i % 4 === 0 ? 'preinstalled' : null,
        ];
    }

    /** @return Carbon[] the Monday opening each simulated week */
    private function weeks(): array
    {
        $weeks = [];
        for ($w = 0; $w < self::WEEKS; $w++) {
            $weeks[] = Carbon::parse(self::FIRST_MONDAY)->addWeeks($w)->startOfDay();
        }

        return $weeks;
    }

    // =====================================================================

    /**
     * Walk the clock through the programme, running what the crons would run.
     *
     * The order inside each week is what produces the module's real timing: a
     * job order is approved the day after it is installed, the incentive cron
     * runs every morning, and Monday's invoice run bills the week that has just
     * finished. An incentive awarded on a Monday therefore sits in the week that
     * is only just beginning, and is billed by the FOLLOWING Monday - the
     * one-week lag is a property of the design, not of this seeder.
     */
    private function runTimeline(): void
    {
        // The real PDF service uploads to Google Drive. A seeder must not.
        app()->bind(AgentInvoicePdfService::class, fn () => new class extends AgentInvoicePdfService {
            public function render(AgentInvoice $invoice, bool $force = false): string
            {
                return 'https://sim.local/agent-invoices/' . $invoice->invoice_number . '.pdf';
            }
        });

        $payments = new JobOrderAgentPaymentService();
        $invoices = (new AgentInvoiceService())->setVerbose(false, false);

        $start = Carbon::parse(self::FIRST_MONDAY);
        // Two weeks past the last install week: an incentive awarded in the final
        // week is only billed by the Monday AFTER it, so the run has to reach that far.
        $end   = $start->copy()->addWeeks(self::WEEKS + 1);

        for ($day = $start->copy(); $day->lte($end); $day->addDay()) {
            // 02:00 - the incentive cron, before anybody is awake.
            Carbon::setTestNow($day->copy()->setTime(2, 0));
            $incentive = (new AgentIncentiveService())->process();

            if ($incentive['agents_awarded'] > 0) {
                $this->summary[] = sprintf(
                    '  %s  incentive cron: %d quota(s) worth %s to %d agent(s)',
                    $day->toDateString(),
                    $incentive['incentive_awards'],
                    number_format($incentive['amount_awarded'], 2),
                    $incentive['agents_awarded']
                );
            }

            // 03:00 Monday - bill the week that has just ended.
            if ($day->dayOfWeek === Carbon::MONDAY && $day->gt($start)) {
                Carbon::setTestNow($day->copy()->setTime(3, 0));
                $run = $invoices->generateForWeek($day->copy());

                $this->summary[] = sprintf(
                    '  %s  INVOICE RUN %s..%s - %d issued, %d customers, %s',
                    $day->toDateString(),
                    $run['period_start'],
                    $run['period_end'],
                    $run['invoices_created'],
                    $run['customers_billed'],
                    number_format($run['amount_invoiced'], 2)
                );
            }

            // 07:00 - today's installs close; tomorrow's sites are pre-installed.
            Carbon::setTestNow($day->copy()->setTime(7, 0));
            $this->advanceJobOrders($day);

            // 16:00 - yesterday's installs are approved, settling commission
            // with the referring agent at the rate in force on the day.
            Carbon::setTestNow($day->copy()->setTime(16, 0));
            $yesterday = $day->copy()->subDay()->toDateString();
            $due = JobOrder::whereNull('agent_paid_at')
                ->whereDate('date_installed', $yesterday)
                ->whereIn(DB::raw('LOWER(TRIM(onsite_status))'), ['done', 'completed'])
                ->get();

            foreach ($due as $jobOrder) {
                DB::transaction(fn () => $payments->settle($jobOrder, 'AgentModuleSimulationSeeder'));
            }

            // 18:00 - agents check their dashboard and claim any achievement
            // they have become entitled to. Unlike commission and incentives,
            // an achievement is never awarded by a cron: it is a button the
            // agent presses, and it pays into a different column again.
            Carbon::setTestNow($day->copy()->setTime(18, 0));
            $this->claimAchievements($day);

            // 23:30 - record any weekly or monthly cycle that ended today, so
            // there is evidence the count stopped rather than carried over.
            if ($day->dayOfWeek === Carbon::SUNDAY || $day->copy()->addDay()->day === 1) {
                Carbon::setTestNow($day->copy()->setTime(23, 30));
                Artisan::call('cron:close-achievement-periods');
            }
        }

        Carbon::setTestNow();   // never leave the clock moved
    }

    /**
     * Every agent tries to claim every achievement tier they qualify for.
     *
     * This is the third and last way an agent earns, and it behaves unlike the
     * other two. Commission is settled by the approval, and the incentive is
     * awarded by a cron; an achievement is CLAIMED — the agent presses a button,
     * the entitlement is re-checked server side, and the reward is credited
     * straight to `agent_balance.balance` (spendable) and mirrored into
     * `agent_balance.achievement` (a lifetime tally). It never reaches an
     * invoice, which is what separates it from the incentive.
     *
     * A tier is claimable once per period, so most of these calls are refused
     * with 422 and only the entitled ones land.
     */
    private function claimAchievements(Carbon $day): void
    {
        $controller = new CommissionController();

        foreach (DB::table('agent_balance')->pluck('agent_id') as $agentId) {
            $agent = User::find($agentId);
            if (!$agent) {
                continue;
            }

            auth()->setUser($agent);

            foreach (array_keys(CommissionController::achievementTiers()) as $tier) {
                try {
                    $response = $controller->storeAchievement(new Request(['type' => $tier]));
                } catch (Throwable $e) {
                    continue;   // an unmet tier throws a validation response, not a fault
                }

                if ($response->getStatusCode() !== 200 && $response->getStatusCode() !== 201) {
                    continue;   // "not reached yet" or "already claimed this period"
                }

                $body = json_decode($response->getContent(), true);
                $amount = $body['data']['amount'] ?? ($body['amount'] ?? 0);

                $this->summary[] = sprintf(
                    '  %s  ACHIEVEMENT claimed: %s %s by %s %s',
                    $day->toDateString(),
                    $tier,
                    number_format((float) $amount, 2),
                    $agent->first_name,
                    $agent->last_name
                );
            }
        }

        auth()->forgetUser();
    }

    // =====================================================================

    private function report(): void
    {
        $this->command->newLine();
        $this->command->line('<fg=cyan>Timeline</>');
        foreach ($this->summary as $line) {
            $this->command->line($line);
        }

        $this->command->newLine();
        $this->command->line('<fg=cyan>Estate</>');
        $rows = DB::table('agent_balance as ab')
            ->join('users as u', 'u.id', '=', 'ab.agent_id')
            ->leftJoin('agents as a', 'a.id', '=', 'u.agent_id')
            ->orderBy('u.id')
            ->get([
                'u.id', 'u.first_name', 'u.last_name', 'a.team_name',
                'ab.quota', 'ab.commission', 'ab.incentives_value',
                'ab.commission_value', 'ab.incentives',
            ]);

        $table = [];
        foreach ($rows as $r) {
            $earned  = (float) DB::table('agent_incentive_history')->where('agent_id', $r->id)->sum('incentive_value');
            $billed  = (float) DB::table('agent_incentive_history')->where('agent_id', $r->id)->whereNotNull('agent_invoice_id')->sum('incentive_value');
            $batches = DB::table('agent_incentive_history')->where('agent_id', $r->id)->distinct()->count('batch_number');

            $table[] = [
                $r->id,
                trim($r->first_name . ' ' . $r->last_name),
                $r->team_name ?: 'solo',
                (int) $r->quota,
                number_format((float) $r->commission, 2),
                number_format((float) $r->commission_value, 2),
                $batches,
                number_format($earned, 2),
                number_format($billed, 2),
            ];
        }

        $this->command->table(
            ['id', 'agent', 'owner', 'quota', 'rate', 'commission earned', 'batches', 'incentive earned', 'billed'],
            $table
        );

        $this->command->line('<fg=cyan>Totals</>');
        foreach ([
            'agents'                  => DB::table('agent_balance')->count(),
            'applications'            => DB::table('applications')->count(),
            'job orders'              => DB::table('job_orders')->count(),
            'job orders settled'      => DB::table('job_orders')->whereNotNull('agent_paid_at')->count(),
            'incentive history rows'  => DB::table('agent_incentive_history')->count(),
            'completed quotas'        => DB::table('agent_incentive_history')->where('incentive_value', '>', 0)->count(),
            'invoices'                => DB::table('agent_invoices')->count(),
            'invoice customer lines'  => DB::table('agent_invoice_customers')->count(),
        ] as $label => $value) {
            $this->command->line(sprintf('  %-24s %s', $label, $value));
        }

        $unbilled = DB::table('agent_incentive_history')
            ->whereNull('agent_invoice_id')->where('incentive_value', '>', 0)
            ->selectRaw('COUNT(*) c, COALESCE(SUM(incentive_value),0) amt')->first();

        $this->command->line(sprintf(
            '  %-24s %d worth %s',
            'unbilled quotas',
            (int) $unbilled->c,
            number_format((float) $unbilled->amt, 2)
        ));
    }
}
