<?php

namespace App\Services;

use App\Exceptions\IncentiveAlreadyBilled;
use App\Support\CronLog;
use App\Models\AgentInvoice;
use App\Models\AgentInvoiceCustomer;
use App\Models\User;
use App\Support\AgentProgramme;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * AgentInvoiceService
 * ---------------------------------------------------------------------------
 * Builds the weekly referral invoice for every team and solo agent.
 *
 * An "owner" is whoever the invoice is addressed to: a team, or an agent who
 * belongs to no team. Agents are grouped by their `agent_id`, which is the team
 * they belong to on the `agents` table — an agent with none is billed alone.
 * A team therefore gets ONE invoice covering every agent in it, never one
 * invoice per member.
 *
 * A referral is billable when it was installed inside the billing week, on or
 * after the agent programme start date, and has not already been billed to this
 * owner. That last check is the important one, and it is enforced twice:
 *
 *   1. Customers already on an invoice for this owner are excluded up front.
 *   2. A unique key on (owner_key, application_id) refuses the write anyway.
 *
 * The second is what makes a repeated run safe. Two runs racing, a retry after
 * a timeout, or somebody running the command by hand on a Monday morning all
 * end the same way: one invoice, one row per customer.
 *
 * WHAT AN INVOICE IS MADE OF
 * ---------------------------------------------------------------------------
 * Two separate figures, worked out two different ways:
 *
 *   COMMISSION is per referral, summed across the customers on the invoice at
 *   the rate on each referring agent's own record. This invoice's own customers
 *   are what it is built from, so it is calculated here.
 *
 *   TOTAL AMOUNT is the incentive, and it is NOT calculated here. It is read
 *   from `agent_incentive_history` — the ledger the incentive cron writes when
 *   an agent completes a quota — taking only the quotas the cron awarded inside
 *   this invoice's billing week. An invoice for 10–16 August bills exactly what
 *   the cron awarded between the 10th at 00:00:00 and the 16th at 23:59:59, no
 *   matter how many times the cron ran in that week, and nothing from outside
 *   those bounds.
 *
 * The cron owns the question of whether a quota was completed, because only it
 * can see progress accumulating across weeks; a single invoice period cannot.
 * Each completed quota is then billed exactly once: claiming it stamps the
 * invoice's id onto its ledger rows, and the claim only lands on rows still
 * unstamped — so a quota already billed cannot be billed again, and two runs
 * overlapping cannot both take the same one. See incentivesForPeriod() and
 * claimIncentives().
 *
 * Everything for one owner is written inside a transaction, so a failure part
 * way through leaves no invoice rather than an invoice missing its customers —
 * and the incentive claim is inside it too, so an invoice can never be issued
 * carrying an incentive it did not successfully claim.
 * One owner failing never stops the rest of the run.
 */
class AgentInvoiceService
{
    private string $logName = 'Agent_Invoices';

    /**
     * Emit extra-detailed [VERBOSE] lines.
     *
     * On by default, matching AutoDisconnectService: a weekly run that bills real
     * money is worth being able to read afterwards line by line, and the volume
     * is one file per week rather than one per customer.
     */
    private bool $verbose = true;

    /** Mirror every log line to stdout when running from the CLI. */
    private bool $cliEcho = true;

    /** Whether this process is running under the CLI SAPI. */
    private bool $isCli;

    /**
     * What set this run going, printed in the log's configuration block.
     *
     * A weekly invoice run that produced an unexpected result is the sort of
     * thing somebody asks about days later, and "was this the Monday cron or did
     * someone press Generate?" is the first question. Defaults to naming the
     * scheduler, since that is what runs unattended.
     */
    private ?string $triggeredBy = null;

    public function __construct()
    {
        $this->isCli = PHP_SAPI === 'cli';
    }

    /** Name what set this run going, e.g. "Generate button — jane@example.com (user #4)". */
    public function setTriggeredBy(?string $label): self
    {
        $this->triggeredBy = $label;

        return $this;
    }

    /**
     * Toggle verbose file logging and CLI echo at runtime.
     *
     * Same signature as AutoDisconnectService::setVerbose(), so the two run the
     * same way from a command.
     */
    public function setVerbose(bool $verbose = true, bool $cliEcho = true): self
    {
        $this->verbose = $verbose;
        $this->cliEcho = $cliEcho;

        return $this;
    }

    /**
     * The seven days a run bills: the last calendar week that has fully ended,
     * always Monday 00:00:00 to Sunday 23:59:59.
     *
     * A run on Monday 17 August bills 10 August 00:00:00 to 16 August 23:59:59.
     * The week the run sits in is never billed — it has not finished yet, and its
     * work belongs to the following week's invoice.
     *
     * Calendar-aligned rather than rolling, so the window is the same Monday to
     * Sunday no matter which day the run happens on: a catch-up run on Wednesday
     * 19 August still bills the 10th to the 16th, exactly as the Monday run it is
     * standing in for would have. A late run therefore corrects itself instead of
     * dragging the boundary forward, and consecutive weeks abut exactly — no day
     * is billed twice and none is skipped.
     *
     * Monday is named explicitly rather than left to Carbon's locale default, so
     * the boundary cannot move with a locale change.
     *
     * Dates come from Carbon, which Laravel has already set to the app timezone
     * (config/app.php — Asia/Manila), so the boundaries are local midnights
     * regardless of what the server's own clock is set to.
     *
     * @param  Carbon|null  $asOf  treat this as the generation date; defaults to now
     * @return array{0: Carbon, 1: Carbon}  [periodStart, periodEnd]
     */
    public function periodFor(?Carbon $asOf = null): array
    {
        $generatedOn = ($asOf ? $asOf->copy() : Carbon::now())->startOfDay();

        // The Monday that opens the week the run sits in; the billed week is the
        // one before it.
        $thisWeekMonday = $generatedOn->copy()->startOfWeek(Carbon::MONDAY);

        return [
            $thisWeekMonday->copy()->subWeek()->startOfDay(),
            $thisWeekMonday->copy()->subDay()->endOfDay(),
        ];
    }

