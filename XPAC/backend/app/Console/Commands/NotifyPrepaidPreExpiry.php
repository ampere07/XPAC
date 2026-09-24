<?php

namespace App\Console\Commands;

use App\Models\BillingAccount;
use App\Models\BillingConfig;
use App\Models\SmsQueue;
use App\Services\EnhancedBillingGenerationServiceWithNotifications;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Run — or just inspect — the prepaid PRE-expiry warning scan on demand.
 *
 * The scan itself lives in EnhancedBillingGenerationServiceWithNotifications and normally runs as
 * one step inside cron:generate-daily-billings at 01:00. That made it impossible to answer "why did
 * no pre-expiry SMS go out?" without waiting a day: the only trigger was a cron that also generates
 * bills, so nobody could safely fire it by hand.
 *
 * --dry-run reports exactly what the scan WOULD do — the configured window, whether the supporting
 * migration and SMS template are in place, and every account that qualifies with the reason it does
 * or does not — and queues nothing. Running it for real is safe to repeat: queueing is idempotent
 * on (account, contact, message, time_sent), so a second run cannot text a customer twice.
 */
class NotifyPrepaidPreExpiry extends Command
{
    protected $signature = 'billing:notify-prepaid-pre-expiry
                            {--dry-run : Report what would be warned without queueing anything}
                            {--date= : Run the scan as if today were this date (Y-m-d), for testing}';

    protected $description = 'Warn prepaid customers whose service period is about to lapse (SMS only, raises no bill)';

    protected EnhancedBillingGenerationServiceWithNotifications $billingService;

    public function __construct(EnhancedBillingGenerationServiceWithNotifications $billingService)
    {
        parent::__construct();
        $this->billingService = $billingService;
    }

    public function handle(): int
    {
        $date = $this->option('date');

        try {
            $generationDate = $date ? Carbon::parse($date) : Carbon::now();
        } catch (\Throwable $e) {
            $this->error("Could not parse --date='{$date}': " . $e->getMessage());

            return Command::FAILURE;
        }

        $this->line("Prepaid pre-expiry scan for {$generationDate->toDateTimeString()}");
        $this->newLine();

        $this->reportPreconditions();

        if ($this->option('dry-run')) {
            return $this->dryRun($generationDate);
        }

        try {
            $results = $this->billingService->notifyPrepaidPreExpiryAccounts($generationDate);
        } catch (\Throwable $e) {
            $this->error('Prepaid pre-expiry scan failed: ' . $e->getMessage());

            return Command::FAILURE;
        }

        $this->info(sprintf(
            'Warned: %d   Skipped: %d   Failed: %d',
            $results['success'],
            $results['skipped'],
            $results['failed']
        ));

        foreach ($results['errors'] as $error) {
            $this->warn("  {$error['account_no']}: {$error['error']}");
        }

        $this->newLine();
        $this->line('Queued messages are sent by cron:process-email-queue once their time_sent falls due.');
        $this->line('Pending in sms_queue right now: ' . SmsQueue::where('status', 'pending')->count());

        return $results['failed'] > 0 ? Command::FAILURE : Command::SUCCESS;
    }

    /**
     * The three things that silently produce "no SMS at all", each reported explicitly.
     */
    private function reportPreconditions(): void
    {
        $configured = BillingConfig::first()?->prepaid_pre_expiry_days;

        if (!Schema::hasColumn('billing_config', 'prepaid_pre_expiry_days')) {
            $this->warn('billing_config.prepaid_pre_expiry_days is MISSING — run: php artisan migrate');
        } elseif (!is_numeric($configured)) {
            $this->warn('billing_config.prepaid_pre_expiry_days is not set — falling back to the 3-day default.');
        } elseif ((int) $configured <= 0) {
            $this->error('billing_config.prepaid_pre_expiry_days is 0 — the pre-expiry warning is DISABLED. Set it on the Billing Configuration page.');
        } else {
            $this->info("Warning window: {$configured} day(s) before expiry.");
        }

        if (!Schema::hasColumn('billing_accounts', 'prepaid_pre_expiry_notified_for')) {
            $this->warn('billing_accounts.prepaid_pre_expiry_notified_for is MISSING — run: php artisan migrate');
        }

        $template = DB::table('sms_templates')
            ->where('template_type', 'PrepaidPreExpiry')
            ->where('is_active', 1)
            ->first();

        if ($template) {
            $this->info('SMS template: PrepaidPreExpiry (active).');
        } else {
            $this->warn('No active PrepaidPreExpiry template — using the built-in standardized pre-expiry message.');
        }

        if (!Schema::hasColumn('sms_queue', 'dedupe_key')) {
            $this->warn('sms_queue.dedupe_key is MISSING — queueing is not idempotent until you run: php artisan migrate');
        }

        $this->newLine();
    }

    /**
     * Reproduces the scan's own selection so the report cannot drift from what the scan does:
     * same window, same prepaid aliases, same marker check, same renewal quote.
     */
    private function dryRun(Carbon $generationDate): int
    {
        $configured = BillingConfig::first()?->prepaid_pre_expiry_days;
        $preExpiryDays = is_numeric($configured) ? (int) $configured : 3;

        if ($preExpiryDays <= 0) {
            $this->error('Nothing would be warned — the window is 0 days.');

            return Command::SUCCESS;
        }

        $windowEnd = $generationDate->copy()->addDays($preExpiryDays)->endOfDay();
        $hasMarker = Schema::hasColumn('billing_accounts', 'prepaid_pre_expiry_notified_for');

        $accounts = BillingAccount::with(['customer', 'plan'])
            ->whereIn('generation_type', BillingAccount::PREPAID_ALIASES)
            ->whereNotNull('prepaid_expires_at')
            ->whereBetween('prepaid_expires_at', [$generationDate, $windowEnd])
            ->whereNotNull('account_no')
            ->get();

        $this->line("Window: {$generationDate->toDateTimeString()} .. {$windowEnd->toDateTimeString()}");
        $this->line("Prepaid accounts inside the window: {$accounts->count()}");
        $this->newLine();

        if ($accounts->isEmpty()) {
            return Command::SUCCESS;
        }

        $rows = [];

        foreach ($accounts as $account) {
            $expiry = Carbon::parse($account->prepaid_expires_at);
            $amount = $this->billingService->quotePrepaidRenewalAmount($account);
            $contact = $account->customer?->contact_number_primary;

            $verdict = 'WOULD WARN';

            if ($hasMarker
                && $account->prepaid_pre_expiry_notified_for
                && Carbon::parse($account->prepaid_pre_expiry_notified_for)->toDateTimeString() === $expiry->toDateTimeString()
            ) {
                $verdict = 'skip: already warned';
            } elseif (empty($contact)) {
                $verdict = 'skip: no contact number';
            }

            $rows[] = [
                $account->account_no,
                $expiry->toDateTimeString(),
                number_format($amount, 2),
                $contact ?: '-',
                $verdict,
            ];
        }

        $this->table(['Account No', 'Expires At', 'Renewal', 'Contact', 'Verdict'], $rows);
        $this->newLine();
        $this->line('Dry run — nothing was queued.');

        return Command::SUCCESS;
    }
}
