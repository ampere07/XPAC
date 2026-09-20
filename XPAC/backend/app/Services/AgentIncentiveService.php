<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Support\CronLog;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;
use Throwable;

/**
 * AgentIncentiveService
 * ---------------------------------------------------------------------------
 * Cron logic that awards quota-based incentives to agents.
 *
 * For each agent it counts the agent's countable Job Orders that have not yet
 * been counted, and for every full multiple of the agent's quota it pays the
 * configured `incentives_value` ONCE:
 *
 *     incentive earned = number of completed quotas x incentives_value
 *
 * A quota of 10 with an incentive value of 100 earns 100 per completed quota.
 * Reaching the quota is what earns the incentive; the referrals inside it are
 * what it takes to get there, not separately paid units. (Commission is the
 * per-referral part of the scheme and is unaffected by this.)
 *
 * Each full quota cycle is a "batch". An agent with 20 completed Job Orders and
 * a quota of 10 is awarded 2 batches in one run (10 Job Orders tagged to each),
 * and batch numbers keep incrementing per agent across runs (batch 1, 2, 3, …).
 * Any remainder (< quota) carries over unprocessed to the next run.
 *
 * WHAT COUNTS AS A REFERRAL
 * ---------------------------------------------------------------------------
 * A Job Order counts when EITHER its onsite status is "Done" or "Completed", OR
 * its `pre_installed` column carries the pre-install marker AND it has not since
 * been abandoned. The second lets a referral earn quota progress once the site
 * has been pre-installed, without waiting for the technician to close the
 * install — the agent's part is done either way.
 *
 * The abandoned qualifier is what stops it paying for work that never landed: a
 * site pre-installed and then Failed or Cancelled counts for nothing, which is
 * how the rest of the scheme already treats it (commission needs the job order
 * approved; achievements and invoice lines need Done or Completed).
 *
 * That qualifier only decides what to count NOW, so on its own it never covered
 * the case where the site was still countable when the quota completed and
 * failed afterwards — the incentive was already paid. reverseAbandonedBatches()
 * closes that from the other end, undoing a completed quota once one of its
 * referrals turns out to have been abandoned.
 *
 * Counting early does not risk counting twice: a Job Order consumed by a
 * completed quota is recorded in `agent_incentive_history`, and the
 * `whereNotExists` below can never see it again — so its later flip to "Done"
 * picks up nothing.
 *
 * PROGRESS IS NEVER RESET BY A RUN.
 * ---------------------------------------------------------------------------
 * A run does not "start a fresh count". It asks one question — which of this
 * agent's countable Job Orders are NOT yet in `agent_incentive_history` — and
 * that set only ever grows until a quota completes. So an agent on a quota of 5
 * who has Customer 1 and Customer 2 today still has both tomorrow, counted
 * toward the SAME quota, however many times the cron runs in between. Nothing
 * is discarded for want of a full quota; the run simply reports progress
 * (2/5) and awards nothing.
 *
 * When the quota does complete, the opposite applies and it applies
 * permanently: every Job Order that made up the completed quota is written to
 * `agent_incentive_history` inside the same transaction that pays it, tagged
 * with that cycle's `batch_number`. From that moment those customers are
 * consumed — the `whereNotExists` below can never see them again, so they
 * cannot be counted toward a second quota or paid a second time. Only
 * customers arriving afterwards count toward the next one.
 *
 * Only Job Orders onboarded on or after `config('agent.start_date')` are in
 * scope; anything earlier belongs to the period before the scheme and earns
 * nothing. Achievement progress uses the same date, so the two always agree
 * about which of an agent's referrals count.
 *
 * Idempotency / no-double-pay is guaranteed two ways:
 *   1. Only Job Orders absent from `agent_incentive_history` are counted.
 *   2. Every counted Job Order is recorded in `agent_incentive_history`, which
 *      has a UNIQUE key on `job_order_id` — so even concurrent runs cannot
 *      record (and therefore cannot pay for) the same Job Order twice.
 *
 * Job Order ↔ Agent association follows the project's existing convention
 * (see CommissionController): Job Orders are linked to an agent through the
 * related application's `referred_by` field.
 *
 * That field now holds the agent's user id for any referral made through the
 * "Referred By" picker, stored as the BARE NUMBER — `37`, not `agent:37`; see
 * AgentReferral::encode(). An id names exactly one account, so those referrals
 * are immune to the name collisions, renames and partial matches that the
 * full-name matching below could never resolve. No new column was needed: the
 * same varchar carries both forms.
 *
 * The cost of the bare form is that only its shape separates it from legacy free
 * text. AgentReferral::agentId() refuses anything that is not all digits and
 * refuses leading zeros, so "09077694575" and "000201" stay text — but a
 * historic referral recorded as a small bare number cannot be told apart from a
 * user id, and will be read as one.
 *
 * Older referrals are still free text — agent names, team names, and values
 * like "Walk in" — and are still matched by name, so both forms are queried
 * here and neither has to be migrated before the other works.
 */