    /**
     * Generate invoices for one billing week.
     *
     * @param  Carbon|null  $asOf  treat this as the generation date, billing the
     *                             seven days before it; defaults to now.
     * @return array  summary counters for the run
     */
    public function generateForWeek(?Carbon $asOf = null, ?int $onlyOwnerAgentId = null): array
    {
        // One derivation, shared with the command's dry run, so what a dry run
        // reports can never differ from what a real run bills.
        [$periodStart, $periodEnd] = $this->periodFor($asOf);

        $startTime = Carbon::now();

        $summary = [
            'period_start'      => $periodStart->format('Y-m-d'),
            'period_end'        => $periodEnd->format('Y-m-d'),
            'owners_evaluated'  => 0,
            'invoices_created'  => 0,
            'invoices_skipped'  => 0,   // already invoiced for this week
            'owners_no_work'    => 0,   // nothing billable
            'customers_billed'  => 0,
            'customers_skipped' => 0,   // already billed to this owner
            'amount_invoiced'   => 0.0,
            'pdfs_written'      => 0,
            'pdf_failures'      => 0,
            'errors'            => 0,
        ];

        // Collected as they happen and reprinted at the end, so a long run does
        // not have to be scrolled through to find out what went wrong.
        $errors = [];

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         STARTING AGENT INVOICE GENERATION                      ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        $programmeStart = AgentProgramme::startDate();

        $this->writeLog("[CONFIG] Triggered By: " . ($this->triggeredBy ?? ($this->isCli ? 'scheduler (cron)' : 'web request')));
        $this->writeLog("[CONFIG] Billing Week: {$summary['period_start']} to {$summary['period_end']}");
        // Not a configured figure any more: the unit price on each line is the
        // referring agent's own agent_balance.commission, so there is no single
        // rate to state here before the owners are known.
        $this->writeLog("[CONFIG] Unit Price: per agent (agent_balance.commission)");
        $this->writeLog("[CONFIG] Installation Fee: ₱" . number_format((float) config('agent_invoices.installation_fee', 0), 2));
        $this->writeLog("[CONFIG] Agent Programme Start: " . ($programmeStart ? $programmeStart->format('Y-m-d') : 'not set'));
        if ($onlyOwnerAgentId !== null) {
            $this->writeLog("[CONFIG] Restricted to agent user id: {$onlyOwnerAgentId}");
        }
        $this->writeLog("");

        $this->writeLog("[QUERY] Resolving teams and solo agents...");

        try {
            $owners = $this->resolveOwners($onlyOwnerAgentId);
        } catch (Throwable $e) {
            $summary['errors']++;
            $this->writeLog('[ERROR] Could not list agents: ' . $e->getMessage());
            Log::channel('single')->error('[AGENT INVOICES] Could not list agents: ' . $e->getMessage());

            $this->writeRunFooter($summary, $startTime, ['Could not list agents: ' . $e->getMessage()]);

            return $summary;
        }

        $totalCount = count($owners);
        $summary['owners_evaluated'] = $totalCount;

        $this->writeLog("[RESULT] Found {$totalCount} owner(s) to evaluate — a team counts as one");
        $this->writeLog("");

        if ($totalCount === 0) {
            $this->writeLog("[INFO] No teams or solo agents to bill.");
            $this->writeLog("[INFO] An agent is an account holding a row in agent_balance.");
            $this->writeRunFooter($summary, $startTime, $errors, 'No Actions');

            return $summary;
        }

        $this->writeLog("[PROCESS] Starting invoice generation...");
        $this->writeLog("─────────────────────────────────────────────────────────────────");

        $counter = 0;

        foreach ($owners as $owner) {
            $counter++;
            $this->writeLog("");
            $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");

            try {
                $this->generateForOwner($owner, $periodStart, $periodEnd, $summary, $counter, $totalCount);
            } catch (Throwable $e) {
                // One owner's failure must never stop the rest of the run.
                $summary['errors']++;
                $errors[] = "{$owner['owner_key']}: " . $e->getMessage();
                $this->writeLog("[{$counter}/{$totalCount}] ✗ ERROR (isolated, continuing): " . $e->getMessage());
                Log::channel('single')->error("[AGENT INVOICES] {$owner['owner_key']}: " . $e->getMessage(), [
                    'trace' => $e->getTraceAsString(),
                ]);
            }
        }

        $this->writeRunFooter($summary, $startTime, $errors);

        return $summary;
    }

