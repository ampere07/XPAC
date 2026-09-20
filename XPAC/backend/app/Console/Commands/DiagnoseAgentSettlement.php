<?php

namespace App\Console\Commands;

use App\Models\JobOrder;
use App\Support\AgentProgramme;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Explain why a job order did or did not settle with a referring agent.
 *
 * Approving a job order is supposed to fill in commission_status,
 * commission_value, incentive_value, agent_paid_at and agent_paid_to. When they
 * are all NULL there are several quite different reasons, and the row itself
 * looks identical in every case:
 *
 *   • the job order was never approved (settlement happens at approval, NOT
 *     when the install is marked Done on site)
 *   • it was approved before this feature was deployed
 *   • it has no referred_by, so there is nobody to pay
 *   • it HAS a referred_by, but no agent matches the name
 *   • an agent matches, but holds no agent_balance row, which is what defines
 *     an agent everywhere in this module
 *
 * This walks the exact resolution JobOrderAgentPaymentService::settle() walks
 * and reports where it stops. READ ONLY — it never writes, never pays, and
 * never marks anything settled.
 *
 *     php artisan agents:diagnose-settlement 9657
 *     php artisan agents:diagnose-settlement 9657 --show-agents
 */
class DiagnoseAgentSettlement extends Command
{
    protected $signature = 'agents:diagnose-settlement
                            {job_order : The job_orders.id to explain}
                            {--show-agents : Also list every agent the referral was compared against}';

    protected $description = 'Explain why a job order did or did not settle a commission with its referring agent (read only).';