class AgentIncentiveService
{
    private string $logName = 'Agent_Incentives';

    /**
     * Agents touched by the current run, bucketed by outcome.
     *
     * The per-agent narration this service writes is filtered out of the log file now
     * (see App\Support\CronLog), so the record of which agents were actually handled has
     * to survive somewhere. It is emitted once at the end of the run as a quoted,
     * comma-separated list per outcome — short enough to read at a glance, and in a form
     * that pastes straight into `WHERE agent_id IN (...)` when a specific agent has to be
     * chased.
     */
    private CronLog $runLog;

    public function __construct()
    {
        $this->runLog = new CronLog();
    }

    /** The two statuses that count as a successful finish. */
    private const SUCCESSFUL_ONSITE_STATUSES = ['done', 'completed'];

    /**
     * Onsite statuses that abandon a job order, so a pre-installation visit on
     * it earns nothing.
     *
     * Derived from JobOrder's own list of statuses that finish a job order for
     * good, less the two that finish it successfully — so adding a terminal
     * status to the model closes this hole for that status too, without anyone
     * having to remember this file.
     *
     * @return array<int, string>
     */
    private static function abandonedOnsiteStatuses(): array
    {
        return array_values(array_diff(
            \App\Models\JobOrder::TECHNICIAN_QUEUE_CLOSED_ONSITE_STATUSES,
            self::SUCCESSFUL_ONSITE_STATUSES
        ));
    }

    /**
     * The day the agent programme starts counting, or null to count everything.
     *
     * Shared with achievement progress, so a referral is either in scope for
     * both or for neither.
     */
    public static function startDate(): ?Carbon
    {
        return \App\Support\AgentProgramme::startDate();
    }