    /**
     * The closing banner, summary counters and error roll-up.
     *
     * Shared by the three ways a run can end — normally, with nothing to do, or
     * having failed to list the agents at all — so all three close the log the
     * same way and a reader always finds a summary at the bottom.
     *
     * @param  string[]  $errors
     */
    private function writeRunFooter(array $summary, Carbon $startTime, array $errors, string $note = ''): void
    {
        $endTime  = Carbon::now();
        $duration = $endTime->diffInSeconds($startTime);
        $title    = $note !== ''
            ? "AGENT INVOICE GENERATION COMPLETE ({$note})"
            : 'AGENT INVOICE GENERATION COMPLETE';

        $this->writeLog("");
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         " . str_pad($title, 55) . "║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $this->writeLog("Summary:");
        $this->writeLog("  • Billing Week: {$summary['period_start']} to {$summary['period_end']}");
        $this->writeLog("  • Owners Evaluated: {$summary['owners_evaluated']}");
        $this->writeLog("  • Invoices Created: {$summary['invoices_created']}");
        $this->writeLog("  • Already Invoiced: {$summary['invoices_skipped']}");
        $this->writeLog("  • Nothing To Bill: {$summary['owners_no_work']}");
        $this->writeLog("  • Customers Billed: {$summary['customers_billed']}");
        $this->writeLog("  • Customers Already Billed: {$summary['customers_skipped']}");
        $this->writeLog("  • Amount Invoiced: ₱" . number_format($summary['amount_invoiced'], 2));
        $this->writeLog("  • PDFs Written: {$summary['pdfs_written']}");
        $this->writeLog("  • PDF Failures: {$summary['pdf_failures']}");
        $this->writeLog("  • Errors: " . count($errors));
        $this->writeLog("  • Duration: {$duration} second(s)");
        $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        if (!empty($errors)) {
            $this->writeLog("[ERROR DETAILS]");
            foreach ($errors as $error) {
                $this->writeLog("  × {$error}");
            }
            $this->writeLog("");
        }

        $this->writeLog("");
    }

    /**
     * Everyone an invoice can be addressed to.
     *
     * Teams first — every agent holding the same `agent_id` is one owner — then
     * each agent with no team as an owner of their own.
     *
     * @return array<int, array{owner_key: string, type: string, team_id: ?int,
     *                          team_name: ?string, agent_id: ?int,
     *                          agent_name: ?string, members: array, organization_id: ?int}>
     */
    public function resolveOwners(?int $onlyAgentId = null): array
    {
        $query = DB::table('users as u')
            ->leftJoin('agent_balance as ab', 'ab.agent_id', '=', 'u.id')
            ->leftJoin('agents as a', 'a.id', '=', 'u.agent_id')
            // An agent is someone who holds an agent balance — the same
            // definition the incentive and achievement crons use, so the three
            // never disagree about who is an agent.
            ->whereNotNull('ab.agent_id')
            ->select(
                'u.id as user_id',
                'u.first_name',
                'u.middle_initial',
                'u.last_name',
                'u.email_address',
                'u.agent_id as team_id',
                'u.organization_id',
                'a.team_name',
                'ab.quota',
                'ab.commission'
            );

        if ($onlyAgentId !== null) {
            $query->where('u.id', $onlyAgentId);
        }

        $rows = $query->orderBy('u.id')->get();

        $owners = [];

        foreach ($rows as $row) {
            $member = [
                'user_id'         => (int) $row->user_id,
                'name'            => $this->fullName($row),
                'email'           => trim((string) ($row->email_address ?? '')),
                // Referrals needed to earn the incentive once. Zero means the
                // agent is not on the quota scheme and bills no incentive.
                'quota'           => (int) ($row->quota ?? 0),
                // The agent's own commission rate, read the same way the payout
                // screens read it. Each referral on the invoice earns this, so a
                // team whose members are on different rates still bills each
                // customer at the rate of whoever brought them in.
                'commission_rate' => (float) ($row->commission ?? 0),
                'organization_id' => $row->organization_id !== null ? (int) $row->organization_id : null,
            ];

            $teamId = $row->team_id !== null && $row->team_id !== '' ? (int) $row->team_id : null;

            if ($teamId !== null) {
                $key = AgentInvoice::ownerKeyForTeam($teamId);

                if (!isset($owners[$key])) {
                    $owners[$key] = [
                        'owner_key'       => $key,
                        'type'            => AgentInvoice::TYPE_TEAM,
                        'team_id'         => $teamId,
                        'team_name'       => $row->team_name ?: ('Team ' . $teamId),
                        'agent_id'        => null,
                        'agent_name'      => null,
                        'members'         => [],
                        'organization_id' => $member['organization_id'],
                    ];
                }

                $owners[$key]['members'][] = $member;
                continue;
            }

            $key = AgentInvoice::ownerKeyForAgent($member['user_id']);
            $owners[$key] = [
                'owner_key'       => $key,
                'type'            => AgentInvoice::TYPE_SOLO,
                'team_id'         => null,
                'team_name'       => null,
                'agent_id'        => $member['user_id'],
                'agent_name'      => $member['name'],
                'members'         => [$member],
                'organization_id' => $member['organization_id'],
            ];
        }

        return array_values($owners);
    }

