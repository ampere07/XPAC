<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     *
     * @param  \Illuminate\Console\Scheduling\Schedule  $schedule
     * @return void
     */
    protected function schedule(Schedule $schedule)
    {
        // ===================================================================
        // BILLING GENERATION (DEDICATED CRON JOB)
        // ===================================================================
        
        // Generate daily billings at 1:00 AM every day
        // Uses: EnhancedBillingGenerationServiceWithNotifications
        // Dependencies: BillingNotificationService, EmailQueueService, 
        //               GoogleDrivePdfGenerationService, ItexmoSmsService
        // Logs: storage/logs/billing/billinggeneration.log
        $schedule->command('cron:generate-daily-billings')
                 ->dailyAt('01:00')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Billing generation cron completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Billing generation cron failed');
                 });

        // ===================================================================
        // BILLING NOTIFICATIONS
        // ===================================================================

        // Send overdue notices at 10:00 AM for invoices 1 day past due
        // Uses: BillingNotificationService
        // Dependencies: EmailQueueService, GoogleDrivePdfGenerationService, ItexmoSmsService
        $schedule->command('billing:send-overdue --days=1')
                 ->dailyAt('10:00')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Overdue notices sent successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Overdue notices sending failed');
                 });

        // ===================================================================
        // OVERDUE & DISCONNECTION NOTICES
        // ===================================================================

        // Note: Overdue and Disconnection notices are now generated and sent 
        // as part of the 'cron:generate-daily-billings' command defined above.
        // The previous standalone commands 'cron:process-overdue-notifications'
        // and 'cron:process-disconnection-notices' have been deprecated and removed.

        // ===================================================================
        // AUTO DISCONNECT & PULLOUT
        // ===================================================================

        // Automatically disconnect overdue accounts and create pullout requests
        // Runs at 2:00 AM daily (after billing generation)
        // Uses: AutoDisconnectService, ManualRadiusOperationsService
        // Dependencies: BillingConfig for DC fee and offset settings
        // Disconnects accounts X days overdue (configurable via billing_config.disconnection_day)
        // Creates pullout requests for accounts Y days overdue (configurable via billing_config.pullout_offset)
        // Logs: storage/logs/disconnectionday.log
        $schedule->command('cron:auto-disconnect-pullout')
                 ->dailyAt('02:00')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Auto disconnect/pullout completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Auto disconnect/pullout failed');
                 });

        // ===================================================================
        // VIP ACCOUNTS EXPIRATION CHECK
        // ===================================================================

        // Check VIP accounts for expiration daily at midnight
        // Uses: ManualRadiusOperationsService
        // Logs: storage/logs/vipChecker.log
        $schedule->command('vip:check-expiration')
                 ->dailyAt('00:00')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('VIP expiration check completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('VIP expiration check failed');
                 });

        // ===================================================================
        // EMAIL QUEUE PROCESSING (DEDICATED CRON JOBS)
        // ===================================================================

        // Process pending emails every minute
        // Uses: EmailQueueService via dedicated cron command
        // Dependencies: ResendEmailService
        // Processes up to 50 emails per run
        $schedule->command('cron:process-email-queue')
                 ->everyMinute()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Email queue cron completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Email queue cron failed');
                 });

        // Retry failed emails every 5 minutes
        // Uses: EmailQueueService via dedicated cron command
        // Dependencies: ResendEmailService
        // Retries up to 20 failed emails with max 3 attempts
        $schedule->command('cron:retry-failed-emails')
                 ->everyFiveMinutes()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Failed emails retry cron completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Failed emails retry cron failed');
                 });

        // ===================================================================
        // AUTOMATED REPORTS QUEUING
        // ===================================================================

        // Generate due scheduled reports as PDFs and queue them to the email
        // queue, then sweep stale attachments.
        // Uses: ReportDispatchService -> ReportPdfService, ReportMetricsService
        // Runs every minute so a report can be scheduled to any HH:MM.
        // Exactly-once delivery: each (report, occurrence) pair is claimed in
        // report_dispatches under a UNIQUE index before any email is queued, so
        // overlapping or repeated runs cannot send a report twice.
        // Late runs: an occurrence stays eligible for reports.catch_up_minutes
        // after its scheduled time, so one missed tick does not skip a report
        // for a whole day/month/year.
        // The queued emails are then sent by 'cron:process-email-queue' above.
        // Logs: storage/logs/reports/reports.log
        $schedule->command('reports:queue')
                 ->everyMinute()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     // \Illuminate\Support\Facades\Log::info('Reports queue cron completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Reports queue cron failed');
                 });

        // ===================================================================
        // RADIUS STATUS SYNC
        // ===================================================================

        // Sync RADIUS user status and sessions every minute
        // Uses: RadiusStatusSyncService
        // Dependencies: RadiusConfig, BillingAccounts, TechnicalDetails, OnlineStatus
        // Applies accounts in batches of radius.status_sync.batch_size (default 500)
        // Logs: storage/logs/radiussync/radiussync.log
        //
        // Matches the crontab cadence documented in radius-sync-worker.php, which
        // invokes the same command directly. Extra ticks are not extra work: the
        // command's own Cache::lock plus its heartbeat check stand a run down when
        // one is already in flight, so the two paths cannot sync concurrently.
        $schedule->command('cron:sync-radius-status')
                 ->everyMinute()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('RADIUS status sync completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('RADIUS status sync failed');
                 });

        // ===================================================================
        // RADIUS OPERATION RETRY QUEUE
        // ===================================================================

        // Retry failed RADIUS operations every 2 minutes
        // Uses: RadiusQueueService, ManualRadiusOperationsService
        // Processes up to 20 pending items per run with exponential backoff
        // Logs: storage/logs/radiusrelated.log
        $schedule->command('cron:process-radius-queue')
                 ->everyTwoMinutes()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('RADIUS queue processing completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('RADIUS queue processing failed');
                 });

        // ===================================================================
        // PAYMENT PROCESSING
        // ===================================================================

        // Process pending payments every minute
        // Uses: PaymentWorkerService
        // Dependencies: Xendit API
        //
        // Every minute rather than every two: a customer who has just paid sits with
        // their connection still cut until the pass that posts the payment runs, so the
        // tick interval IS their wait. Halving it halves the complaint window.
        $schedule->command('payments:process')
                 ->everyMinute()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Payment processing completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Payment processing failed');
                 });

        // Retry failed payments daily at 2:00 PM
        // Uses: PaymentWorkerService
        // Dependencies: Xendit API
        $schedule->command('payments:retry-failed')
                 ->dailyAt('14:00')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Failed payments retry completed');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Failed payments retry failed');
                 });

        // ===================================================================
        // AGENT REFERRAL INVOICES
        // ===================================================================

        // One referral invoice per agent team, and one per solo agent, for the
        // calendar week that has just ended (Monday 00:00 to Sunday 23:59). Runs
        // at 00:00 every Monday in the app
        // timezone (config/app.php -> Asia/Manila).
        //
        // Uses: AgentInvoiceService, AgentInvoicePdfService
        // Logs: storage/logs/agent-invoices/Agent_Invoices.log
        //
        // Safe if it runs late or twice: an owner already invoiced for the week
        // is skipped, and the database refuses a customer already billed to
        // them, so a repeat run creates nothing.
        $schedule->command('cron:generate-agent-invoices')
                 ->weeklyOn(1, '00:00')
                 ->timezone(config('app.timezone'))
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Agent invoice generation completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Agent invoice generation failed');
                 });

        // ===================================================================
        // TOOLS SUITE — SmartOLT / MikroTik RADIUS reconciliation
        // ===================================================================

        // SmartOLT: refresh the ONU inventory, align ONU names to their RADIUS
        // usernames by MAC, and unprovision ONUs that have been dark past the
        // threshold.
        // Uses: SmartOltReconciliationService
        // Dependencies: SmartOLT API, MikroTik User Manager REST
        // Logs: storage/logs/smartolt/daily-automation.log
        //
        // Safe if it runs late, twice, or is cut short. Every phase recomputes
        // what is left to do from current state rather than replaying a cursor:
        // an ONU already named for its subscriber is skipped and a deleted ONU
        // is gone from the inventory, so a second run applies nothing. A run
        // stopped by a SmartOLT quota limit checkpoints in `tool_jobs` and the
        // next run resumes from there.
        $schedule->command('cron:smartolt-daily-automation')
                 ->dailyAt('02:15')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('SmartOLT daily automation completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('SmartOLT daily automation failed');
                 });

        // MikroTik RADIUS: adopt missing PPPoE passwords, settle plan groups,
        // enforce restriction on accounts billing has written off.
        // Uses: RadiusReconciliationService
        // Dependencies: MikroTik User Manager REST
        // Logs: storage/logs/radiusreconcile/daily-reconcile.log
        //
        // 03:15 — an hour after the SmartOLT pass so the two never contend for
        // the same RouterOS devices, and after the disconnect sweep so the
        // restriction phase acts on settled billing statuses.
        //
        // Safe if it runs late or twice: every mutation compares current state
        // first and skips when both sides already agree, so a re-run applies
        // nothing. It creates no records and enqueues nothing. Account creation,
        // deletion and duplicate resolution are deliberately NOT automated —
        // they stay in the operator's tool.
        $schedule->command('cron:radius-reconcile-daily')
                 ->dailyAt('03:15')
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('RADIUS daily reconciliation completed successfully');
                 })
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('RADIUS daily reconciliation failed');
                 });

        // Tools suite: advance operator-started background jobs.
        // Uses: SmartOltReconciliationService::driveJobs()
        // Dependencies: SmartOLT API, MikroTik User Manager REST (per job type)
        // Logs: storage/logs/smartolt/tool-jobs.log
        //
        // Every minute, because this is what decouples a sweep from the browser
        // that started it. The tool starts a job and polls its progress; this is
        // what actually advances it, so closing the tab no longer strands a
        // four-thousand-ONU sync partway through.
        //
        // Safe if it runs late, twice, or alongside an operator with the tool
        // still open. It starts no work of its own — it only advances rows that
        // startJob() already created — and each job is claimed with a conditional
        // UPDATE before any step is applied, so no two drivers can ever run the
        // same queue index.
        $schedule->command('cron:tool-jobs-drain')
                 ->everyMinute()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onFailure(function () {
                     \Illuminate\Support\Facades\Log::error('Tool job drain failed');
                 });

        // ===================================================================
        // MAINTENANCE & CLEANUP
        // ===================================================================

        // Cleanup worker locks every hour
        // Prevents stale locks from blocking payment processing
        $schedule->command('worker:cleanup-locks')
                 ->hourly()
                 ->withoutOverlapping()
                 ->runInBackground()
                 ->onSuccess(function () {
                     \Illuminate\Support\Facades\Log::info('Worker locks cleaned up');
                 });

        // ===================================================================
        // TECHNICIAN LIVE LOCATION
        // ===================================================================
        // The stale-location sweep (cron:mark-stale-locations) is invoked directly
        // from the system crontab every minute, e.g.:
        //   * * * * * cd /home/akmcbms/web/backend.atssfiber.ph/public_html && /usr/bin/php artisan cron:mark-stale-locations
        // so it is intentionally NOT registered with the Laravel scheduler here.

        // ===================================================================
        // OPTIONAL: Additional hourly billing checks during business hours
        // Uncomment if you want additional billing generation checks
        // ===================================================================
        // $schedule->command('billing:generate-daily')
        //          ->hourly()
        //          ->between('08:00', '18:00')
        //          ->withoutOverlapping();
    }

    /**
     * Register the commands for the application.
     *
     * @return void
     */
    protected function commands()
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}