    /**
     * Process incentives for every agent.
     *
     * @return array Summary counters for the run.
     */
    public function process(): array
    {
        $summary = [
            'agents_processed'    => 0,
            'agents_awarded'      => 0,
            'incentive_awards'    => 0,   // total number of quota cycles awarded across all agents
            'amount_awarded'      => 0.0, // total currency awarded
            'job_orders_recorded' => 0,
            'skipped'             => 0,   // agents skipped (no user / not configured)
            'skipped_job_orders'  => 0,   // completed job orders skipped (already processed)
            // Job orders held as unfinished quota progress at the end of the
            // run. They are NOT lost — the next run counts them toward the same
            // quota — and this is the figure that proves it.
            'job_orders_carried'  => 0,
            'errors'              => 0,
        ];

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║            AGENT QUOTA INCENTIVE PROCESSING START              ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));

        // Before counting anything, undo quotas that turned out not to have been
        // met. See reverseAbandonedBatches().
        $summary['batches_reversed'] = 0;
        $summary['amount_reversed']  = 0.0;
        $summary['reversals_blocked'] = 0;
        $this->reverseAbandonedBatches($summary);

        // One small query: every agent's incentive configuration.
        $balances = DB::table('agent_balance')->get();
        $total = $balances->count();
        $this->writeLog("[QUERY] Found {$total} agent balance record(s) to evaluate");
        $this->writeLog("─────────────────────────────────────────────────────────────────");

        $counter = 0;
        foreach ($balances as $balance) {
            $counter++;
            $summary['agents_processed']++;

            $this->writeLog("");
            $this->writeLog("[{$counter}/{$total}] ══════════════════════════════════════════════");

            try {
                $this->processAgent($balance, $summary, $counter, $total);
            } catch (Throwable $e) {
                // One agent's failure must never stop the rest of the run.
                $summary['errors']++;
                $this->runLog->failed((string) $balance->agent_id);
                $this->writeLog("  [ERROR] Agent #{$balance->agent_id}: " . $e->getMessage());
                $this->writeLog("[{$counter}/{$total}] ✗ ERROR");
                Log::channel('single')->error("[{$this->logName}] Agent #{$balance->agent_id} failed: " . $e->getMessage(), [
                    'trace' => $e->getTraceAsString(),
                ]);
            }
        }

        $endTime = Carbon::now();
        $duration = $endTime->diffInSeconds($startTime);

        $this->writeLog("");
        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║            AGENT QUOTA INCENTIVE PROCESSING COMPLETE           ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $this->writeLog("Summary:");
        $this->writeLog("  • Agents Evaluated:    {$summary['agents_processed']}");
        $this->writeLog("  • Agents Awarded:      {$summary['agents_awarded']}");
        $this->writeLog("  • Incentive Cycles:    {$summary['incentive_awards']}");
        $this->writeLog("  • Amount Awarded:      " . number_format($summary['amount_awarded'], 2));
        $this->writeLog("  • Job Orders Recorded: {$summary['job_orders_recorded']}");
        $this->writeLog("  • Agents Skipped:      {$summary['skipped']}");
        $this->writeLog("  • Job Orders Skipped:  {$summary['skipped_job_orders']}");
        $this->writeLog("  • Job Orders Carried:  {$summary['job_orders_carried']} (unfinished quota progress kept for the next run)");
        $this->writeLog("  • Batches Reversed:    {$summary['batches_reversed']} (abandoned after the quota completed) worth " . number_format($summary['amount_reversed'], 2));
        $this->writeLog("  • Reversals Blocked:   {$summary['reversals_blocked']} (already billed — needs a credit note)");
        $this->writeLog("  • Errors:              {$summary['errors']}");
        $this->writeLog("  • Duration:            {$duration} second(s)");
        $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        $this->writeRunSummary();

        return $summary;
    }

    /**
     * Undo completed quotas that contain a job order which has since been abandoned.
     *
     * A referral counts toward a quota as soon as its site is pre-installed —
     * deliberately, so an agent is not kept waiting for the technician to close
     * the install. The abandoned-status filter in the counting query is what was
     * meant to stop that paying for work which never landed, but it is a
     * point-in-time test: it only decides what to count NOW. It says nothing
     * about a job order that was countable when the quota completed and failed
     * afterwards.
     *
     * That sequence — pre-installed, cron runs, install fails — left the incentive
     * paid, and there was nothing anywhere in the module to take it back: no
     * negative rows, no reversal, no adjustment. In the simulation an agent kept
     * ₱500 for two referrals that both ended Failed, and it was billed to the
     * company on a weekly invoice.
     *
     * This closes it from the other end. Every run, before counting anything:
     *
     *   • find the recorded job orders that are now abandoned
     *   • take the whole batch each one belongs to — the quota was only ever
     *     complete BECAUSE of it, so the rest of the batch did not earn the award
     *     on its own
     *   • debit the award from the agent's balance and delete the batch's rows
     *
     * Deleting rather than flagging is deliberate: `job_order_id` is UNIQUE, so a
     * flagged row would block the still-valid referrals in that batch from ever
     * being counted again. Removing them returns those referrals to the pool,
     * where they belong — they were never the problem — and the abandoned one
     * stays out because the counting query still refuses it. The deletion is
     * recorded on the audit trail, so the ledger is not the only account of it.
     *
     * A batch that has ALREADY been billed is left alone and reported instead.
     * Rewriting it would silently contradict an invoice that has been issued, and
     * possibly paid; that needs a credit note, which this module has no concept
     * of. Naming it is the honest outcome, and the [REVERSED] tag survives the
     * cron log filter so it cannot go quiet.
     */
    private function reverseAbandonedBatches(array &$summary): void
    {
        $abandoned = self::abandonedOnsiteStatuses();

        if ($abandoned === []) {
            return;
        }

        // The recorded job orders that have since been abandoned.
        $spoiled = DB::table('agent_incentive_history as aih')
            ->join('job_orders as jo', 'jo.id', '=', 'aih.job_order_id')
            ->whereIn(DB::raw('LOWER(TRIM(jo.onsite_status))'), $abandoned)
            ->get(['aih.agent_id', 'aih.batch_number', 'aih.job_order_id', 'aih.agent_invoice_id']);

        if ($spoiled->isEmpty()) {
            return;
        }

        // One entry per affected batch, not per job order.
        $batches = [];
        foreach ($spoiled as $row) {
            $key = $row->agent_id . ':' . $row->batch_number;
            $batches[$key] ??= [
                'agent_id'     => (int) $row->agent_id,
                'batch_number' => (int) $row->batch_number,
                'job_orders'   => [],
            ];
            $batches[$key]['job_orders'][] = (int) $row->job_order_id;
        }

        foreach ($batches as $batch) {
            $rows = DB::table('agent_incentive_history')
                ->where('agent_id', $batch['agent_id'])
                ->where('batch_number', $batch['batch_number'])
                ->get(['id', 'job_order_id', 'incentive_value', 'agent_invoice_id']);

            if ($rows->isEmpty()) {
                continue;
            }

            $award  = round((float) $rows->sum('incentive_value'), 2);
            $billed = $rows->first(fn ($r) => $r->agent_invoice_id !== null);

            if ($billed !== null) {
                $summary['reversals_blocked']++;
                $this->writeLog(sprintf(
                    '  [REVERSED] CANNOT reverse batch %d for agent #%d: it was already billed on '
                    . 'agent invoice #%d. The quota included job order(s) %s, which have since been '
                    . 'abandoned, so ₱%s was paid for work that did not land. The invoice is left '
                    . 'untouched — settle this by credit note, not by editing the ledger.',
                    $batch['batch_number'],
                    $batch['agent_id'],
                    (int) $billed->agent_invoice_id,
                    implode(', ', $batch['job_orders']),
                    number_format($award, 2)
                ));
                continue;
            }

            try {
                DB::transaction(function () use ($batch, $rows, $award) {
                    DB::table('agent_incentive_history')
                        ->whereIn('id', $rows->pluck('id')->all())
                        ->delete();

                    if ($award > 0) {
                        DB::table('agent_balance')
                            ->where('agent_id', $batch['agent_id'])
                            ->update([
                                // GREATEST so a balance already drawn down by a
                                // payout cannot be pushed negative by the claw-back.
                                'incentives' => DB::raw(
                                    'GREATEST(0, COALESCE(incentives, 0) - ' . number_format($award, 2, '.', '') . ')'
                                ),
                                'updated_at' => Carbon::now(),
                            ]);
                    }
                });
            } catch (Throwable $e) {
                $summary['errors']++;
                $this->writeLog(sprintf(
                    '  [ERROR] Could not reverse batch %d for agent #%d: %s',
                    $batch['batch_number'],
                    $batch['agent_id'],
                    $e->getMessage()
                ));
                continue;
            }

            $summary['batches_reversed']++;
            $summary['amount_reversed'] += $award;

            $this->writeLog(sprintf(
                '  [REVERSED] batch %d for agent #%d — ₱%s clawed back. Job order(s) %s were '
                . 'abandoned after the quota completed; the other %d referral(s) in the batch return '
                . 'to the pool and may count toward a later quota.',
                $batch['batch_number'],
                $batch['agent_id'],
                number_format($award, 2),
                implode(', ', $batch['job_orders']),
                max(0, $rows->count() - count($batch['job_orders']))
            ));

            $this->recordReversalOnAuditTrail($batch, $rows, $award);
        }
    }

    /**
     * Leave an account of a reversal outside the ledger it just changed.
     *
     * The rows are gone, so without this the only record of the claw-back would
     * be a log line. Never fatal: an audit trail that cannot be written must not
     * stop the money being corrected.
     */
    private function recordReversalOnAuditTrail(array $batch, $rows, float $award): void
    {
        try {
            \App\Models\AuditTrailLog::create([
                'old_details' => [
                    'type'  => 'agent_incentive_history',
                    'event' => 'quota_batch_paid',
                    'agent_id'     => $batch['agent_id'],
                    'batch_number' => $batch['batch_number'],
                    'amount'       => $award,
                    'job_order_ids' => $rows->pluck('job_order_id')->all(),
                ],
                'new_details' => [
                    'type'  => 'agent_incentive_history',
                    'event' => 'quota_batch_reversed',
                    'reason' => 'A job order inside the completed quota was abandoned '
                        . '(Failed or Cancelled) after the incentive was awarded.',
                    'agent_id'      => $batch['agent_id'],
                    'batch_number'  => $batch['batch_number'],
                    'amount_reversed' => $award,
                    'abandoned_job_order_ids' => $batch['job_orders'],
                ],
                'created_by_user' => 'System (' . $this->logName . ')',
                'updated_by_user' => 'System (' . $this->logName . ')',
            ]);
        } catch (Throwable $e) {
            $this->writeLog('  [WARN] Reversal audit entry could not be written: ' . $e->getMessage());
        }
    }

    /**
     * Evaluate and (if the quota is reached) award incentives for a single agent.
     */
    private function processAgent(object $balance, array &$summary, int $counter = 0, int $total = 0): void
    {
        $agentId           = (int) $balance->agent_id;
        $quota             = (int) ($balance->quota ?? 0);
        $incentiveValue    = (float) ($balance->incentives_value ?? 0);
        $currentIncentives = (float) ($balance->incentives ?? 0);

        // Resolve the agent's name (job orders are matched by full name).
        $user = DB::table('users')->where('id', $agentId)->first();
        if (!$user) {
            $summary['skipped']++;
            $this->runLog->skipped((string) $agentId);
            $this->writeLog("  [SKIP] Agent #{$agentId}: no matching user record");
            $this->writeLog("[{$counter}/{$total}] ⊘ SKIPPED");
            return;
        }

        $agentName = $this->buildFullName($user);
        $this->writeLog("  [AGENT] {$agentName} (#{$agentId})");
        $this->writeLog("  [CONFIG] Quota: {$quota} | Incentive Value: " . number_format($incentiveValue, 2) . " | Current Incentives: " . number_format($currentIncentives, 2));

        // Nothing to do if the agent is not configured for incentives.
        if ($quota <= 0 || $incentiveValue <= 0) {
            $summary['skipped']++;
            $this->runLog->skipped((string) $agentId);
            $this->writeLog("  [SKIP] Quota or incentive value not configured — nothing to award");
            $this->writeLog("[{$counter}/{$total}] ⊘ SKIPPED");
            return;
        }

        $nameVariants = $this->nameVariants($user);

        // Referrals made through the agent picker are stored as the agent's user
        // id rather than their name, so the id is matched alongside the name
        // variants. Without it every referral made since the picker started
        // writing ids would earn this agent no quota progress at all — the value
        // holds none of the words the LIKEs below look for.
        $taggedId = \App\Support\AgentReferral::encode($user->id ?? null);

        if (empty($nameVariants) && $taggedId === null) {
            $summary['skipped']++;
            $this->runLog->skipped((string) $agentId);
            $this->writeLog("  [SKIP] Unable to build a name to match job orders");
            $this->writeLog("[{$counter}/{$total}] ⊘ SKIPPED");
            return;
        }
        $this->writeLog("  [MATCH] Matching job orders via referred_by: "
            . implode(' | ', array_filter(array_merge($nameVariants, [$taggedId]))));

        // Base query for this agent's countable job orders, matched by the
        // related application's referred_by — the agent's id where the referral
        // was made through the picker, their name where it is older free text.
        //
        // A job order counts when EITHER is true:
        //
        //   • its onsite status is "Done" — the install finished, or
        //   • it is marked pre-installed, whatever its onsite status says.
        //
        // The second is what lets a referral earn quota progress before the
        // install itself is finished: the agent's work of bringing the customer
        // in is done once the site has been pre-installed, and holding the
        // referral back until the technician closes the job order would delay a
        // payout the agent has already earned.
        //
        // Counting it early does NOT mean counting it twice. A job order taken
        // into a completed quota is written to agent_incentive_history in the
        // same transaction that pays it, and the whereNotExists below can never
        // see it again — so when the install later flips to "Done" it is not
        // picked up a second time. The UNIQUE key on job_order_id is the
        // backstop if two runs ever race for it.
        $completedBase = DB::table('job_orders')
            ->join('applications', 'job_orders.application_id', '=', 'applications.id')
            ->where(function ($q) {
                // "done" AND "completed", matching achievement progress
                // (CommissionController::onboardedReferralIds) and the weekly
                // invoice run (AgentInvoiceService::billableCustomers). This
                // clause used to accept "done" alone, so a job order closed as
                // "Completed" moved an agent's achievement count and was
                // billed, but earned no quota progress at all — three parts of
                // one scheme disagreeing about what "onboarded" means.
                $q->whereIn(DB::raw('LOWER(TRIM(job_orders.onsite_status))'), self::SUCCESSFUL_ONSITE_STATUSES)
                  // The pre-installation marker, which lets a referral earn
                  // quota progress before the technician closes the install —
                  // the agent's part is done once the site has been prepared.
                  //
                  // ...unless the job order has since been abandoned. The marker
                  // used to be an unqualified OR, so a site that was
                  // pre-installed and then FAILED still completed a quota and
                  // paid the incentive. Every other part of the scheme pays
                  // nothing for a failed job — commission needs approval,
                  // achievements and invoice lines need Done — so this was the
                  // one path that paid for a customer who never arrived.
                  //
                  // The abandoned list is derived from the model's own
                  // "finished for good" statuses so the two cannot drift.
                  ->orWhere(function ($p) {
                      $p->whereRaw('LOWER(TRIM(job_orders.pre_installed)) = ?', ['preinstalled'])
                        // COALESCE so a pre-installed job order with no status
                        // yet still counts; only an explicit failure excludes it.
                        ->whereNotIn(
                            DB::raw("LOWER(TRIM(COALESCE(job_orders.onsite_status, '')))"),
                            self::abandonedOnsiteStatuses()
                        );
                  });
            })
            ->where(function ($q) use ($nameVariants, $taggedId) {
                // Matched as a whole value, not a fragment: an id is exact, and
                // a LIKE on it would let "agent:3" also match "agent:37".
                if ($taggedId !== null) {
                    $q->orWhere('applications.referred_by', $taggedId);
                }
                foreach ($nameVariants as $variant) {
                    $q->orWhereRaw('LOWER(applications.referred_by) LIKE ?', ['%' . $variant . '%']);
                }
            });

        // Referrals onboarded before the programme began earn nothing. Applied
        // to the base query so they are neither awarded nor reported as skipped
        // — they are not part of this scheme at all.
        //
        // The installation date decides when a referral counts, falling back to
        // when the job order was raised, exactly as achievement progress decides
        // it — so an agent's incentive and their achievement count can never
        // disagree about which referrals are in scope.
        $startDate = self::startDate();
        if ($startDate !== null) {
            $completedBase->whereRaw(
                \App\Support\AgentProgramme::onboardedAtSql('job_orders') . ' >= ?',
                [$startDate->format('Y-m-d H:i:s')]
            );
            $this->writeLog("  [SCOPE] Counting referrals onboarded on or after {$startDate->format('Y-m-d')}");
        }

        // Total countable (for logging how many are skipped because already processed).
        $totalCompleted = (clone $completedBase)->count();

        // Only the countable job orders NOT yet recorded in history are available.
        //
        // Each carries the incentive value it was approved at. That snapshot is
        // what the award is built from, so an administrator raising the rate
        // tomorrow does not restate work already settled at the old one.
        $countable = (clone $completedBase)
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('agent_incentive_history as aih')
                    ->whereColumn('aih.job_order_id', 'job_orders.id');
            })
            ->orderBy('job_orders.id', 'asc')
            ->get(['job_orders.id', 'job_orders.incentive_value']);

        $jobOrderIds = [];
        // job order id => the rate it was approved at.
        $rateFor = [];

        foreach ($countable as $row) {
            $id = (int) $row->id;
            $jobOrderIds[] = $id;

            // A job order approved before the snapshot column existed has no
            // rate of its own; the agent's current one stands in, which is the
            // behaviour this cron had before snapshots were introduced.
            $rateFor[$id] = $row->incentive_value !== null && (float) $row->incentive_value > 0
                ? (float) $row->incentive_value
                : $incentiveValue;
        }

        $available        = count($jobOrderIds);
        $alreadyProcessed = max(0, $totalCompleted - $available);

        $this->writeLog("  [QUERY] Countable (done or pre-installed): {$totalCompleted} | Already processed (skipped): {$alreadyProcessed} | New & countable: {$available}");
        if ($alreadyProcessed > 0) {
            $summary['skipped_job_orders'] = ($summary['skipped_job_orders'] ?? 0) + $alreadyProcessed;
        }

        // How many full quota cycles can we award right now?
        $cycles = intdiv($available, $quota);

        if ($cycles < 1) {
            // Progress only — not enough to award yet.
            //
            // Nothing is written and nothing is discarded. These job orders stay
            // absent from agent_incentive_history, so the NEXT run finds exactly
            // the same ones plus whatever arrived since, and counts them all
            // toward this same quota. Naming them makes that checkable: the same
            // IDs should reappear in the next run's log.
            $summary['job_orders_carried'] += $available;

            $this->writeLog("  [PROGRESS] {$available}/{$quota} toward next incentive — quota not reached, no award");
            if ($available > 0) {
                $this->writeLog("  [CARRY] Kept for the next run (not reset): job order ID(s) " . implode(', ', $jobOrderIds));
            }
            $this->runLog->record('CARRIED', (string) $agentId);
            $this->writeLog("[{$counter}/{$total}] ✓ DONE (no award)");
            return;
        }

        // Only the job orders that actually contribute to a full cycle are processed.
        // Any remainder stays unprocessed and carries over to the next run.
        $processCount  = $cycles * $quota;
        $idsToProcess  = array_slice($jobOrderIds, 0, $processCount);

        // Reaching the quota is what earns the incentive, so a completed cycle
        // pays the incentive value ONCE — not once per referral in it. A quota
        // of 10 at 100 earns 100 per completed quota, not 1,000.
        //
        // The rate applied is the one carried by the job order that COMPLETED
        // the cycle, so a batch pays what was in force at the moment the quota
        // was reached. Job orders are consumed oldest-first, so that is the
        // most recent referral in the batch.
        $awardForCycle = function (array $cycleIds) use ($rateFor): float {
            if (empty($cycleIds)) {
                return 0.0;
            }
            $completingId = end($cycleIds);
            return round((float) ($rateFor[$completingId] ?? 0.0), 2);
        };

        // Worked out per cycle up front: the same figures drive the log, the
        // ledger rows and the balance, so the three cannot drift apart.
        $cycleAwards = [];
        for ($c = 0; $c < $cycles; $c++) {
            $cycleAwards[$c] = $awardForCycle(array_slice($idsToProcess, $c * $quota, $quota));
        }

        $totalAward = round(array_sum($cycleAwards), 2);
        $awardStr      = number_format($totalAward, 2, '.', ''); // numeric-only, safe for raw SQL
        $now           = Carbon::now();
        $orgId         = $balance->organization_id ?? null;

        // Batches are numbered per-agent and keep incrementing across runs so the
        // history reads as batch 1, 2, 3, … over the agent's lifetime. Each full
        // quota cycle awarded in this run gets its own consecutive batch number.
        $lastBatch  = (int) DB::table('agent_incentive_history')
            ->where('agent_id', $agentId)
            ->max('batch_number');
        $startBatch = $lastBatch + 1;
        $endBatch   = $startBatch + $cycles - 1;

        $this->writeLog("  [CALC] Quota reached x{$cycles} → awarding " . number_format($totalAward, 2)
            . " (the incentive value once per completed quota of {$quota}, not once per job order)"
            . " — batch(es) {$startBatch}" . ($cycles > 1 ? "-{$endBatch}" : ""));

        // Per-cycle detail (auditable, mirrors AutoDisconnect's per-item logging).
        for ($c = 0; $c < $cycles; $c++) {
            $cycleIds     = array_slice($idsToProcess, $c * $quota, $quota);
            $batchNumber  = $startBatch + $c;
            $completingId = end($cycleIds);
            $this->writeLog("    [BATCH {$batchNumber}] (cycle " . ($c + 1) . "/{$cycles}) +" . number_format($cycleAwards[$c], 2)
                . " (quota of " . count($cycleIds) . " completed by job order #{$completingId})"
                . " for job order ID(s): " . implode(', ', $cycleIds));
        }

        $this->writeLog("  [DB] Recording {$processCount} job order(s) to agent_incentive_history and updating balance...");

        // All-or-nothing per agent: record the ledger rows and bump the balance
        // together. If the history insert collides (UNIQUE job_order_id) the whole
        // award rolls back, so a Job Order can never be paid without being recorded.
        DB::transaction(function () use ($idsToProcess, $quota, $cycleAwards, $orgId, $now, $balance, $awardStr, $startBatch) {
            $rows = [];
            foreach ($idsToProcess as $index => $jobOrderId) {
                // Every $quota job orders form one cycle → the next batch number.
                $cycleIndex  = intdiv($index, $quota);
                $batchNumber = $startBatch + $cycleIndex;

                // The award belongs to the cycle, not to each job order in it.
                // It is recorded against the job order that COMPLETED the cycle
                // — the one whose arrival earned it — and the rest of the batch
                // carries 0. Every job order is still recorded (that is what
                // stops it being counted twice), and summing the column over the
                // history reproduces the balance exactly.
                $completesCycle = (($index + 1) % $quota) === 0;

                $rows[] = [
                    'agent_id'        => (int) $balance->agent_id,
                    'job_order_id'    => $jobOrderId,
                    'quota_reached'   => $quota,
                    // (agent_id, batch_number) is what says "these customers
                    // are the ones that completed THIS quota" — the record the
                    // invoice run and any later audit read to tie a payout back
                    // to the customers that earned it.
                    'batch_number'    => $batchNumber,
                    'incentive_value' => $completesCycle ? ($cycleAwards[$cycleIndex] ?? 0.0) : 0.0,
                    'organization_id' => $orgId,
                    // When the quota was reached. The weekly invoice run bills
                    // by this, so it is what decides which invoice period a
                    // completed quota belongs to.
                    'processed_at'    => $now,
                    // agent_invoice_id / invoiced_at are left NULL: earned, not
                    // yet billed. The weekly run claims them exactly once.
                    'created_at'      => $now,
                    'updated_at'      => $now,
                ];
            }

            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('agent_incentive_history')->insert($chunk);
            }

            // COALESCE guards against a NULL incentives column and avoids a stale read.
            DB::table('agent_balance')
                ->where('id', $balance->id)
                ->update([
                    'incentives' => DB::raw("COALESCE(incentives, 0) + {$awardStr}"),
                    'updated_at' => $now,
                ]);
        });

        $newIncentives = $currentIncentives + $totalAward;

        $summary['agents_awarded']++;
        $summary['incentive_awards']    += $cycles;
        $summary['amount_awarded']      += $totalAward;
        $summary['job_orders_recorded'] += $processCount;

        $this->writeLog("  [DB] ✓ COMMIT SUCCESSFUL");
        $this->writeLog("  [AWARD] Incentives: " . number_format($currentIncentives, 2) . " → " . number_format($newIncentives, 2) . " (+" . number_format($totalAward, 2) . ")");
        if ($available > $processCount) {
            // The remainder that did not make up a full quota. Left unrecorded
            // on purpose, so it becomes the opening progress of the next quota
            // rather than being thrown away.
            $carried = array_slice($jobOrderIds, $processCount);
            $summary['job_orders_carried'] += count($carried);
            $this->writeLog("  [CARRY] " . count($carried) . " completed job order(s) carried over to next run (not reset): job order ID(s) " . implode(', ', $carried));
        }
        $this->runLog->processed((string) $agentId);
        $this->writeLog("  [COMPLETE] {$agentName} (#{$agentId}) — awarded incentive x{$cycles}, recorded {$processCount} job order(s)");
        $this->writeLog("[{$counter}/{$total}] ✓ SUCCESS");
    }

    /**
     * Build all lowercased name variants used to match against applications.referred_by.
     * Mirrors the matching used by CommissionController for consistency.
     */
    private function nameVariants(object $user): array
    {
        $first  = trim((string) ($user->first_name ?? ''));
        $middle = trim((string) ($user->middle_initial ?? ''));
        $last   = trim((string) ($user->last_name ?? ''));

        $variants = [];

        // first last
        $simple = trim($first . ' ' . $last);
        if ($simple !== '') {
            $variants[] = strtolower($simple);
        }

        // first M. last  (matches the User::full_name accessor format)
        $full = trim($first . ' ' . ($middle !== '' ? $middle . '. ' : '') . $last);
        if ($full !== '') {
            $variants[] = strtolower($full);
        }

        return array_values(array_unique(array_filter($variants)));
    }

    /**
     * Human-readable full name for logging.
     */
    private function buildFullName(object $user): string
    {
        $first  = trim((string) ($user->first_name ?? ''));
        $middle = trim((string) ($user->middle_initial ?? ''));
        $last   = trim((string) ($user->last_name ?? ''));
        $name   = trim($first . ' ' . ($middle !== '' ? $middle . '. ' : '') . $last);

        return $name !== '' ? $name : ('Agent #' . ($user->id ?? '?'));
    }

    /**
     * Emit the run's agent lists, then clear them.
     *
     * Written through writeLog() like everything else — the summary marker is what carries
     * these lines past the error filter, so they stay in the file when the narration does
     * not. Cleared afterwards so a second run on the same instance cannot inherit the
     * first one's agents.
     */
    private function writeRunSummary(): void
    {
        foreach ($this->runLog->summaryLines() as $line) {
            $this->writeLog($line);
        }

        $this->runLog->reset();
    }

    /**
     * Write to a dedicated log file (and mirror to the default log).
     */
    private function writeLog(string $message): void
    {
        // Errors and run summaries only - see App\Support\CronLog. This is a raw
        // file write, so LOG_LEVEL never reached it and the narration accumulated
        // no matter how the channels were configured.
        if (!CronLog::shouldWrite($message)) {
            return;
        }

        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";

        $logDir = storage_path('logs/agentincentives');
        $logFile = $logDir . '/agent_incentives.log';

        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }

        file_put_contents($logFile, $logMessage . PHP_EOL, FILE_APPEND);
        // Only faults are mirrored, and as ->error(). Every line used to be
        // duplicated into laravel.log at info level, which doubled the volume
        // and misreported the severity of all of it.
        if (CronLog::isError($message)) {
            Log::channel('single')->error("[{$this->logName}] {$message}");
        }
    }
}