    /** Build and store one owner's invoice for the week. */
    private function generateForOwner(
        array $owner,
        Carbon $periodStart,
        Carbon $periodEnd,
        array &$summary,
        int $counter = 0,
        int $totalCount = 0
    ): void {
        $ownerKey = $owner['owner_key'];
        $label    = $owner['type'] === AgentInvoice::TYPE_TEAM
            ? "team \"{$owner['team_name']}\" (" . count($owner['members']) . ' agent(s))'
            : "agent \"{$owner['agent_name']}\"";

        // The "[n/total]" prefix every line of this owner's block carries, so a
        // block can be read on its own in a file covering dozens of owners.
        $tag = $totalCount > 0 ? "[{$counter}/{$totalCount}]" : "[{$ownerKey}]";

        $this->writeLog("{$tag} {$ownerKey} — {$label}");

        if ($owner['type'] === AgentInvoice::TYPE_TEAM) {
            foreach ($owner['members'] as $member) {
                $this->writeVerbose("{$tag}   member: {$member['name']} (user #{$member['user_id']}, rate " . number_format((float) $member['commission_rate'], 2) . ')');
            }
        }

        // Already invoiced for this week — a re-run, not a fault.
        $existing = AgentInvoice::where('owner_key', $ownerKey)
            ->whereDate('period_start', $periodStart->format('Y-m-d'))
            ->first();

        if ($existing) {
            $summary['invoices_skipped']++;
            $this->writeLog("{$tag} ⊘ SKIPPED: already invoiced for this week as {$existing->invoice_number}");
            return;
        }

        $billable = $this->billableCustomers($owner, $periodStart, $periodEnd, $summary);

        // What the incentive cron awarded this owner inside this billing week.
        // Read, never recalculated — the cron is the source of truth.
        $incentive = $this->incentivesForPeriod($owner, $periodStart, $periodEnd, $tag);

        // An owner can legitimately have one without the other: a quota can
        // complete in a week whose own installs are all in the next one, and a
        // week of installs can complete no quota at all. Only when BOTH are
        // empty is there nothing to invoice.
        if ($billable === [] && $incentive['amount'] <= 0) {
            $summary['owners_no_work']++;
            $this->writeLog("{$tag} ⊘ SKIPPED: nothing billable this week (no referrals, no incentives awarded in the period)");
            return;
        }

        foreach ($billable as $c) {
            $this->writeVerbose(sprintf(
                '%s   billable: %s (application #%d, job order #%d, installed %s, referred by %s)',
                $tag,
                $c['customer_name'],
                $c['application_id'],
                $c['job_order_id'],
                $c['installed_date'],
                $c['referred_by_name'] ?: $c['referred_by_raw']
            ));
        }

        $count = count($billable);

        // The incentive is NOT worked out here. It is read from what the
        // incentive cron already awarded inside this billing week — see
        // incentivesForPeriod() for why that is the only defensible source.
        $quota           = (int) ($owner['members'][0]['quota'] ?? 0);
        $quotasReached   = $incentive['quotas'];
        $totalAmount     = $incentive['amount'];
        $installationFee = (float) config('agent_invoices.installation_fee', 0);

        // What one referred customer is worth on this invoice: the commission
        // rate on the referring agent's own record (agent_balance.commission).
        //
        // Read per customer rather than per invoice, because a team's members
        // can sit on different rates and each customer is worth whatever their
        // own agent earns. The header figure below is only the summary of that:
        // the one rate every line shares, or — on a mixed-rate team, where no
        // single number is the truth — the owner's own rate.
        //
        // This is the same $c['commission_rate'] the commission total is summed
        // from a few lines down, so the line items and the COMMISSION figure are
        // built from one source and cannot disagree.
        $ratesCharged = array_values(array_unique(array_map(
            fn ($c) => (float) $c['commission_rate'],
            $billable
        )));
        $unitPrice = count($ratesCharged) === 1
            ? $ratesCharged[0]
            : (float) ($owner['members'][0]['commission_rate'] ?? 0);

        // Commission is earned per referral, at the rate of the agent who
        // brought that customer in — so it is the sum across the invoice, not a
        // fixed figure. On a single-rate team this is simply
        // customers x rate; where members are on different rates, each
        // customer still counts at their own agent's.
        $commission = round(array_sum(array_map(
            fn ($c) => (float) $c['commission_rate'],
            $billable
        )), 2);

        // Matches the reference document: the installation fee is stated on the
        // invoice but does not form part of what is owed.
        $subtotal = round($totalAmount + $commission, 2);

        $invoice = null;

        try {
            DB::transaction(function () use (
                $owner, $ownerKey, $periodStart, $periodEnd, $billable, $unitPrice,
                $count, $totalAmount, $installationFee, $commission, $subtotal,
                $incentive, $tag, &$invoice
            ) {
                $invoice = AgentInvoice::create([
                    'invoice_number'   => $this->nextInvoiceNumber(),
                    'invoice_type'     => $owner['type'],
                    'owner_key'        => $ownerKey,
                    'team_id'          => $owner['team_id'],
                    'agent_id'         => $owner['agent_id'],
                    'team_name'        => $owner['team_name'],
                    'agent_name'       => $owner['agent_name'],
                    'period_start'     => $periodStart->format('Y-m-d'),
                    'period_end'       => $periodEnd->format('Y-m-d'),
                    'invoice_date'     => Carbon::now()->format('Y-m-d'),
                    'total_customers'  => $count,
                    'unit_price'       => $unitPrice,
                    'installation_fee' => $installationFee,
                    'total_amount'     => $totalAmount,
                    'commission'       => $commission,
                    'subtotal'         => $subtotal,
                    'status'           => AgentInvoice::STATUS_GENERATED,
                    'organization_id'  => $owner['organization_id'],
                    'created_by'       => 'System',
                    'updated_by'       => 'System',
                ]);

                $rows = [];
                $now  = Carbon::now();

                foreach ($billable as $c) {
                    $rows[] = [
                        'agent_invoice_id'     => $invoice->id,
                        'application_id'       => $c['application_id'],
                        'job_order_id'         => $c['job_order_id'],
                        'owner_key'            => $ownerKey,
                        'customer_name'        => $c['customer_name'],
                        'referred_by_agent_id' => $c['referred_by_agent_id'],
                        'referred_by_name'     => $c['referred_by_name'],
                        'referred_by_raw'      => $c['referred_by_raw'],
                        'installed_date'       => $c['installed_date'],
                        // This customer's own agent's rate, not the invoice
                        // header's — on a mixed-rate team the header cannot
                        // represent every line, and the line is what is owed.
                        'unit_price'           => (float) $c['commission_rate'],
                        'quantity'             => 1,
                        'total'                => (float) $c['commission_rate'],
                        'created_at'           => $now,
                        'updated_at'           => $now,
                    ];
                }

                // The unique key on (owner_key, application_id) refuses any
                // customer already billed to this owner. If that fires, the
                // whole invoice rolls back rather than being issued short.
                foreach (array_chunk($rows, 500) as $chunk) {
                    DB::table('agent_invoice_customers')->insert($chunk);
                }

                $this->claimIncentives($incentive, $invoice, $now, $tag);
            });
        } catch (IncentiveAlreadyBilled $e) {
            // Another invoice claimed one of these completed quotas between our
            // read and our write. The whole invoice has rolled back, incentives
            // included, so nothing has been paid twice. A re-run will see the
            // remaining unbilled quotas and bill those.
            $summary['invoices_skipped']++;
            $this->writeLog("{$tag} ⊘ SKIPPED: " . $e->getMessage());
            return;
        } catch (QueryException $e) {
            // Another run got there first, or a customer slipped in between the
            // read and the write. Either way this owner is already covered.
            $summary['invoices_skipped']++;
            $this->writeLog("{$tag} ⊘ SKIPPED: refused by the database (already invoiced): " . $e->getMessage());
            return;
        }

        $summary['invoices_created']++;
        $summary['customers_billed'] += $count;
        $summary['amount_invoiced']  += $subtotal;

        $this->writeVerbose(sprintf(
            '%s   %d customer(s) billed; incentive taken from the cron: %d completed quota(s) awarded %s to %s = ₱%s; commission ₱%s, installation fee ₱%s',
            $tag,
            $count,
            $quotasReached,
            $periodStart->format('Y-m-d H:i:s'),
            $periodEnd->format('Y-m-d H:i:s'),
            number_format($totalAmount, 2),
            number_format($commission, 2),
            number_format($installationFee, 2)
        ));

        foreach ($incentive['batches'] as $batch) {
            $this->writeVerbose(sprintf(
                '%s     incentive: agent #%d batch %d — ₱%s awarded %s (quota of %d, job order(s) %s)',
                $tag,
                $batch['agent_id'],
                $batch['batch_number'],
                number_format($batch['amount'], 2),
                $batch['processed_at'],
                $batch['quota_reached'],
                implode(', ', $batch['job_order_ids'])
            ));
        }

        if ($quota > 0 && $quotasReached === 0) {
            $this->writeVerbose(sprintf(
                '%s   no completed quota fell in this week — the agent\'s progress toward their quota of %d is held by the incentive cron, not lost',
                $tag,
                $quota
            ));
        }

        $this->writeLog(
            "{$tag} ✓ SUCCESS - {$invoice->invoice_number} issued — {$count} customer(s), incentive ₱"
            . number_format($totalAmount, 2) . ", subtotal ₱" . number_format($subtotal, 2)
        );

        // The PDF is written outside the transaction: a file that fails to
        // write must not undo a correctly recorded invoice. It can be produced
        // again on demand from the stored rows.
        $this->writePdf($invoice, $summary, $tag);
    }