    public function handle(): int
    {
        $id = (int) $this->argument('job_order');

        $jobOrder = JobOrder::find($id);
        if (!$jobOrder) {
            $this->error("No job order with id {$id}.");
            return self::FAILURE;
        }

        $this->line('');
        $this->info("Job order #{$id}");
        $this->line(str_repeat('-', 60));

        // ---- 1. Has it actually been approved? --------------------------
        //
        // The commonest false alarm. `onsite_status = Done` means the install
        // finished on site; it does NOT mean the job order was approved.
        // Approval is what creates the billing account and what settles the
        // agent, and it stamps billing_status and account_id.
        $onsite   = (string) ($jobOrder->onsite_status ?? '');
        $billing  = (string) ($jobOrder->billing_status ?? '');
        $accountId = $jobOrder->account_id;
        $approved = strcasecmp(trim($billing), 'done') === 0 && $accountId !== null;

        $this->line('  onsite_status:     ' . ($onsite !== '' ? $onsite : 'NULL'));
        $this->line('  billing_status:    ' . ($billing !== '' ? $billing : 'NULL'));
        $this->line('  account_id:        ' . ($accountId ?? 'NULL'));
        $this->line('  approved:          ' . ($approved ? 'YES' : 'NO'));

        $this->line('');
        $this->line('  commission_status: ' . ($jobOrder->commission_status ?? 'NULL'));
        $this->line('  commission_value:  ' . ($jobOrder->commission_value ?? 'NULL'));
        $this->line('  incentive_value:   ' . ($jobOrder->incentive_value ?? 'NULL'));
        $this->line('  agent_paid_at:     ' . ($jobOrder->agent_paid_at ?? 'NULL'));
        $this->line('  agent_paid_to:     ' . ($jobOrder->agent_paid_to ?? 'NULL'));
        $this->line('');

        if ($jobOrder->agent_paid_at !== null) {
            $this->info('VERDICT: already settled. Nothing further would be paid — agent_paid_at is what');
            $this->info('         stops a second approval paying twice.');
            return self::SUCCESS;
        }

        if (!$approved) {
            $this->warn('VERDICT: this job order has NOT been approved.');
            $this->line('');
            $this->line('  Settlement happens at approval, not when the install is marked Done on');
            $this->line('  site. Until POST /job-orders/' . $id . '/approve runs, these columns are');
            $this->line('  correctly NULL and there is nothing wrong with the row.');
            $this->line('');
            $this->line('  Approve it and run this command again to see the settlement.');
            return self::SUCCESS;
        }

        // ---- 2. Is there a referral at all? -----------------------------
        $referredBy = optional($jobOrder->application)->referred_by;
        if (!$referredBy && $jobOrder->application_id) {
            $referredBy = DB::table('applications')->where('id', $jobOrder->application_id)->value('referred_by');
        }
        $referredBy = trim((string) $referredBy);

        $this->line('  application_id:    ' . ($jobOrder->application_id ?? 'NULL'));
        $this->line('  referred_by:       ' . ($referredBy !== '' ? '"' . $referredBy . '"' : 'EMPTY'));
        $this->line('');

        if ($referredBy === '') {
            $this->warn('VERDICT: no referred_by on the application.');
            $this->line('');
            $this->line('  Nobody referred this customer, so there is no agent to pay. A walk-in or');
            $this->line('  direct sign-up reaches exactly this state and it is not an error.');
            return self::SUCCESS;
        }

        // ---- 3. Does the referral resolve to an agent? -------------------
        //
        // An agent is a user holding an agent_balance row — the same definition
        // the incentive cron, the achievements and the weekly invoices use.
        $candidates = DB::table('users as u')
            ->join('agent_balance as ab', 'ab.agent_id', '=', 'u.id')
            ->select('u.id', 'u.first_name', 'u.middle_initial', 'u.last_name', 'u.email_address')
            ->get();

        $this->line('  agents on the roster (users JOIN agent_balance): ' . $candidates->count());

        if ($candidates->isEmpty()) {
            $this->line('');
            $this->error('VERDICT: there are NO agents on the roster at all.');
            $this->line('');
            $this->line('  Every user with an agent_balance row is an agent; there are none, so no');
            $this->line('  referral can ever match and nothing will ever settle. Give the referring');
            $this->line('  user an agent_balance row (agent_id = their users.id) and re-approve.');
            return self::SUCCESS;
        }

        $matched = null;
        $rows    = [];

        foreach ($candidates as $candidate) {
            $fullName = trim(preg_replace('/\s+/', ' ', trim(
                ($candidate->first_name ?? '') . ' ' . ($candidate->last_name ?? '')
            )));

            $isMatch = AgentProgramme::referralBelongsToAgent(
                $referredBy,
                $fullName,
                trim((string) ($candidate->email_address ?? '')),
                $candidate->id
            );

            if ($isMatch && $matched === null) {
                $matched = $candidate;
            }

            $rows[] = [$candidate->id, $fullName, $candidate->email_address ?? '', $isMatch ? 'MATCH' : ''];
        }

        if ($this->option('show-agents')) {
            $this->line('');
            $this->table(['user id', 'name matched against', 'email', 'result'], $rows);
        }

        $this->line('');

        if (!$matched) {
            $this->error('VERDICT: no matching agent for "' . $referredBy . '".');
            $this->line('');
            $this->line('  The matcher requires EVERY word of an agent\'s "first_name last_name" to');
            $this->line('  appear in the referral, or an exact email match. Nothing on the roster');
            $this->line('  satisfies that, so settle() writes nothing and the approval still succeeds.');
            $this->line('');
            $this->line('  Usual causes:');
            $this->line('   • the referral names a TEAM, not an agent  (php artisan agents:export-team-referrals)');
            $this->line('   • that person has no user account, or no agent_balance row');
            $this->line('   • the account name differs from what was typed (nickname, spelling, extra word)');
            $this->line('');
            $this->line('  Re-run with --show-agents to see every name it was compared against.');
            return self::SUCCESS;
        }

        $agentName = trim(($matched->first_name ?? '') . ' ' . ($matched->last_name ?? ''));
        $this->info('  matched agent:     ' . $agentName . ' (user #' . $matched->id . ')');

        // ---- 4. Does that agent have a balance row to credit? ------------
        $balance = DB::table('agent_balance')->where('agent_id', $matched->id)->first();

        if (!$balance) {
            $this->line('');
            $this->error('VERDICT: agent has no balance record.');
            $this->line('');
            $this->line('  The name resolved, but there is no agent_balance row for agent_id='
                . $matched->id . ',');
            $this->line('  so there is nothing to credit and settle() stops here.');
            return self::SUCCESS;
        }

        $this->line('  agent_balance:     id=' . $balance->id
            . ' commission=' . ($balance->commission ?? 'NULL')
            . ' quota=' . ($balance->quota ?? 'NULL')
            . ' incentives_value=' . ($balance->incentives_value ?? 'NULL'));

        $this->line('');
        $this->info('VERDICT: this job order SHOULD settle on approval.');
        $this->line('');
        $this->line('  Every guard passes: approved, a referral is recorded, it resolves to an');
        $this->line('  agent, and that agent holds a balance row. Since agent_paid_at is still');
        $this->line('  NULL, the most likely explanation is that it was approved BEFORE this');
        $this->line('  feature was deployed — settlement only ever happens at the moment of');
        $this->line('  approval and is never applied retroactively.');
        $this->line('');
        $this->line('  Nothing has been written by this command.');

        return self::SUCCESS;
    }
}