    /**
     * The incentive this owner earned inside this billing week.
     *
     * READ, NEVER RECALCULATED. The incentive cron
     * (AgentIncentiveService) is the only thing that decides whether a quota
     * was completed and what it was worth, and it already wrote that decision
     * to `agent_incentive_history`. This method's whole job is to find the
     * right rows and total them.
     *
     * Recalculating here — counting this week's billable customers and dividing
     * by the quota — is what this replaces, and it was wrong in both
     * directions. It lost every remainder, because a customer billed this week
     * can never be billed again, so an owner who installed 8 against a quota of
     * 10 bought nothing toward the next quota and would never earn an incentive
     * at all. And it paid quotas the cron had already paid, since neither knew
     * what the other had done. One source of truth removes both.
     *
     * WHICH ROWS. Three conditions, all required:
     *
     *   • `agent_id` is one of this owner's agents. A team invoice totals every
     *     member's incentives; a solo invoice is just the one agent.
     *   • `processed_at` falls inside the billing week, to the second. This is
     *     when the cron awarded the quota, so an invoice for 10–16 August takes
     *     exactly what the cron awarded between the 10th at 00:00:00 and the
     *     16th at 23:59:59, however many times it ran in between, and nothing
     *     from outside those bounds.
     *   • `agent_invoice_id` is NULL — not yet billed on any invoice.
     *
     * Only rows carrying `incentive_value > 0` are money: the cron records the
     * award against the one job order that COMPLETED each quota and 0 against
     * the rest of that batch. Totalling the column would therefore be correct
     * on its own, but the batch's other rows are collected too, because they
     * name the customers that earned the payout — and they are claimed with it,
     * so the whole completed quota is marked billed together.
     *
     * @return array{amount: float, quotas: int, row_ids: int[], batches: array}
     */
    private function incentivesForPeriod(array $owner, Carbon $periodStart, Carbon $periodEnd, string $tag = ''): array
    {
        $empty = ['amount' => 0.0, 'quotas' => 0, 'row_ids' => [], 'batches' => []];

        $agentIds = array_values(array_unique(array_map(
            fn ($m) => (int) $m['user_id'],
            $owner['members']
        )));

        if ($agentIds === []) {
            return $empty;
        }

        $from = $periodStart->format('Y-m-d H:i:s');
        $to   = $periodEnd->format('Y-m-d H:i:s');

        // The paying row of each completed quota awarded in this week.
        // Every completed quota awarded up to the end of this week that no invoice
        // has claimed yet.
        //
        // As with the customers above, the lower bound was the problem, not the
        // upper one. A quota the cron completed inside a week that had already
        // been invoiced could never be billed by that week's invoice (it exists
        // already) nor by any later one (its processed_at was too old), so the
        // agent kept an incentive on their balance that no invoice would ever
        // carry. `agent_invoice_id IS NULL` is what prevents double-billing here,
        // and it does not need a date to help it.
        $paying = DB::table('agent_incentive_history')
            ->whereIn('agent_id', $agentIds)
            ->whereNull('agent_invoice_id')
            ->where('incentive_value', '>', 0)
            ->whereNotNull('processed_at')
            ->where('processed_at', '<=', $to)
            ->orderBy('agent_id')
            ->orderBy('batch_number')
            ->get(['id', 'agent_id', 'batch_number', 'quota_reached', 'incentive_value', 'processed_at', 'job_order_id']);

        // An owner sitting on unbilled quotas from BEFORE this window is worth
        // saying out loud whether or not this week has any of its own, because
        // the strict window is what leaves them there.
        $this->reportUnbilledOutsidePeriod($agentIds, $from, $to, $tag);

        // Nothing awarded in the window is a normal week, not a fault.
        if ($paying->isEmpty()) {
            return $empty;
        }

        $rowIds  = [];
        $batches = [];
        $amount  = 0.0;

        foreach ($paying as $row) {
            $key = $row->agent_id . ':' . $row->batch_number;

            $rowIds[] = (int) $row->id;
            $amount  += (float) $row->incentive_value;

            $batches[$key] = [
                'agent_id'      => (int) $row->agent_id,
                'batch_number'  => (int) $row->batch_number,
                'quota_reached' => (int) $row->quota_reached,
                'amount'        => (float) $row->incentive_value,
                'processed_at'  => (string) $row->processed_at,
                'job_order_ids' => [(int) $row->job_order_id],
            ];
        }

        // The rest of each batch: the other customers that made up the quota.
        //
        // Batch 0 is skipped deliberately. It is what rows recorded before batch
        // numbers existed carry, so matching on it would sweep in every legacy
        // row the agent has rather than one quota's worth.
        $batchPairs = array_values(array_filter(
            $batches,
            fn ($b) => $b['batch_number'] > 0
        ));

        if ($batchPairs !== []) {
            $companions = DB::table('agent_incentive_history')
                ->whereIn('agent_id', $agentIds)
                ->whereNull('agent_invoice_id')
                ->whereNotIn('id', $rowIds)
                ->where(function ($q) use ($batchPairs) {
                    foreach ($batchPairs as $batch) {
                        $q->orWhere(function ($w) use ($batch) {
                            $w->where('agent_id', $batch['agent_id'])
                              ->where('batch_number', $batch['batch_number']);
                        });
                    }
                })
                ->orderBy('job_order_id')
                ->get(['id', 'agent_id', 'batch_number', 'job_order_id']);

            foreach ($companions as $row) {
                $key = $row->agent_id . ':' . $row->batch_number;

                if (!isset($batches[$key])) {
                    continue;
                }

                $rowIds[] = (int) $row->id;
                $batches[$key]['job_order_ids'][] = (int) $row->job_order_id;
            }
        }

        return [
            'amount'  => round($amount, 2),
            'quotas'  => count($batches),
            'row_ids' => array_values(array_unique($rowIds)),
            'batches' => array_values($batches),
        ];
    }

    /**
     * Mark this invoice as the one that paid these completed quotas.
     *
     * The `whereNull('agent_invoice_id')` on the update is the guard, not a
     * tidy-up: it means the write only lands on rows nobody has claimed yet. If
     * fewer rows come back than were asked for, another invoice took one in
     * between — so this throws, the surrounding transaction rolls back, and the
     * invoice that would have double-paid is never issued at all.
     *
     * Without that check the read and the write are two separate moments, and
     * two runs overlapping (the Monday cron and somebody pressing Generate)
     * could each read the same unbilled quota and each bill it.
     *
     * @param  array{amount: float, quotas: int, row_ids: int[], batches: array}  $incentive
     *
     * @throws IncentiveAlreadyBilled  when another invoice claimed a row first
     */
    private function claimIncentives(array $incentive, AgentInvoice $invoice, Carbon $now, string $tag = ''): void
    {
        $rowIds = $incentive['row_ids'];

        if ($rowIds === []) {
            return;
        }

        $claimed = DB::table('agent_incentive_history')
            ->whereIn('id', $rowIds)
            ->whereNull('agent_invoice_id')
            ->update([
                'agent_invoice_id' => $invoice->id,
                'invoiced_at'      => $now,
                'updated_at'       => $now,
            ]);

        if ($claimed !== count($rowIds)) {
            throw new IncentiveAlreadyBilled(sprintf(
                'incentive already billed elsewhere — claimed %d of %d incentive record(s); '
                . 'the invoice has been rolled back rather than pay a quota twice',
                $claimed,
                count($rowIds)
            ));
        }

        $this->writeVerbose(sprintf(
            '%s   claimed %d incentive record(s) covering %d completed quota(s) for %s',
            $tag,
            $claimed,
            $incentive['quotas'],
            $invoice->invoice_number
        ));
    }

    /**
     * Warn when an owner holds completed quotas the strict window cannot bill.
     *
     * The window is deliberately strict — only what the cron awarded inside the
     * billing week is billed — and the consequence is worth stating plainly: a
     * quota the cron completes on, say, the 17th does not belong to the 10th–16th
     * invoice. It belongs to the NEXT one, whose window contains the 17th, and it
     * stays unbilled (`agent_invoice_id IS NULL`) until that run picks it up.
     *
     * That is only true while the invoice runs keep covering consecutive weeks,
     * which periodFor() guarantees for consecutive runs. A skipped week leaves a
     * gap no later run reaches, so anything old enough to have fallen through one
     * is named here rather than going quiet.
     */
    private function reportUnbilledOutsidePeriod(array $agentIds, string $from, string $to, string $tag): void
    {
        // Only what this run genuinely cannot reach: a quota awarded AFTER the
        // week being billed. Everything earlier is now swept up by
        // incentivesForPeriod(), so anything reported here is dated in the
        // future — a back-dated award, or a clock that disagrees with the run.
        //
        // It is tagged [UNBILLED] so it survives CronLog's filter. This warning
        // used to be dropped from the log entirely: it carries no error tag and
        // no failure phrase, so with the shipped defaults the one notice that
        // money was sitting unbillable never reached the file it was written to.
        $ahead = DB::table('agent_incentive_history')
            ->whereIn('agent_id', $agentIds)
            ->whereNull('agent_invoice_id')
            ->where('incentive_value', '>', 0)
            ->where('processed_at', '>', $to)
            ->selectRaw('COUNT(*) as cycles, COALESCE(SUM(incentive_value), 0) as amount, MIN(processed_at) as soonest')
            ->first();

        if (!$ahead || (int) $ahead->cycles === 0) {
            return;
        }

        $this->writeLog(sprintf(
            '%s   [UNBILLED] %d completed quota(s) worth ₱%s are dated AFTER this billing week '
            . '(earliest %s, week ends %s). They will be billed by the run that covers that week. '
            . 'A date in the future usually means a back-dated award or a clock difference.',
            $tag,
            (int) $ahead->cycles,
            number_format((float) $ahead->amount, 2),
            (string) $ahead->soonest,
            $to
        ));
    }

    /**
     * The customers this owner can bill for this week.
     *
     * Excludes anyone already invoiced to this owner, whatever their install
     * date now says — the record of what has been billed is what counts, not
     * the date on the job order.
     */
    private function billableCustomers(array $owner, Carbon $periodStart, Carbon $periodEnd, array &$summary): array
    {
        $alreadyBilled = AgentInvoiceCustomer::where('owner_key', $owner['owner_key'])
            ->pluck('application_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $billedIndex = array_flip($alreadyBilled);

        $startDate = AgentProgramme::startDate();
        $completedAt = AgentProgramme::onboardedAtSql('jo');

        $query = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(jo.onsite_status))'), ['done', 'completed'])
            ->whereNotNull('a.referred_by')
            // Everything installed up to the end of this week that has not been
            // billed to this owner yet — NOT only what falls inside the week.
            //
            // The window used to be closed at both ends, which read as tidy and
            // lost money. A job order closed, back-dated or approved after its own
            // Monday run fell into a week that could never be invoiced again
            // (owner_key + period_start is unique), and because the query also
            // refused anything older than this week's Monday, no later run would
            // ever reach it either. The referral was simply never billed.
            //
            // Only the upper bound is a real boundary: work is not billed before
            // it happens. The lower bound is redundant, because the already-billed
            // check below and the unique key on (owner_key, application_id) are
            // what stop a customer being billed twice - not the date.
            //
            // The first run after this change sweeps up whatever earlier runs left
            // behind, which is the point: those referrals are owed.
            ->whereRaw("{$completedAt} <= ?", [$periodEnd->format('Y-m-d H:i:s')]);

        // Never bill for work done before the agent programme began.
        if ($startDate !== null) {
            $query->whereRaw("{$completedAt} >= ?", [$startDate->format('Y-m-d H:i:s')]);
        }

        $rows = $query->select(
            'jo.id as job_order_id',
            'a.id as application_id',
            'a.first_name',
            'a.middle_initial',
            'a.last_name',
            'a.referred_by',
            // The rate this job order was actually SETTLED at, stamped on it by
            // JobOrderAgentPaymentService when it was approved. Null until then.
            'jo.commission_value as settled_rate',
            DB::raw("{$completedAt} as installed_at")
        )->orderBy('jo.id')->get();

        $billable = [];
        $seen     = [];

        foreach ($rows as $row) {
            $applicationId = (int) $row->application_id;

            // Two installed job orders against one application would otherwise
            // bill the same customer twice on the same invoice.
            if (isset($seen[$applicationId])) {
                continue;
            }

            // Which agent in this owner referred them, if any.
            $member = $this->memberWhoReferred($owner['members'], (string) $row->referred_by);
            if ($member === null) {
                continue;
            }

            if (isset($billedIndex[$applicationId])) {
                $summary['customers_skipped']++;
                continue;
            }

            $seen[$applicationId] = true;

            $billable[] = [
                'application_id'       => $applicationId,
                'job_order_id'         => (int) $row->job_order_id,
                'customer_name'        => $this->fullName($row),
                'referred_by_agent_id' => $member['user_id'],
                'referred_by_name'     => $member['name'],
                'referred_by_raw'      => (string) $row->referred_by,
                'installed_date'       => $row->installed_at ? Carbon::parse($row->installed_at)->format('Y-m-d') : null,
                // What this referral actually earns.
                //
                // The rate the job order was SETTLED at wins. That figure is what
                // the agent was credited with when it was approved, and
                // JobOrderAgentPaymentService stamps it onto the row precisely so
                // that "raising the rate next month would [not] silently restate
                // money already paid". Reading the live agent_balance.commission
                // here defeated exactly that: an administrator changing the rate
                // between approval and Monday made the invoice bill an amount the
                // agent had never been credited with — proven at ₱250 billed
                // against ₱100 credited.
                //
                // The agent's current rate still stands in where there is no
                // snapshot: a job order approved before the column existed, or one
                // being billed before it has been approved.
                'commission_rate'      => $row->settled_rate !== null && (float) $row->settled_rate > 0
                    ? (float) $row->settled_rate
                    : (float) ($member['commission_rate'] ?? 0),
            ];
        }

        return $billable;
    }

    /**
     * Which agent of this owner a "Referred By" value belongs to.
     *
     * Uses the same tolerant match the rest of the agent module uses, so a
     * referral written with a middle name still reaches the right agent — and
     * on a team invoice each customer stays attached to whoever brought them in.
     */
    private function memberWhoReferred(array $members, string $referredBy): ?array
    {
        foreach ($members as $member) {
            if (AgentProgramme::referralBelongsToAgent($referredBy, $member['name'], $member['email'], $member['user_id'] ?? null)) {
                return $member;
            }
        }

        return null;
    }

    /**
     * The next invoice number.
     *
     * Taken from the highest number ever issued rather than a count of rows, so
     * deleting an invoice cannot hand its number to a later one. The unique key
     * on the column is the backstop if two runs reach here together.
     */
    public function nextInvoiceNumber(): string
    {
        $prefix  = (string) config('agent_invoices.number_prefix', 'ATSS-AGT');
        $padding = (int) config('agent_invoices.number_padding', 6);

        $last = AgentInvoice::where('invoice_number', 'like', $prefix . '-%')
            ->orderByRaw('LENGTH(invoice_number) DESC, invoice_number DESC')
            ->value('invoice_number');

        $next = 1;
        if ($last !== null) {
            $tail = substr((string) $last, strlen($prefix) + 1);
            if (is_numeric($tail)) {
                $next = ((int) $tail) + 1;
            }
        }

        return $prefix . '-' . str_pad((string) $next, $padding, '0', STR_PAD_LEFT);
    }

    /** Render and store the invoice PDF, recording where it went. */
    private function writePdf(AgentInvoice $invoice, array &$summary, string $tag = ''): void
    {
        $prefix = $tag !== '' ? "{$tag} " : '';

        try {
            // The PDF goes straight to Google Drive; render() records the link
            // and the layout-versioned name on the invoice itself, so there is
            // nothing to save here.
            $url = app(AgentInvoicePdfService::class)->render($invoice);

            $summary['pdfs_written']++;
            $this->writeLog("{$prefix}  [PDF] {$url}");
        } catch (Throwable $e) {
            // The invoice itself stands. The PDF can be produced again on
            // demand from the rows already recorded.
            $summary['pdf_failures']++;
            $this->writeLog("{$prefix}  ⚠ [PDF FAILED] " . $e->getMessage());
            Log::channel('single')->error("[AGENT INVOICES] PDF failed for {$invoice->invoice_number}: " . $e->getMessage());
        }
    }

    /** "First M. Last" from a row carrying those columns. */
    private function fullName($row): string
    {
        $first  = trim((string) ($row->first_name ?? ''));
        $middle = trim((string) ($row->middle_initial ?? ''));
        $last   = trim((string) ($row->last_name ?? ''));

        $parts = array_filter([$first, $middle !== '' ? rtrim($middle, '.') . '.' : '', $last], fn ($p) => $p !== '');

        return trim(preg_replace('/\s+/', ' ', implode(' ', $parts)));
    }

    /**
     * Write one line to the run log.
     *
     * Three destinations, the same three AutoDisconnectService writes to:
     *
     *   • storage/logs/agent-invoices/Agent_Invoices.log — the run's own file,
     *     which is what somebody reads when asking "what did last Monday bill?"
     *   • Laravel's `single` channel, so a run appears in laravel.log alongside
     *     whatever else was happening at the time.
     *   • stdout, when running from the CLI, so `php artisan agent-invoices:generate`
     *     streams rather than going quiet for a minute.
     *
     * Wrapped in a try/catch throughout: a full disk or a read-only log
     * directory must never be the reason a week goes unbilled.
     */
    private function writeLog(string $message): void
    {
        // Errors and run summaries only - see App\Support\CronLog. This is a raw
        // file write, so LOG_LEVEL never reached it and the narration accumulated
        // no matter how the channels were configured.
        if (!CronLog::shouldWrite($message)) {
            return;
        }

        $line = '[' . Carbon::now()->format('Y-m-d H:i:s') . "] [{$this->logName}] {$message}";

        try {
            $dir = storage_path('logs/agent-invoices');

            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }

            @file_put_contents($dir . '/' . $this->logName . '.log', $line . PHP_EOL, FILE_APPEND);
        } catch (Throwable $e) {
            // Logging must never be the reason a run fails.
        }

        try {
            // Only faults are mirrored, and as ->error(). Every line used to be
            // duplicated into laravel.log at info level, which doubled the volume
            // and misreported the severity of all of it.
            if (CronLog::isError($message)) {
                Log::channel('single')->error("[{$this->logName}] {$message}");
            }
        } catch (Throwable $e) {
            // As above.
        }

        if ($this->isCli && $this->cliEcho) {
            $this->echoCli($line);
        }
    }

    /**
     * A line that is only written when verbose mode is on.
     *
     * Tagged [VERBOSE] and following the same path as everything else, so the
     * detail can be filtered out of a file after the fact.
     */
    private function writeVerbose(string $message): void
    {
        if (!$this->verbose) {
            return;
        }

        $this->writeLog("[VERBOSE] {$message}");
    }

    /** Echo one line to stdout and flush, so CLI output streams live. */
    private function echoCli(string $line): void
    {
        try {
            if (defined('STDOUT')) {
                @fwrite(STDOUT, $line . PHP_EOL);
            } else {
                echo $line . PHP_EOL;
            }
            @flush();
        } catch (Throwable $e) {
            // Never fatal.
        }
    }
}
