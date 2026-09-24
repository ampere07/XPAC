<?php

namespace App\Services;

use App\Models\BillingAccount;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\StatementOfAccount;
use App\Models\AppPlan;
use App\Models\Discount;
use App\Models\StaggeredInstallation;
use App\Models\AdvancedPayment;
use App\Models\MassRebate;
use App\Models\RebateUsage;
use App\Models\Barangay;
use App\Models\BillingConfig;
use App\Models\Overdue;
use App\Models\DCNotice;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;

class EnhancedBillingGenerationServiceWithNotifications
{
    protected BillingNotificationService $notificationService;
    protected const VAT_RATE = 0.12;

    /** Resolved VAT rate for this instance (billing_config lookup performed once). */
    private ?float $resolvedVatRate = null;

    /**
     * VAT rate to apply during bill generation.
     *
     * Reads billing_config.vat_rate (stored as a fraction, e.g. 0.12 = 12%) and falls back to the
     * historical default (self::VAT_RATE) when no valid rate is configured, so behaviour is
     * unchanged for installs that never set one. Resolved once per instance to avoid a per-account
     * query during a batch run.
     */
    protected function getVatRate(): float
    {
        if ($this->resolvedVatRate !== null) {
            return $this->resolvedVatRate;
        }

        try {
            $configured = \App\Models\BillingConfig::first()?->vat_rate;
        } catch (\Throwable $e) {
            $configured = null;
        }

        $this->resolvedVatRate = (is_numeric($configured) && (float) $configured >= 0)
            ? (float) $configured
            : self::VAT_RATE;

        return $this->resolvedVatRate;
    }

    /**
     * Is VAT applied to this account's plan amount?
     *
     * VAT is a plain boolean now — either the plan price is billed as-is, or VAT is added on top
     * of it. The 'Vat Included' mode (VAT unwrapped out of the plan price) no longer exists.
     *
     * Reads billing_accounts.vat_enabled. Accounts written before that column existed carry NULL,
     * so the legacy free-text vat_type is used as the fallback:
     *
     *   'Excluded Vat' -> true   VAT is added on top, same as before.
     *   'Vat Included' -> false  It already billed a total EQUAL to the plan price, and so does
     *                            "no VAT" — the total is unchanged, only the VAT line becomes 0.
     *   'No Vat'       -> false  Unchanged.
     *   NULL / unknown -> false  Bill exactly the plan price; never invent a 12% surcharge for an
     *                            account nobody configured.
     *
     * Matching is on a lower-cased, letters-only form so 'Excluded Vat', 'VAT Excluded' and
     * 'vat-excluded' all resolve the same way.
     */
    protected function isVatEnabled(BillingAccount $account): bool
    {
        if ($account->vat_enabled !== null) {
            return (bool) $account->vat_enabled;
        }

        $normalized = preg_replace('/[^a-z]/', '', strtolower((string) $account->vat_type));

        return str_contains($normalized, 'exclu');
    }

    /**
     * Split a plan-derived amount (monthly fee + any prorate) into its net / VAT / billable-total
     * components according to whether VAT is enabled on the account.
     *
     *  - VAT off : no VAT is applied at all; the bill is exactly the plan price.
     *              e.g. 1,000        -> net 1,000.00, VAT 0.00, total 1,000.00
     *  - VAT on  : VAT is added ON TOP of the plan price (labelled "VAT Included" in the UI).
     *              e.g. 1,000 @ 12% -> net 1,000.00, VAT 120.00, total 1,120.00
     *
     * The VAT percentage is the one already configured for the system ({@see getVatRate()}).
     * Only the plan portion is VAT-bearing here, exactly as before — staggered installation fees,
     * service charges and deductions are untouched line items.
     *
     * @return array{net: float, vat: float, total: float, vat_enabled: bool, vat_rate: float}
     */
    protected function calculateVatBreakdown(float $planAmount, BillingAccount $account): array
    {
        $vatRate = $this->getVatRate();
        $vatEnabled = $this->isVatEnabled($account);

        $net = $planAmount;
        $vat = $vatEnabled ? $planAmount * $vatRate : 0.0;

        return [
            'net' => $net,
            'vat' => $vat,
            'total' => $net + $vat,
            'vat_enabled' => $vatEnabled,
            'vat_rate' => $vatRate,
        ];
    }

    /**
     * Withholding tax deducted from the bill AFTER VAT has been applied.
     *
     * The base is the VAT-inclusive plan subtotal ({@see calculateVatBreakdown()}'s 'total'), so:
     *
     *   plan 1,000 + VAT 120 = 1,120 subtotal, withholding 5% -> 56.00 -> final 1,064.00
     *
     * Disabled, NULL, zero or negative percentages all deduct nothing, so an account that was
     * never configured for withholding bills exactly as it did before. The percentage is clamped
     * to 100 so a bad value can never turn the bill negative on its own.
     *
     * @return array{enabled: bool, percentage: float, amount: float}
     */
    protected function calculateWithholding(float $baseAmount, BillingAccount $account): array
    {
        $enabled = (bool) $account->withholding_enabled;
        $percentage = is_numeric($account->withholding_percentage)
            ? (float) $account->withholding_percentage
            : 0.0;

        if (!$enabled || $percentage <= 0) {
            return ['enabled' => $enabled, 'percentage' => $percentage, 'amount' => 0.0];
        }

        $percentage = min($percentage, 100.0);

        return [
            'enabled' => true,
            'percentage' => $percentage,
            'amount' => round($baseAmount * ($percentage / 100), 2),
        ];
    }

    /** Fallback VIP status id, matching the hard-coded value in the vip:check-expiration command. */
    protected const BILLING_STATUS_VIP_FALLBACK = 7;

    /** Resolved VIP billing status id (billing_status lookup performed once). */
    private ?int $resolvedVipStatusId = null;

    /**
     * The billing_status id that means "VIP".
     *
     * Looked up by name so a reordered status table cannot silently break the VIP skip, with the
     * historical id as the fallback. Resolved once per instance to avoid a per-account query
     * during a batch run.
     */
    protected function getVipBillingStatusId(): int
    {
        if ($this->resolvedVipStatusId !== null) {
            return $this->resolvedVipStatusId;
        }

        try {
            $configured = DB::table('billing_status')->where('status_name', 'VIP')->value('id');
        } catch (\Throwable $e) {
            $configured = null;
        }

        $this->resolvedVipStatusId = (int) ($configured ?: self::BILLING_STATUS_VIP_FALLBACK);

        return $this->resolvedVipStatusId;
    }

    /**
     * Should this account be skipped entirely by billing generation because it is a VIP?
     *
     * VIP is the account's billing status — the same one the JO Assign Form now sets at approval
     * and that vip:check-expiration flips off once vip_expiration passes. There is no separate
     * VIP flag to keep in sync.
     *
     * A VIP produces NO invoice, NO statement, NO billing record and NO notification — it is
     * simply passed over, and starts billing again as soon as its status is no longer VIP.
     *
     * Most paths never reach this: {@see getActiveAccountsForBillingDay()} already loads only
     * Active accounts. It exists for the two flows that bypass that filter — prepaid renewal and
     * the initial bill raised at approval.
     */
    protected function isVipBillingSuspended(BillingAccount $account): bool
    {
        if ((int) $account->billing_status_id !== $this->getVipBillingStatusId()) {
            return false;
        }

        $this->log('info', 'Skipped billing generation — account is a VIP', [
            'account_no' => $account->account_no,
            'vip_expiration' => $account->vip_expiration,
        ]);

        return true;
    }

    protected const DAYS_IN_MONTH = 30;
    protected const DAYS_UNTIL_DUE = 7;
    protected const DAYS_UNTIL_DC_NOTICE = 4;
    protected const END_OF_MONTH_BILLING = 0;

    public function __construct(BillingNotificationService $notificationService)
    {
        $this->notificationService = $notificationService;
    }
    
    protected function log($level, $message, $context = [])
    {
        Log::channel('billing')->{$level}($message, $context);
    }

    public function generateSOAForBillingDay(int $billingDay, Carbon $generationDate, int $userId): array
    {
        $results = [
            'success' => 0,
            'failed' => 0,
            'skipped' => 0,
            'errors' => [],
            'statements' => [],
            'notifications' => []
        ];

        try {
            $accounts = $this->getActiveAccountsForBillingDay($billingDay, $generationDate);

            foreach ($accounts as $account) {
                try {
                    // Idempotency guard: skip (no new record, no notification) if this
                    // account was already billed for the current cycle.
                    if ($this->statementAlreadyGeneratedForCycle($account, $generationDate)) {
                        $results['skipped']++;
                        $this->log('info', 'Skipped SOA generation — statement already exists for this billing cycle', [
                            'account_no' => $account->account_no,
                            'billing_period' => $generationDate->copy()->setTimezone('Asia/Manila')->format('Y-m')
                        ]);
                        continue;
                    }

                    $statement = $this->createEnhancedStatement($account, $generationDate, $userId);
                    $results['statements'][] = $statement;
                    $results['success']++;

                    $notificationResult = $this->queueNotification($account, null, $statement);
                    $results['notifications'][] = $notificationResult;

                } catch (\Exception $e) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'account_id' => $account->id,
                        'account_no' => $account->account_no,
                        'error' => $e->getMessage()
                    ];
                    $this->log('error', "Failed to generate SOA for account {$account->account_no}: " . $e->getMessage());
                }
            }

            return $results;
        } catch (\Exception $e) {
            $this->log('error', "Error in generateSOAForBillingDay: " . $e->getMessage());
            throw $e;
        }
    }

    public function generateInvoicesForBillingDay(int $billingDay, Carbon $generationDate, int $userId): array
    {
        $results = [
            'success' => 0,
            'failed' => 0,
            'skipped' => 0,
            'errors' => [],
            'invoices' => [],
            'notifications' => []
        ];

        try {
            $accounts = $this->getActiveAccountsForBillingDay($billingDay, $generationDate);

            foreach ($accounts as $account) {
                try {
                    // Idempotency guard: skip (no new record, no notification) if this
                    // account was already billed for the current cycle.
                    if ($this->invoiceAlreadyGeneratedForCycle($account, $generationDate)) {
                        $results['skipped']++;
                        $this->log('info', 'Skipped invoice generation — invoice already exists for this billing cycle', [
                            'account_no' => $account->account_no,
                            'billing_period' => $generationDate->copy()->setTimezone('Asia/Manila')->format('Y-m')
                        ]);
                        continue;
                    }

                    $invoice = $this->createEnhancedInvoice($account, $generationDate, $userId);
                    $results['invoices'][] = $invoice;
                    $results['success']++;

                    $notificationResult = $this->queueNotification($account, $invoice, null);
                    $results['notifications'][] = $notificationResult;

                } catch (\Exception $e) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'account_id' => $account->id,
                        'account_no' => $account->account_no,
                        'error' => $e->getMessage()
                    ];
                    $this->log('error', "Failed to generate invoice for account {$account->account_no}: " . $e->getMessage());
                }
            }

            return $results;
        } catch (\Exception $e) {
            $this->log('error', "Error in generateInvoicesForBillingDay: " . $e->getMessage());
            throw $e;
        }
    }

    protected function queueNotification(
        BillingAccount $account,
        ?Invoice $invoice,
        ?StatementOfAccount $soa
    ): array {
        try {
            $this->log('info', 'Sending notification synchronously', [
                'account_no' => $account->account_no,
                'has_invoice' => $invoice !== null,
                'has_soa' => $soa !== null
            ]);

            // Execute notification synchronously.
            // NOTE: dispatch()->afterResponse() was used previously but it does NOT work
            // in CLI/Artisan context (no HTTP response lifecycle), so notifications were
            // silently never executed during cron jobs.
            // Set the time to send at 8:00 AM GMT+8 (Asia/Manila)
            $timeToSend = Carbon::now('Asia/Manila')->setTime(8, 0, 0)->format('Y-m-d H:i:s');

            $notificationResult = $this->notificationService->notifyBillingGenerated(
                $account,
                $invoice,
                $soa,
                $timeToSend
            );
            
            $this->log('info', 'Notification completed', [
                'account_no' => $account->account_no,
                'email_queued' => $notificationResult['email_queued'] ?? false,
                'sms_sent' => $notificationResult['sms_sent'] ?? false,
                'errors' => $notificationResult['errors'] ?? []
            ]);
            
            return [
                'account_no' => $account->account_no,
                'queued' => true,
                'notification_result' => $notificationResult
            ];
        } catch (\Exception $e) {
            $this->log('error', 'Failed to send notification', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
            
            return [
                'account_no' => $account->account_no,
                'queued' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    protected function getActiveAccountsForBillingDay(int $billingDay, Carbon $generationDate)
    {
        $targetDay = $this->adjustBillingDayForMonth($billingDay, $generationDate);

        $query = BillingAccount::with([
            'customer',
            'technicalDetails',
            'plan'
        ])
            // Active only. This is also what keeps VIP accounts out of scheduled billing: VIP is
            // a billing status of its own, so a VIP is never loaded here and receives no invoice,
            // no statement and no notification. Once vip:check-expiration moves the account off
            // VIP it is picked up again with no manual intervention.
            ->where('billing_status_id', 1)
            ->whereNotNull('date_installed')
            ->whereNotNull('account_no')
            // Prepaid accounts are not billed on the fixed billing-day cadence. Their ONLY bill is
            // the initial one raised at approval (generateInitialBillingForAccount); renewals raise
            // no bill at all, because the amount is settled at checkout from the plan the customer
            // picks (see notifyExpiredPrepaidAccounts). They are therefore excluded from THIS
            // billing-day path only — NOT from the service as a whole. Post Paid and legacy
            // NULL-generation_type accounts bill normally here.
            ->where(function ($q) {
                // Alias list, not a single '!=': a row still spelled 'Pre Paid' must stay excluded
                // from the billing-day path, otherwise a prepaid customer would be billed on the
                // fixed billing day on top of the initial bill they already have.
                $q->whereNotIn('generation_type', BillingAccount::PREPAID_ALIASES)
                  ->orWhereNull('generation_type');
            });

        if ($billingDay === self::END_OF_MONTH_BILLING) {
            $query->where('billing_day', self::END_OF_MONTH_BILLING);
        } else {
            $query->where('billing_day', $targetDay);
        }

        $accounts = $query->get();

        $this->log('info', 'Loaded accounts with complete data', [
            'billing_day' => $billingDay,
            'generation_date' => $generationDate->format('Y-m-d'),
            'accounts_count' => $accounts->count()
        ]);

        return $accounts;
    }

    /**
     * Idempotency guard: has a Statement of Account already been generated for this
     * account in the billing period (month/year) of the generation date?
     *
     * Regular generation only ever runs for Active accounts on their billing day (once
     * per month), so an existing statement in the same period means this cycle was already
     * billed. This keeps the generator safe to run repeatedly (e.g. if the cron fires more
     * than once) without producing duplicate statements or duplicate notifications.
     */
    protected function statementAlreadyGeneratedForCycle(BillingAccount $account, Carbon $generationDate): bool
    {
        $period = $generationDate->copy()->setTimezone('Asia/Manila');

        return StatementOfAccount::where('account_no', $account->account_no)
            ->whereMonth('statement_date', $period->month)
            ->whereYear('statement_date', $period->year)
            ->exists();
    }

    /**
     * Idempotency guard: has an Invoice already been generated for this account in the
     * billing period (month/year) of the generation date?
     *
     * Same rationale as {@see statementAlreadyGeneratedForCycle()} — prevents duplicate
     * invoices (and the duplicate notifications that would follow) when generation runs
     * more than once for the same customer and billing cycle.
     */
    protected function invoiceAlreadyGeneratedForCycle(BillingAccount $account, Carbon $generationDate): bool
    {
        $period = $generationDate->copy()->setTimezone('Asia/Manila');

        return Invoice::where('account_no', $account->account_no)
            ->whereMonth('invoice_date', $period->month)
            ->whereYear('invoice_date', $period->year)
            ->exists();
    }

    protected function adjustBillingDayForMonth(int $billingDay, Carbon $date): int
    {
        if ($billingDay === self::END_OF_MONTH_BILLING) {
            return self::END_OF_MONTH_BILLING;
        }

        if ($date->format('M') === 'Feb') {
            if ($billingDay === 29) {
                return 1;
            } elseif ($billingDay === 30) {
                return 2;
            } elseif ($billingDay === 31) {
                return 3;
            }
        }
        return $billingDay;
    }

    public function createEnhancedStatement(BillingAccount $account, Carbon $statementDate, int $userId): StatementOfAccount
    {
        $statementDate = $statementDate->copy()->setTimezone('Asia/Manila')->startOfDay();
        DB::beginTransaction();

        try {
            $customer = $account->customer;
            if (!$customer) {
                throw new \Exception("Customer not found for account {$account->account_no}");
            }

            $desiredPlan = $customer->desired_plan;
            if (!$desiredPlan) {
                throw new \Exception("No desired_plan found for customer {$customer->full_name}");
            }

            $planName = $this->extractPlanName($desiredPlan);
            
            $plan = AppPlan::where('plan_name', $planName)->first();
                
            if (!$plan) {
                $allPlans = AppPlan::select('id', 'plan_name', 'price')->get();
                throw new \Exception("Plan '{$planName}' not found in plan_list table (extracted from '{$desiredPlan}'). Available plans: " . $allPlans->pluck('plan_name')->implode(', '));
            }

            if (!$plan->price || $plan->price <= 0) {
                throw new \Exception("Plan '{$planName}' has invalid price: " . ($plan->price ?? 'NULL'));
            }

            $dueDateOffset = $this->getDueDateOffset();
            $adjustedDate = $this->calculateAdjustedBillingDate($account, $statementDate);
            $dueDate = $adjustedDate->copy()->addDays($dueDateOffset);

            // Create initial statement to get the ID
            $statement = StatementOfAccount::create([
                'account_no' => $account->account_no,
                'statement_date' => $statementDate->format('Y-m-d'),
                'balance_from_previous_bill' => 0,
                'payment_received_previous' => 0,
                'remaining_balance_previous' => 0,
                'monthly_service_fee' => 0,
                'others_and_basic_charges' => 0,
                'service_charge' => 0,
                'rebate' => 0,
                'discounts' => 0,
                'staggered' => 0,
                'vat' => 0,
                'due_date' => $dueDate,
                'amount_due' => 0,
                'total_amount_due' => 0,
                'created_by' => (string) $userId,
                'updated_by' => (string) $userId
            ]);

            $prorateAmount = $this->calculateProrateAmount($account, $plan->price, $adjustedDate);
            $reconProrate = $this->calculateReconnectionProrate($account, $statementDate, $plan->price);
            
            $effectiveProrateAmount = $prorateAmount + $reconProrate['total_prorate'];

            // Apply VAT to the plan portion of the bill, then deduct withholding from that
            // VAT-inclusive subtotal. With VAT off and withholding off $billablePlanAmount ===
            // $effectiveProrateAmount, i.e. the bill is exactly the plan price.
            $vatBreakdown = $this->calculateVatBreakdown($effectiveProrateAmount, $account);
            $monthlyServiceFee = $vatBreakdown['net'];
            $vat = $vatBreakdown['vat'];

            $withholding = $this->calculateWithholding($vatBreakdown['total'], $account);
            $billablePlanAmount = $vatBreakdown['total'] - $withholding['amount'];

            $this->log('info', 'Applied VAT and withholding computation to SOA plan amount', [
                'account_no' => $account->account_no,
                'vat_enabled' => $vatBreakdown['vat_enabled'],
                'vat_rate' => $vatBreakdown['vat_rate'],
                'plan_amount' => round($effectiveProrateAmount, 2),
                'monthly_service_fee' => round($monthlyServiceFee, 2),
                'vat' => round($vat, 2),
                'subtotal_with_vat' => round($vatBreakdown['total'], 2),
                'withholding_enabled' => $withholding['enabled'],
                'withholding_percentage' => $withholding['percentage'],
                'withholding_amount' => $withholding['amount'],
                'billable_plan_amount' => round($billablePlanAmount, 2)
            ]);

            // Use statement ID as the reference for charges
            $charges = $this->calculateChargesAndDeductions(
                $account, 
                $statementDate, 
                $userId, 
                (string)$statement->id,
                $plan->price,
                false,
                false
            );
            
            $othersAndBasicCharges = 0;

            $amountDue = $billablePlanAmount + $charges['staggered_install_fees'] + $charges['service_fees'] - $charges['rebates'] - $charges['discounts'] - $charges['advanced_payments'];
            
            $previousBalance = $this->getPreviousBalance($account, $statementDate);
            $paymentReceived = $charges['payment_received_previous'];
            $remainingBalance = $previousBalance - $paymentReceived;
            $totalAmountDue = $remainingBalance + $amountDue;

            $proRateStart = $reconProrate['pro_rate_start'];
            if (!$proRateStart) {
                $planChange = DB::table('plan_change_logs')
                    ->where('account_id', $account->id)
                    ->where('status', 'Unused')
                    ->orderBy('date_changed', 'desc')
                    ->first();
                if ($planChange && !empty($planChange->date_changed)) {
                    $proRateStart = Carbon::parse($planChange->date_changed)->format('Y-m-d');
                }
            }

            // Update statement with actual values
            $statement->update([
                'balance_from_previous_bill' => round($previousBalance, 2),
                'payment_received_previous' => round($paymentReceived, 2),
                'remaining_balance_previous' => round($remainingBalance, 2),
                'monthly_service_fee' => round($monthlyServiceFee, 2),
                'others_and_basic_charges' => round($othersAndBasicCharges, 2),
                'service_charge' => round($charges['service_fees'], 2),
                'rebate' => round($charges['rebates'], 2),
                'discounts' => round($charges['discounts'], 2),
                'staggered' => round($charges['staggered_install_fees'], 2),
                'vat' => round($vat, 2),
                'amount_due' => round($amountDue, 2),
                'total_amount_due' => round($totalAmountDue, 2),
                'pro_rate' => round($reconProrate['total_prorate'], 2),
                'pro_rate_start' => $proRateStart
            ]);

            DB::commit();
            
            // GENERATE PDF AND SAVE TO GOOGLE DRIVE IMMEDIATELY AFTER COMMIT
            try {
                $pdfService = app(\App\Services\GoogleDrivePdfGenerationService::class);
                $pdfResult = $pdfService->generateBillingPdf($account, null, $statement);
                
                if (isset($pdfResult['success']) && $pdfResult['success'] && !empty($pdfResult['url'])) {
                    $statement->print_link = $pdfResult['url'];
                    $statement->save();
                    
                    $this->log('info', 'SOA PDF generated and saved to Google Drive immediately', [
                        'account_no' => $account->account_no,
                        'statement_id' => $statement->id,
                        'print_link' => $pdfResult['url']
                    ]);
                } else {
                    $this->log('error', 'Failed to generate SOA PDF immediately', [
                        'account_no' => $account->account_no,
                        'error' => $pdfResult['error'] ?? 'Unknown error'
                    ]);
                }
            } catch (\Exception $e) {
                $this->log('error', 'Exception generating SOA PDF immediately', [
                    'account_no' => $account->account_no,
                    'error' => $e->getMessage()
                ]);
            }
            
            $this->log('info', 'SOA created successfully', [
                'account_no' => $account->account_no,
                'statement_id' => $statement->id,
                'total_amount_due' => $statement->total_amount_due
            ]);
            
            return $statement;

        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function createEnhancedInvoice(BillingAccount $account, Carbon $invoiceDate, int $userId): Invoice
    {
        $invoiceDate = $invoiceDate->copy()->setTimezone('Asia/Manila')->startOfDay();
        DB::beginTransaction();

        try {
            $customer = $account->customer;
            if (!$customer) {
                throw new \Exception("Customer not found for account {$account->account_no}");
            }

            $desiredPlan = $customer->desired_plan;
            if (!$desiredPlan) {
                throw new \Exception("No desired_plan found for customer {$customer->full_name}");
            }

            $planName = $this->extractPlanName($desiredPlan);
            
            $plan = AppPlan::where('plan_name', $planName)->first();
            if (!$plan) {
                throw new \Exception("Plan '{$planName}' not found in plan_list table (extracted from '{$desiredPlan}')");
            }

            if (!$plan->price || $plan->price <= 0) {
                throw new \Exception("Plan '{$planName}' has invalid price: " . ($plan->price ?? 'NULL'));
            }

            $dueDateOffset = $this->getDueDateOffset();
            $adjustedDate = $this->calculateAdjustedBillingDate($account, $invoiceDate);
            $dueDate = $adjustedDate->copy()->addDays($dueDateOffset);

            // Create initial invoice to get the ID
            $invoice = Invoice::create([
                'account_no' => $account->account_no,
                'invoice_date' => $invoiceDate->format('Y-m-d'),
                'invoice_balance' => 0,
                'others_and_basic_charges' => 0,
                'service_charge' => 0,
                'rebate' => 0,
                'discounts' => 0,
                'staggered' => 0,
                'vat' => 0,
                'total_amount' => 0,
                'received_payment' => 0.00,
                'due_date' => $dueDate,
                'status' => 'Unpaid',
                'created_by' => (string) $userId,
                'updated_by' => (string) $userId
            ]);
            
            $prorateAmount = $this->calculateProrateAmount($account, $plan->price, $adjustedDate);
            $reconProrate = $this->calculateReconnectionProrate($account, $invoiceDate, $plan->price);
            
            $effectiveProrateAmount = $prorateAmount + $reconProrate['total_prorate'];

            // Apply VAT to the plan portion of the bill, then deduct withholding from that
            // VAT-inclusive subtotal, so the invoice's total_amount below is the FINAL amount the
            // customer owes. With VAT off and withholding off $billablePlanAmount ===
            // $effectiveProrateAmount, i.e. the bill is exactly the plan price.
            $vatBreakdown = $this->calculateVatBreakdown($effectiveProrateAmount, $account);
            $vat = $vatBreakdown['vat'];
            $withholding = $this->calculateWithholding($vatBreakdown['total'], $account);
            $billablePlanAmount = $vatBreakdown['total'] - $withholding['amount'];

            $this->log('info', 'Applied VAT and withholding computation to invoice plan amount', [
                'account_no' => $account->account_no,
                'vat_enabled' => $vatBreakdown['vat_enabled'],
                'vat_rate' => $vatBreakdown['vat_rate'],
                'plan_amount' => round($effectiveProrateAmount, 2),
                'vat' => round($vatBreakdown['vat'], 2),
                'subtotal_with_vat' => round($vatBreakdown['total'], 2),
                'withholding_enabled' => $withholding['enabled'],
                'withholding_percentage' => $withholding['percentage'],
                'withholding_amount' => $withholding['amount'],
                'billable_plan_amount' => round($billablePlanAmount, 2)
            ]);

            $charges = $this->calculateChargesAndDeductions(
                $account,
                $invoiceDate,
                $userId,
                (string)$invoice->id,
                $plan->price,
                true,
                true
            );

            $othersBasicCharges = 0;

            $periodCharges = $billablePlanAmount + $charges['staggered_install_fees'] + $charges['service_fees'] - $charges['rebates'] - $charges['discounts'] - $charges['advanced_payments'];

            $priorBalance = round((float) $account->account_balance, 2);

            // An advance payment sits on the account as a negative (credit) balance. It is netted
            // into THIS invoice's total so the customer sees the credit applied, which means it must
            // not be folded into the account balance again below — that would spend it twice.
            $totalAmount = $priorBalance < 0 ? $periodCharges + $priorBalance : $periodCharges;

            $proRateStartInvoice = $reconProrate['pro_rate_start'];
            if (!$proRateStartInvoice) {
                $planChange = DB::table('plan_change_logs')
                    ->where('account_id', $account->id)
                    ->where('status', 'Unused')
                    ->orderBy('date_changed', 'desc')
                    ->first();
                if ($planChange && !empty($planChange->date_changed)) {
                    $proRateStartInvoice = Carbon::parse($planChange->date_changed)->format('Y-m-d');
                }
            }

            $invoice->update([
                'invoice_balance' => round($billablePlanAmount, 2),
                'others_and_basic_charges' => round($othersBasicCharges, 2),
                'service_charge' => round($charges['service_fees'], 2),
                'rebate' => round($charges['rebates'], 2),
                'discounts' => round($charges['discounts'], 2),
                'staggered' => round($charges['staggered_install_fees'], 2),
                'vat' => round($vat, 2),
                'total_amount' => round($totalAmount, 2),
                'status' => $totalAmount <= 0 ? 'Paid' : 'Unpaid',
                'pro_rate' => round($reconProrate['total_prorate'], 2),
                'pro_rate_start' => $proRateStartInvoice
            ]);

            $appliedDiscounts = $charges['discounts'];
            
            // Always accumulate onto the running ledger — never assign the invoice total over it.
            // Assigning is what wiped advance credits: a -5,000.00 credit was replaced by the new
            // invoice total instead of absorbing it. Adding this period's charges to a negative
            // balance nets it down toward zero and carries any remaining credit forward.
            $newBalance = round($priorBalance + $periodCharges, 2);

            $account->update([
                'account_balance' => $newBalance,
                'balance_update_date' => $invoiceDate->format('Y-m-d')
            ]);

            $this->log('info', 'Invoice updated with discount applied to balance', [
                'account_no' => $account->account_no,
                'invoice_balance' => $billablePlanAmount,
                'total_amount' => $totalAmount,
                'discounts_applied' => $appliedDiscounts,
                'previous_balance' => $priorBalance,
                'new_balance' => $newBalance
            ]);
            
            $this->markDiscountsAsUsed($account, $userId, (string)$invoice->id);
            $this->markRebatesAsUsed($account, $userId, (string)$invoice->id);
            $this->markPlanChangesAsUsed($account, $userId, (string)$invoice->id);
            $this->markReconnectionProrateAsUsed($account, $userId, (string)$invoice->id, $reconProrate['log_ids'] ?? []);
            $this->trackStaggeredInvoiceAssociation($account->account_no, $invoice->id);

            DB::commit();
            
            $this->log('info', 'Invoice created successfully', [
                'account_no' => $account->account_no,
                'invoice_id' => $invoice->id,
                'total_amount' => $invoice->total_amount
            ]);
            
            return $invoice;

        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }
    

    protected function calculateAdjustedBillingDate(BillingAccount $account, Carbon $baseDate): Carbon
    {
        if ($account->billing_day === self::END_OF_MONTH_BILLING) {
            return $baseDate->copy()->endOfMonth();
        }

        // No billing day at all — a prepaid account, which bills on a rolling period rather than a
        // fixed day. The bill is dated the day it is generated, so the due date lands the usual
        // offset after that. Guarding here is essential: Carbon's ->day(null) silently resolves to
        // the LAST DAY OF THE PREVIOUS MONTH, which would back-date the bill.
        if ($account->billing_day === null || $account->billing_day === '') {
            return $baseDate->copy()->startOfDay();
        }

        // Normalize time to start of day to avoid time propagation issues
        $baseDate = $baseDate->copy()->startOfDay();
        $adjustedDate = $baseDate->copy()->day($account->billing_day);
        
        // If the calculated billing day is in the past relative to the generation date,
        // it means we are generating the bill in advance for the next month.
        if ($adjustedDate->format('Y-m-d') < $baseDate->format('Y-m-d')) {
            $adjustedDate->addMonth();
        }
        
        return $adjustedDate;
    }

    protected function calculateProrateAmount(BillingAccount $account, float $monthlyFee, Carbon $currentDate): float
    {
        // Try to find an unused plan change log for this account
        $planChange = DB::table('plan_change_logs')
            ->where('account_id', $account->id)
            ->where('status', 'Unused')
            ->orderBy('date_changed', 'desc')
            ->first();

        if (!$planChange) {
            // No plan change, return the fixed monthly plan price
            return $monthlyFee;
        }

        // Get the old and new plan details
        $oldPlan = AppPlan::find($planChange->old_plan_id);
        $newPlan = AppPlan::find($planChange->new_plan_id);

        if (!$oldPlan || !$newPlan) {
            $this->log('warning', 'Plan change log found but plans not found', [
                'account_no' => $account->account_no,
                'old_plan_id' => $planChange->old_plan_id,
                'new_plan_id' => $planChange->new_plan_id
            ]);
            return $monthlyFee;
        }

        $oldPrice = (float)$oldPlan->price;
        $newPrice = (float)$newPlan->price;
        $dateChanged = Carbon::parse($planChange->date_changed);

        // Define the billing cycle period (one month)
        // $currentDate is the adjusted billing date (end of the period)
        $cycleEnd = $currentDate->copy();
        $cycleStart = $cycleEnd->copy()->subMonth();
        
        // Dynamic days based on the actual billing period (e.g., 28 for Feb, 31 for Mar)
        $totalDays = $cycleStart->diffInDays($cycleEnd);
        if ($totalDays <= 0) $totalDays = self::DAYS_IN_MONTH; 

        // Check if the plan change occurred within or prior to this billing cycle
        if ($dateChanged->lte($cycleEnd)) {
            
            if ($dateChanged->gt($cycleStart)) {
                // Change happened during the current billing cycle
                $daysOnOldPlan = $cycleStart->diffInDays($dateChanged);
                if ($daysOnOldPlan > $totalDays) $daysOnOldPlan = $totalDays;
                
                $daysOnNewPlan = $totalDays - $daysOnOldPlan;
                $proratedAmount = (($daysOnOldPlan / $totalDays) * $oldPrice) + (($daysOnNewPlan / $totalDays) * $newPrice);

                $this->log('info', 'Prorating monthly fee due to mid-cycle plan change', [
                    'account_no' => $account->account_no,
                    'old_plan' => $oldPlan->plan_name,
                    'new_plan' => $newPlan->plan_name,
                    'days_old' => $daysOnOldPlan,
                    'days_new' => $daysOnNewPlan,
                    'old_price' => $oldPrice,
                    'new_price' => $newPrice,
                    'total_days_in_month' => $totalDays,
                    'total_amount' => $proratedAmount
                ]);

                return round($proratedAmount, 2);

            } else {
                // Change happened prior to cycle start (e.g. after previous advance generation).
                // Compute retroactive delta adjustment for the unbilled days in the previous cycle.
                $prevCycleEnd = $cycleStart->copy();
                $prevCycleStart = $prevCycleEnd->copy()->subMonth();
                $prevTotalDays = $prevCycleStart->diffInDays($prevCycleEnd);
                if ($prevTotalDays <= 0) $prevTotalDays = self::DAYS_IN_MONTH;

                if ($dateChanged->betweenIncluded($prevCycleStart, $prevCycleEnd)) {
                    $unbilledDays = $dateChanged->diffInDays($prevCycleEnd);
                    if ($unbilledDays > 0 && $unbilledDays < $prevTotalDays) {
                        $dailyDelta = ($newPrice - $oldPrice) / $prevTotalDays;
                        $retroactiveAdjustment = round($dailyDelta * $unbilledDays, 2);
                        $proratedAmount = $monthlyFee + $retroactiveAdjustment;

                        $this->log('info', 'Calculated retroactive plan change adjustment for post-advance generation change', [
                            'account_no' => $account->account_no,
                            'old_plan' => $oldPlan->plan_name,
                            'new_plan' => $newPlan->plan_name,
                            'date_changed' => $dateChanged->format('Y-m-d'),
                            'unbilled_days' => $unbilledDays,
                            'daily_delta' => round($dailyDelta, 2),
                            'retroactive_adjustment' => $retroactiveAdjustment,
                            'new_monthly_fee' => $monthlyFee,
                            'total_amount' => $proratedAmount
                        ]);

                        return round($proratedAmount, 2);
                    }
                }

                return $monthlyFee;
            }
        }

        return $monthlyFee;
    }

    public function calculateReconnectionProrate(BillingAccount $account, Carbon $generationDate, float $monthlyFee): array
    {
        $unbilledLogs = DB::table('reconnection_logs')
            ->where('account_id', $account->id)
            ->where(function ($q) {
                $q->where('pro_rate_applied', 0)
                  ->orWhereNull('pro_rate_applied');
            })
            ->where(function ($q) {
                $q->whereNull('billing_status')
                  ->orWhere('billing_status', 'Unused');
            })
            ->orderBy('created_at', 'asc')
            ->get();

        if ($unbilledLogs->isEmpty()) {
            return [
                'total_prorate' => 0.00,
                'pro_rate_start' => null,
                'log_ids' => []
            ];
        }

        $totalProrate = 0.00;
        $proRateStart = null;
        $logIds = [];

        foreach ($unbilledLogs as $log) {
            $reconDate = Carbon::parse($log->created_at);
            
            $cycleEnd = $this->calculateAdjustedBillingDate($account, $reconDate);
            $cycleStart = $cycleEnd->copy()->subMonth();

            $totalDaysInCycle = $cycleStart->diffInDays($cycleEnd);
            if ($totalDaysInCycle <= 0) {
                $totalDaysInCycle = self::DAYS_IN_MONTH;
            }

            if ($reconDate->betweenIncluded($cycleStart, $cycleEnd)) {
                $activeDays = $reconDate->diffInDays($cycleEnd);
                if ($activeDays > 0 && $activeDays < $totalDaysInCycle) {
                    $dailyRate = $monthlyFee / $totalDaysInCycle;
                    $proratedAmount = round($dailyRate * $activeDays, 2);
                    
                    $totalProrate += $proratedAmount;
                    $logIds[] = $log->id;

                    if (!$proRateStart || $reconDate->lt(Carbon::parse($proRateStart))) {
                        $proRateStart = $reconDate->format('Y-m-d');
                    }

                    $this->log('info', 'Calculated mid-cycle reconnection prorate', [
                        'account_no' => $account->account_no,
                        'reconnection_log_id' => $log->id,
                        'reconnection_date' => $reconDate->format('Y-m-d'),
                        'cycle_end' => $cycleEnd->format('Y-m-d'),
                        'active_days' => $activeDays,
                        'daily_rate' => round($dailyRate, 2),
                        'prorated_amount' => $proratedAmount
                    ]);
                }
            }
        }

        return [
            'total_prorate' => round($totalProrate, 2),
            'pro_rate_start' => $proRateStart,
            'log_ids' => $logIds
        ];
    }

    protected function markReconnectionProrateAsUsed(BillingAccount $account, int $userId, string $invoiceId, array $logIds = []): void
    {
        if (empty($logIds)) {
            $logIds = DB::table('reconnection_logs')
                ->where('account_id', $account->id)
                ->where(function ($q) {
                    $q->where('pro_rate_applied', 0)
                      ->orWhereNull('pro_rate_applied');
                })
                ->pluck('id')
                ->toArray();
        }

        if (!empty($logIds)) {
            DB::table('reconnection_logs')
                ->whereIn('id', $logIds)
                ->update([
                    'pro_rate_applied' => 1,
                    'billing_status' => 'Billed',
                    'pro_rate_invoice_id' => $invoiceId,
                    'pro_rate_billed_at' => now(),
                    'updated_by_user' => (string) $userId,
                    'updated_at' => now()
                ]);

            $this->log('info', 'Marked reconnection logs as billed', [
                'account_no' => $account->account_no,
                'invoice_id' => $invoiceId,
                'log_ids' => $logIds
            ]);
        }
    }

    protected function getDaysBetweenDatesIncludingDueDate(Carbon $startDate, Carbon $endDate): int
    {
        $endDateWithBuffer = $endDate->copy()->addDays(self::DAYS_UNTIL_DUE);
        return $startDate->diffInDays($endDateWithBuffer) + 1;
    }

    protected function getDueDateOffset(): int
    {
        $billingConfig = BillingConfig::first();
        
        if (!$billingConfig || $billingConfig->due_date_day === null) {
            $this->log('info', 'No due_date_day configured, using default ' . self::DAYS_UNTIL_DUE);
            return self::DAYS_UNTIL_DUE;
        }
        
        return (int)$billingConfig->due_date_day;
    }

    protected function getAdvanceGenerationDay(): int
    {
        $billingConfig = BillingConfig::first();
        
        if (!$billingConfig || $billingConfig->advance_generation_day === null) {
            $this->log('info', 'No advance_generation_day configured, using default 0');
            return 0;
        }
        
        return $billingConfig->advance_generation_day;
    }

    protected function calculateTargetBillingDays(Carbon $generationDate): array
    {
        $advanceGenerationDay = $this->getAdvanceGenerationDay();
        $currentDay = $generationDate->day;
        $targetBillingDay = $currentDay + $advanceGenerationDay;
        
        $billingDays = [];
        
        if ($generationDate->isLastOfMonth()) {
            $billingDays[] = self::END_OF_MONTH_BILLING;
            
            $lastDayOfMonth = $generationDate->day;
            $targetDay = $lastDayOfMonth + $advanceGenerationDay;
            
            if ($targetDay <= 31) {
                $billingDays[] = $targetDay;
            }
        } else {
            if ($targetBillingDay <= 31) {
                $billingDays[] = $targetBillingDay;
            }
            
            $lastDayOfMonth = $generationDate->copy()->endOfMonth()->day;
            if ($targetBillingDay > $lastDayOfMonth) {
                $billingDays[] = self::END_OF_MONTH_BILLING;
            }
        }
        
        $this->log('info', 'Calculated target billing days', [
            'generation_date' => $generationDate->format('Y-m-d'),
            'current_day' => $currentDay,
            'advance_generation_day' => $advanceGenerationDay,
            'target_billing_day' => $targetBillingDay,
            'billing_days_to_process' => $billingDays
        ]);
        
        return $billingDays;
    }

    public function generateAllBillingsForToday(int $userId): array
    {
        $today = Carbon::now('Asia/Manila');
        $targetBillingDays = $this->calculateTargetBillingDays($today);
        $advanceGenerationDay = $this->getAdvanceGenerationDay();

        $results = [
            'date' => $today->format('Y-m-d'),
            'advance_generation_day' => $advanceGenerationDay,
            'billing_days_processed' => [],
            'invoices' => ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'notifications' => []],
            'statements' => ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'notifications' => []]
        ];

        foreach ($targetBillingDays as $billingDay) {
            $billingDayLabel = $billingDay === self::END_OF_MONTH_BILLING ? 'End of Month (0)' : "Day {$billingDay}";

            $this->log('info', "Processing billing day: {$billingDayLabel}");

            // Use Unified Billing Generation to prevent duplicate SMS
            $unifiedResults = $this->generateUnifiedBilling($billingDay, $today, $userId);

            $results['billing_days_processed'][] = $billingDayLabel;

            // Merge Invoice Results
            $results['invoices']['success'] += $unifiedResults['invoices']['success'];
            $results['invoices']['failed'] += $unifiedResults['invoices']['failed'];
            $results['invoices']['skipped'] += $unifiedResults['invoices']['skipped'] ?? 0;
            $results['invoices']['errors'] = array_merge($results['invoices']['errors'], $unifiedResults['invoices']['errors']);
            
            // Merge Statement Results
            $results['statements']['success'] += $unifiedResults['statements']['success'];
            $results['statements']['failed'] += $unifiedResults['statements']['failed'];
            $results['statements']['skipped'] += $unifiedResults['statements']['skipped'] ?? 0;
            $results['statements']['errors'] = array_merge($results['statements']['errors'], $unifiedResults['statements']['errors']);
            
            // Merge Notifications (Unified) - adding to statements for tracking, though it covers both
            $results['statements']['notifications'] = array_merge($results['statements']['notifications'], $unifiedResults['notifications'] ?? []);
        }

        return $results;
    }

    public function generateUnifiedBilling(int $billingDay, Carbon $generationDate, int $userId): array
    {
        $results = [
            'invoices' => ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => []],
            'statements' => ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => []],
            'notifications' => []
        ];

        try {
            $accounts = $this->getActiveAccountsForBillingDay($billingDay, $generationDate);

            foreach ($accounts as $account) {
                $soa = null;
                $invoice = null;

                // 1. Generate SOA — skip if one already exists for this billing cycle
                try {
                    if ($this->statementAlreadyGeneratedForCycle($account, $generationDate)) {
                        $results['statements']['skipped']++;
                        $this->log('info', 'Skipped SOA generation — statement already exists for this billing cycle', [
                            'account_no' => $account->account_no,
                            'billing_period' => $generationDate->copy()->setTimezone('Asia/Manila')->format('Y-m')
                        ]);
                    } else {
                        $soa = $this->createEnhancedStatement($account, $generationDate, $userId);
                        $results['statements']['success']++;
                    }
                } catch (\Exception $e) {
                    $results['statements']['failed']++;
                    $results['statements']['errors'][] = [
                        'account_id' => $account->id,
                        'account_no' => $account->account_no,
                        'error' => "SOA Error: " . $e->getMessage()
                    ];
                    $this->log('error', "Failed to generate SOA for account {$account->account_no}: " . $e->getMessage());
                }

                // 2. Generate Invoice — skip if one already exists for this billing cycle
                try {
                    if ($this->invoiceAlreadyGeneratedForCycle($account, $generationDate)) {
                        $results['invoices']['skipped']++;
                        $this->log('info', 'Skipped invoice generation — invoice already exists for this billing cycle', [
                            'account_no' => $account->account_no,
                            'billing_period' => $generationDate->copy()->setTimezone('Asia/Manila')->format('Y-m')
                        ]);
                    } else {
                        $invoice = $this->createEnhancedInvoice($account, $generationDate, $userId);
                        $results['invoices']['success']++;
                    }
                } catch (\Exception $e) {
                    $results['invoices']['failed']++;
                    $results['invoices']['errors'][] = [
                        'account_id' => $account->id,
                        'account_no' => $account->account_no,
                        'error' => "Invoice Error: " . $e->getMessage()
                    ];
                    $this->log('error', "Failed to generate Invoice for account {$account->account_no}: " . $e->getMessage());
                }

                // 3. Notify ONCE — only when we actually created something new this run.
                // If both SOA and invoice were skipped as duplicates, no notification is sent.
                if ($soa || $invoice) {
                     $notificationResult = $this->queueNotification($account, $invoice, $soa);
                     $results['notifications'][] = $notificationResult;
                }
            }
        } catch (\Exception $e) {
            $this->log('error', "Error in generateUnifiedBilling: " . $e->getMessage());
            // In case of catastrophic failure, we just return partial results with the error logged
            // You might want to bubble this up depending on desire
        }
        
        return $results;
    }

    /**
     * Raise this account's bill for the current cycle, on demand.
     *
     * The single-account counterpart to generateUnifiedBilling(), for the Billing
     * Reconcile tool: an operator who has found out WHY the nightly pass skipped an
     * account, and fixed it, needs the bill raised now rather than next month.
     *
     * It composes the same three steps the scheduled path does - statement, invoice,
     * one notification - through the same methods, so the VAT treatment, withholding,
     * prorate, staggered charges, discounts and rebates are identical to a cron run.
     * No billing arithmetic is duplicated here or in the caller.
     *
     * Idempotent by construction. Both per-cycle guards are honoured, so an account
     * that already carries this month's statement or invoice is skipped rather than
     * billed twice, and the customer is notified only when something was actually
     * created. Running it twice in a row is a no-op the second time.
     *
     * Eligibility is the CALLER's business. This method bills the account it is given;
     * BillingReconciliationService::generationBlocker() is what decides whether an
     * account should be billed at all, and re-checks that against live state first.
     *
     * @return array{success:bool, statement_created:bool, invoice_created:bool, skipped:bool, error?:string}
     */
    public function generateCurrentCycleBilling(BillingAccount $account, int $userId): array
    {
        $generationDate = Carbon::now('Asia/Manila');
        $result = [
            'success' => false,
            'statement_created' => false,
            'invoice_created' => false,
            'skipped' => false,
        ];

        $soa = null;
        $invoice = null;

        try {
            // A VIP account is billing-suspended and gets no invoice, scheduled or manual.
            // The scheduled path relies on its Active-only filter for this; that filter does
            // not apply here, so the check has to happen explicitly.
            if ($this->isVipBillingSuspended($account)) {
                $result['success'] = true;
                $result['skipped'] = true;

                return $result;
            }

            if ($this->statementAlreadyGeneratedForCycle($account, $generationDate)) {
                $this->log('info', 'Manual billing: statement already exists for this cycle, skipping', [
                    'account_no' => $account->account_no,
                    'billing_period' => $generationDate->format('Y-m'),
                ]);
            } else {
                $soa = $this->createEnhancedStatement($account, $generationDate, $userId);
                $result['statement_created'] = true;
            }

            if ($this->invoiceAlreadyGeneratedForCycle($account, $generationDate)) {
                $this->log('info', 'Manual billing: invoice already exists for this cycle, skipping', [
                    'account_no' => $account->account_no,
                    'billing_period' => $generationDate->format('Y-m'),
                ]);
            } else {
                $invoice = $this->createEnhancedInvoice($account, $generationDate, $userId);
                $result['invoice_created'] = true;
            }

            // Notify once, and only for work actually done. Two operators pressing
            // Generate on the same row must not cost the customer two texts.
            if ($soa || $invoice) {
                $this->queueNotification($account, $invoice, $soa);
            } else {
                $result['skipped'] = true;
            }

            $result['success'] = true;

            $this->log('info', 'Manual billing generation completed', [
                'account_no' => $account->account_no,
                'billing_period' => $generationDate->format('Y-m'),
                'statement_created' => $result['statement_created'],
                'invoice_created' => $result['invoice_created'],
                'skipped' => $result['skipped'],
                'user_id' => $userId,
            ]);

            return $result;
        } catch (\Exception $e) {
            $this->log('error', 'Manual billing generation failed for account ' . $account->account_no . ': ' . $e->getMessage());
            $result['error'] = $e->getMessage();

            return $result;
        }
    }

    public function generateBillingsForSpecificDay(int $billingDay, int $userId): array
    {
        $today = Carbon::now('Asia/Manila');

        // Use Unified Billing
        $unifiedResults = $this->generateUnifiedBilling($billingDay, $today, $userId);

        return [
            'date' => $today->format('Y-m-d'),
            'billing_day' => $billingDay === self::END_OF_MONTH_BILLING ? 'End of Month (0)' : $billingDay,
            'invoices' => $unifiedResults['invoices'],
            'statements' => $unifiedResults['statements'],
            'notifications' => $unifiedResults['notifications']
        ];
    }

    /**
     * Generate the initial bill for a single, freshly-approved account immediately.
     *
     * Used by the Job Order approval flow for PREPAID customers, whose only bill is created at
     * approval time (they are permanently excluded from the scheduled generator by
     * {@see getActiveAccountsForBillingDay()}). This mirrors {@see generateUnifiedBilling()} for
     * a single account: it creates the SOA + Invoice with the exact same logic and reuses the
     * per-cycle idempotency guards ({@see statementAlreadyGeneratedForCycle()} /
     * {@see invoiceAlreadyGeneratedForCycle()}) so re-running never produces duplicate records,
     * and it notifies at most once (only when something new was actually created).
     *
     * It bypasses the prepaid exclusion filter by operating on the passed account directly,
     * which is exactly why prepaid accounts can still be billed here even though the scheduled
     * path skips them.
     *
     * @return array{success:bool, statement_created:bool, invoice_created:bool, skipped:bool, error?:string}
     */
    /**
     * Is this a prepaid account still sitting on its very first, never-paid bill?
     *
     * That is the only window in which the initial bill may be re-priced for a different plan:
     * no service period has started (prepaid_expires_at is NULL, it only gets set on payment) and
     * no money has been taken. Once either is true the bill is history and must not be rewritten.
     */
    public function isUnpaidPrepaidOnboarding(BillingAccount $account): bool
    {
        if (!BillingAccount::isPrepaidType($account->generation_type)) {
            return false;
        }

        if (!empty($account->prepaid_expires_at)) {
            return false;
        }

        return !DB::table('transactions')
            ->where('account_no', $account->account_no)
            ->where('status', 'Done')
            ->exists();
    }

    /**
     * Re-price the unpaid initial prepaid bill for a different plan.
     *
     * A customer who is onboarding but has not paid yet may still change their mind about the
     * plan. Their bill was raised at approval for the plan on the job order, so picking another
     * one has to re-price that same bill — otherwise they would be charged one plan's price
     * against an invoice for another, and the invoice would sit Unpaid forever.
     *
     * Only the PLAN portion is recomputed. Everything else on the invoice (staggered installation
     * fees, service charges, rebates, discounts, advanced payments) is carried across untouched as
     * a single figure derived from `total_amount - invoice_balance`. That is deliberate: re-running
     * calculateChargesAndDeductions() would consume those discounts and advanced payments a second
     * time, since creating the invoice already marked them Used.
     *
     * @param bool $persist false performs the identical calculation without writing anything,
     *                      so a caller can quote the amount before the customer commits.
     * @return array{revised: bool, reason?: string, plan?: string, previous_total: float,
     *               new_total: float, plan_amount: float, vat: float, withholding: float,
     *               previous_balance: float, new_balance: float, invoice_id?: int}
     */
    public function repricePrepaidInitialBillForPlan(
        BillingAccount $account,
        AppPlan $newPlan,
        int $userId,
        bool $persist = true
    ): array {
        $result = [
            'revised' => false,
            'previous_total' => 0.0,
            'new_total' => 0.0,
            'plan_amount' => 0.0,
            'vat' => 0.0,
            'withholding' => 0.0,
            'previous_balance' => (float) $account->account_balance,
            'new_balance' => (float) $account->account_balance,
        ];

        if (!$this->isUnpaidPrepaidOnboarding($account)) {
            $result['reason'] = 'not an unpaid prepaid onboarding account';
            return $result;
        }

        $planPrice = (float) ($newPlan->price ?? 0);
        if ($planPrice <= 0) {
            $result['reason'] = 'selected plan has no price';
            return $result;
        }

        // The bill to re-price: the outstanding initial invoice.
        $invoice = Invoice::where('account_no', $account->account_no)
            ->whereIn('status', ['Unpaid', 'Partial'])
            ->orderBy('id', 'desc')
            ->first();

        if (!$invoice) {
            $result['reason'] = 'no outstanding invoice to reprice';
            return $result;
        }

        $vatBreakdown = $this->calculateVatBreakdown($planPrice, $account);
        $withholding = $this->calculateWithholding($vatBreakdown['total'], $account);
        $billablePlanAmount = round($vatBreakdown['total'] - $withholding['amount'], 2);

        $previousTotal = round((float) $invoice->total_amount, 2);
        // Everything on the invoice that is not the plan — preserved exactly, sign included.
        $nonPlanPortion = round($previousTotal - (float) $invoice->invoice_balance, 2);
        $newTotal = round($billablePlanAmount + $nonPlanPortion, 2);

        $previousBalance = round((float) $account->account_balance, 2);
        // Move the balance by the delta rather than assigning the new total, so any unrelated
        // amount already sitting on the account is preserved.
        $newBalance = round($previousBalance + ($newTotal - $previousTotal), 2);

        $result = array_merge($result, [
            'plan' => $newPlan->plan_name,
            'previous_total' => $previousTotal,
            'new_total' => $newTotal,
            'plan_amount' => round($planPrice, 2),
            'vat' => round($vatBreakdown['vat'], 2),
            'withholding' => $withholding['amount'],
            'previous_balance' => $previousBalance,
            'new_balance' => $newBalance,
            'invoice_id' => $invoice->id,
        ]);

        if (!$persist) {
            $result['revised'] = true;
            return $result;
        }

        DB::transaction(function () use ($invoice, $account, $billablePlanAmount, $newTotal, $newBalance, $userId) {
            $invoice->update([
                'invoice_balance' => $billablePlanAmount,
                'total_amount' => $newTotal,
                'status' => $newTotal <= 0 ? 'Paid' : 'Unpaid',
                'updated_by' => (string) $userId,
            ]);

            $account->update([
                'account_balance' => $newBalance,
                'balance_update_date' => Carbon::now('Asia/Manila')->format('Y-m-d'),
            ]);
        });

        $result['revised'] = true;

        $this->log('info', 'Repriced unpaid prepaid initial bill for a newly selected plan', [
            'account_no' => $account->account_no,
            'plan' => $newPlan->plan_name,
            'invoice_id' => $invoice->id,
            'plan_amount' => $result['plan_amount'],
            'vat' => $result['vat'],
            'withholding' => $result['withholding'],
            'non_plan_portion' => $nonPlanPortion,
            'previous_total' => $previousTotal,
            'new_total' => $newTotal,
            'previous_balance' => $previousBalance,
            'new_balance' => $newBalance,
        ]);

        return $result;
    }

    public function generateInitialBillingForAccount(BillingAccount $account, int $userId): array
    {
        $generationDate = Carbon::now('Asia/Manila');
        $result = [
            'success' => false,
            'statement_created' => false,
            'invoice_created' => false,
            'skipped' => false,
        ];

        $soa = null;
        $invoice = null;

        try {
            // 0. VIP guard: a VIP account gets no initial bill at all. Unlike the scheduled
            // paths this one runs on the account handed to it, so the Active-only filter in
            // getActiveAccountsForBillingDay() does not apply and the check has to happen here.
            if ($this->isVipBillingSuspended($account)) {
                $result['success'] = true;
                $result['skipped'] = true;
                return $result;
            }

            // 1. SOA — skip if one already exists for this billing cycle.
            if ($this->statementAlreadyGeneratedForCycle($account, $generationDate)) {
                $this->log('info', 'Initial billing: SOA already exists for this cycle, skipping', [
                    'account_no' => $account->account_no,
                ]);
            } else {
                $soa = $this->createEnhancedStatement($account, $generationDate, $userId);
                $result['statement_created'] = true;
            }

            // 2. Invoice — skip if one already exists for this billing cycle.
            if ($this->invoiceAlreadyGeneratedForCycle($account, $generationDate)) {
                $this->log('info', 'Initial billing: invoice already exists for this cycle, skipping', [
                    'account_no' => $account->account_no,
                ]);
            } else {
                $invoice = $this->createEnhancedInvoice($account, $generationDate, $userId);
                $result['invoice_created'] = true;
            }

            // 3. Notify ONCE — only when we actually created something new this run.
            if ($soa || $invoice) {
                $this->queueNotification($account, $invoice, $soa);
            } else {
                $result['skipped'] = true;
            }

            $result['success'] = true;

            $this->log('info', 'Initial billing generation completed for prepaid account', [
                'account_no' => $account->account_no,
                'statement_created' => $result['statement_created'],
                'invoice_created' => $result['invoice_created'],
                'skipped' => $result['skipped'],
            ]);

            return $result;
        } catch (\Exception $e) {
            $this->log('error', 'Initial billing generation failed for account ' . $account->account_no . ': ' . $e->getMessage());
            $result['error'] = $e->getMessage();
            return $result;
        }
    }

    /**
     * What a prepaid customer pays to renew, for the plan they are currently on.
     *
     * The same maths {@see repricePrepaidInitialBillForPlan()} applies — plan price, plus VAT,
     * less withholding — exposed publicly because the prepaid lapse notice has to quote a figure
     * without an invoice to read it off. Callers must never reimplement the tax rules.
     *
     * Returns 0.0 when the account has no priced plan, which the caller reports rather than
     * sending a notice quoting nothing.
     */
    public function quotePrepaidRenewalAmount(BillingAccount $account): float
    {
        $planPrice = (float) ($account->plan->price ?? 0);

        if ($planPrice <= 0) {
            return 0.0;
        }

        $vatBreakdown = $this->calculateVatBreakdown($planPrice, $account);
        $withholding = $this->calculateWithholding($vatBreakdown['total'], $account);

        return round($vatBreakdown['total'] - $withholding['amount'], 2);
    }

    /**
     * Notify prepaid customers whose service period has EXPIRED. Raises NO bill.
     *
     * Prepaid deliberately produces no renewal SOA and no renewal invoice. A renewal bill has to
     * be priced before the customer has said what they want, so it could only ever be priced at
     * the plan they were LAST on — and a customer renewing onto a different plan was then made to
     * settle the old plan's amount to get reconnected, while
     * {@see \App\Services\PrepaidPlanChangeService::handleSettledPayment()} switched them to the
     * new plan anyway. Wrong money collected in both directions: undercharged on an upgrade,
     * overcharged on a downgrade.
     *
     * So nothing is billed at expiry. The customer is TOLD their period lapsed, and the amount is
     * settled at checkout from the plan they actually pick — which is already how the customer
     * app drives it (the payment screen sets the amount from the selected plan's price). With no
     * invoice raised, account_balance stays at 0, so nothing stale can override that choice and
     * the balance-based reconnect gate in TransactionController still passes on payment.
     *
     * Deliberately NOT filtered on billing_status: an expired prepaid account has usually already
     * been restricted (Inactive), and it is exactly the customer who needs telling.
     *
     * Idempotent: `prepaid_expiry_notified_for` records the expiry the notice went out for, so a
     * customer who stays lapsed is notified once, not every morning. It needs no cleanup —
     * renewing moves prepaid_expires_at forward, the stored value stops matching, and the next
     * lapse notifies again. Each account is isolated so one failure never aborts the batch.
     *
     * @return array{success:int, failed:int, skipped:int, errors:array, notifications:array}
     */
    public function notifyExpiredPrepaidAccounts(Carbon $generationDate): array
    {
        $results = [
            'success' => 0,
            'failed' => 0,
            'skipped' => 0,
            'errors' => [],
            'notifications' => [],
        ];

        $now = $generationDate->copy();

        $accounts = BillingAccount::with(['customer', 'technicalDetails', 'plan'])
            ->whereIn('generation_type', BillingAccount::PREPAID_ALIASES)
            ->whereNotNull('prepaid_expires_at')
            ->where('prepaid_expires_at', '<=', $now)
            ->whereNotNull('account_no')
            ->get();

        $this->log('info', 'Prepaid expiry scan: expired prepaid accounts found', [
            'generation_date' => $now->format('Y-m-d'),
            'expired_count' => $accounts->count(),
        ]);

        foreach ($accounts as $account) {
            try {
                // VIP guard: a VIP is not asked to renew. This scan deliberately ignores
                // billing_status (an expired prepaid is usually already Inactive), so VIP has to
                // be excluded explicitly here.
                if ($this->isVipBillingSuspended($account)) {
                    $results['skipped']++;
                    continue;
                }

                $expiry = Carbon::parse($account->prepaid_expires_at);

                // Already told them about THIS lapse. Compared as a timestamp string so a Carbon
                // instance and its stored representation are not mistaken for a difference, which
                // would re-notify every single day.
                $notifiedFor = $account->prepaid_expiry_notified_for
                    ? Carbon::parse($account->prepaid_expiry_notified_for)->toDateTimeString()
                    : null;

                if ($notifiedFor === $expiry->toDateTimeString()) {
                    $results['skipped']++;
                    continue;
                }

                // No renewal-amount guard here: a prepaid account reaching the expiry window is
                // told regardless of whether its plan has a quotable price. quotePrepaidRenewalAmount()
                // returns 0.0 for an unpriced/unlinked plan and the notice still goes out — see
                // BillingNotificationService::generatePrepaidExpirySmsMessage(), which renders fine
                // with a zero amount.
                $renewalAmount = $this->quotePrepaidRenewalAmount($account);

                // 8:00 AM Asia/Manila, matching queueNotification() — the scan runs at 01:00 and
                // customers should not be woken by it.
                $timeToSend = Carbon::now('Asia/Manila')->setTime(8, 0, 0)->format('Y-m-d H:i:s');

                $notification = $this->notificationService->notifyPrepaidExpiry(
                    $account,
                    $expiry,
                    $renewalAmount,
                    $timeToSend
                );

                $results['notifications'][] = $notification;

                // notifyPrepaidExpiry() never throws — a provider outage or a customer with no
                // phone number on file both come back in `errors` with `sms_sent` false (prepaid
                // notices are SMS-only; email_queued is always false and never counts against
                // delivery). Marking unconditionally therefore recorded "notified" for a notice
                // that was never sent, and because the marker matches the expiry timestamp for
                // as long as the account stays lapsed, the customer was never told at all.
                // Marked only once something actually went out, so a transient failure retries
                // tomorrow. A duplicate is not a risk: SmsQueueService::queueSms() deduplicates on
                // (account, contact, message, time_sent).
                if (!$notification['sms_sent'] && !$notification['email_queued']) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'account_no' => $account->account_no,
                        'error' => implode('; ', $notification['errors'] ?: ['Prepaid expiry notice not delivered']),
                    ];

                    $this->log('warning', 'Prepaid expiry notice not delivered — will retry on the next run', [
                        'account_no' => $account->account_no,
                        'prepaid_expires_at' => $expiry->toDateTimeString(),
                        'errors' => $notification['errors'],
                    ]);

                    continue;
                }

                DB::transaction(function () use ($account, $expiry) {
                    $account->prepaid_expiry_notified_for = $expiry;
                    $account->save();
                });

                $results['success']++;

                $this->log('info', 'Prepaid expiry notice sent (no SOA, no invoice)', [
                    'account_no' => $account->account_no,
                    'prepaid_expires_at' => $expiry->toDateTimeString(),
                    'renewal_amount' => $renewalAmount,
                ]);
            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = [
                    'account_no' => $account->account_no,
                    'error' => $e->getMessage(),
                ];
                $this->log('error', "Failed prepaid expiry notice for account {$account->account_no}: " . $e->getMessage());
            }
        }

        return $results;
    }

    /**
     * How many days AHEAD of prepaid_expires_at a prepaid customer is warned.
     *
     * Falls back to 3 when billing_config has no row or holds a non-numeric value, matching the
     * column default. A configured 0 is honoured and means "never warn".
     */
    protected const DEFAULT_PREPAID_PRE_EXPIRY_DAYS = 3;

    /**
     * Warn prepaid customers whose service period is ABOUT to lapse. Raises NO bill.
     *
     * The early counterpart to {@see notifyExpiredPrepaidAccounts()}, which only fires once the
     * period has already gone and the customer is usually restricted. Nothing is billed here for
     * exactly the same reason it is not billed at expiry: a renewal is priced from the plan the
     * customer picks at checkout, so a bill raised in advance could only ever quote the plan they
     * are currently on. The quoted figure is a quote, not a charge.
     *
     * Window: accounts expiring from now through the end of the configured day
     * (`billing_config.prepaid_pre_expiry_days`, default 3). Already-expired accounts are excluded
     * by the lower bound — those belong to the lapse notice, and letting both fire would send two
     * messages for one event.
     *
     * Deliberately NOT filtered on billing_status, mirroring the expiry scan: the point is to reach
     * the customer whatever state their account is in. VIP is therefore excluded explicitly.
     *
     * Idempotent, at two levels. `prepaid_pre_expiry_notified_for` records the expiry the warning
     * went out for, so a customer sitting inside the window is warned once, not every morning; it
     * is a separate column from `prepaid_expiry_notified_for` on purpose, because both notices key
     * off the same expiry timestamp and a shared marker would let this warning suppress the lapse
     * notice days later. It needs no cleanup: renewing moves prepaid_expires_at forward, the stored
     * value stops matching, and the next period warns again. Beneath that,
     * {@see \App\Services\SmsQueueService::queueSms()} deduplicates on
     * (account, contact, message, time_sent) under a UNIQUE index — so even a run whose marker
     * write fails, or two runs overlapping, cannot text the same customer twice.
     *
     * Each account is isolated so one failure never aborts the batch.
     *
     * NOT part of bill generation. This concerns prepaid accounts only and raises no SOA and no
     * invoice, so it runs from its own command and its own schedule entry —
     * {@see \App\Console\Commands\NotifyPrepaidPreExpiry} / 'billing:notify-prepaid-pre-expiry',
     * daily at 01:30. It used to be a step inside cron:generate-daily-billings, which meant a
     * failure in either landed in the other's log and the warning could not be re-run without
     * re-entering bill generation. Use `--dry-run` on that command to see what a run would do.
     *
     * @return array{success:int, failed:int, skipped:int, errors:array, notifications:array}
     */
    public function notifyPrepaidPreExpiryAccounts(Carbon $generationDate): array
    {
        $results = [
            'success' => 0,
            'failed' => 0,
            'skipped' => 0,
            'errors' => [],
            'notifications' => [],
        ];

        // The marker column is what makes this scan idempotent. Without it every account inside the
        // window is re-warned on every run, so the condition is reported up front and at warning
        // level rather than surfacing later as an opaque per-account save() failure — it means the
        // pre-expiry migration has not been run on this database.
        $markerColumnPresent = Schema::hasColumn('billing_accounts', 'prepaid_pre_expiry_notified_for');

        if (!$markerColumnPresent) {
            $this->log('warning', 'Prepaid pre-expiry scan: billing_accounts.prepaid_pre_expiry_notified_for is missing — run the pending migrations. Warnings will send but cannot be marked as sent.');
        }

        $configured = BillingConfig::first()?->prepaid_pre_expiry_days;
        $preExpiryDays = is_numeric($configured)
            ? (int) $configured
            : self::DEFAULT_PREPAID_PRE_EXPIRY_DAYS;

        if ($preExpiryDays <= 0) {
            // Reported at warning, not info: "no pre-expiry SMS is going out" is indistinguishable
            // from a broken scan when it is only ever logged as routine, and 0 is reachable simply
            // by clearing the field on the Billing Configuration page.
            $this->log('warning', 'Prepaid pre-expiry scan skipped — warning disabled in billing config (prepaid_pre_expiry_days is 0)', [
                'prepaid_pre_expiry_days' => $preExpiryDays,
                'configured_value' => $configured,
            ]);

            return $results;
        }

        $now = $generationDate->copy();
        // endOfDay so an account expiring late on the final day of the window is still caught —
        // the scan runs at 01:00 and would otherwise miss everything after that hour.
        $windowEnd = $now->copy()->addDays($preExpiryDays)->endOfDay();

        // Eager-loaded up front: the notice reads the customer for name and contact number and the
        // plan for its name and price, so lazy loading would cost two queries per account.
        $accounts = BillingAccount::with(['customer', 'technicalDetails', 'plan'])
            ->whereIn('generation_type', BillingAccount::PREPAID_ALIASES)
            ->whereNotNull('prepaid_expires_at')
            ->whereBetween('prepaid_expires_at', [$now, $windowEnd])
            ->whereNotNull('account_no')
            ->get();

        $this->log('info', 'Prepaid pre-expiry scan: accounts approaching expiry found', [
            'generation_date' => $now->format('Y-m-d'),
            'pre_expiry_days' => $preExpiryDays,
            'window_end' => $windowEnd->toDateTimeString(),
            'expiring_count' => $accounts->count(),
        ]);

        foreach ($accounts as $account) {
            try {
                // VIP guard: a VIP is not asked to renew. This scan ignores billing_status, so VIP
                // has to be excluded explicitly here.
                if ($this->isVipBillingSuspended($account)) {
                    $results['skipped']++;
                    continue;
                }

                $expiry = Carbon::parse($account->prepaid_expires_at);

                // Already warned about THIS period. Compared as a timestamp string so a Carbon
                // instance and its stored representation are not mistaken for a difference, which
                // would re-warn every single day.
                $notifiedFor = $account->prepaid_pre_expiry_notified_for
                    ? Carbon::parse($account->prepaid_pre_expiry_notified_for)->toDateTimeString()
                    : null;

                if ($notifiedFor === $expiry->toDateTimeString()) {
                    $results['skipped']++;
                    continue;
                }

                // No renewal-amount guard here: any prepaid account inside the pre-expiry window is
                // warned regardless of whether its plan has a quotable price. quotePrepaidRenewalAmount()
                // returns 0.0 for an unpriced/unlinked plan and the warning still goes out — the
                // pre-expiry template no longer carries a price placeholder at all (see
                // BillingNotificationService::generatePrepaidPreExpirySmsMessage()).
                $renewalAmount = $this->quotePrepaidRenewalAmount($account);

                // 8:00 AM Asia/Manila, matching queueNotification() and the expiry scan — this
                // runs at 01:00 and customers should not be woken by it.
                $timeToSend = Carbon::now('Asia/Manila')->setTime(8, 0, 0)->format('Y-m-d H:i:s');

                $notification = $this->notificationService->notifyPrepaidPreExpiry(
                    $account,
                    $expiry,
                    $renewalAmount,
                    $timeToSend
                );

                $results['notifications'][] = $notification;

                // Marked only after the notice actually went out, so a failure retries tomorrow —
                // there is still time left in the window — rather than silently swallowing this
                // period's only warning.
                if (!$notification['sms_sent']) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'account_no' => $account->account_no,
                        'error' => implode('; ', $notification['errors'] ?: ['SMS not sent']),
                    ];

                    $this->log('warning', 'Prepaid pre-expiry notice not delivered — will retry while the account is still inside the window', [
                        'account_no' => $account->account_no,
                        'prepaid_expires_at' => $expiry->toDateTimeString(),
                        'errors' => $notification['errors'],
                    ]);

                    continue;
                }

                // Skipped when the migration adding the column has not been run: the save() would
                // throw and this account would be counted as failed even though the warning is
                // already queued. The re-warn that follows is absorbed by the SMS queue's dedupe
                // key, which suppresses an identical (account, message, time_sent) insert.
                if ($markerColumnPresent) {
                    DB::transaction(function () use ($account, $expiry) {
                        $account->prepaid_pre_expiry_notified_for = $expiry;
                        $account->save();
                    });
                }

                $results['success']++;

                $this->log('info', 'Prepaid pre-expiry notice sent (no SOA, no invoice)', [
                    'account_no' => $account->account_no,
                    'prepaid_expires_at' => $expiry->toDateTimeString(),
                    'days_remaining' => $now->diffInDays($expiry, false),
                    'renewal_amount' => $renewalAmount,
                ]);
            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = [
                    'account_no' => $account->account_no,
                    'error' => $e->getMessage(),
                ];
                $this->log('error', "Failed prepaid pre-expiry notice for account {$account->account_no}: " . $e->getMessage());
            }
        }

        return $results;
    }

    protected function calculateChargesAndDeductions(
        BillingAccount $account, 
        Carbon $date, 
        int $userId, 
        string $invoiceId,
        float $monthlyFee,
        bool $updateDiscountStatus = false,
        bool $includeDiscounts = true
    ): array {
        $staggeredInstallFees = $this->calculateStaggeredInstallFees($account, $userId, $invoiceId, $updateDiscountStatus);
        $discounts = $includeDiscounts ? $this->calculateDiscounts($account, $userId, $invoiceId, $updateDiscountStatus) : 0;
        $advancedPayments = $this->calculateAdvancedPayments($account, $date, $userId, $invoiceId);
        $rebates = $this->calculateRebates($account, $date, $monthlyFee);
        $serviceFees = $this->calculateServiceFees($account, $date, $userId);
        $paymentReceived = $this->calculatePaymentReceived($account, $date);

        return [
            'staggered_install_fees' => $staggeredInstallFees,
            'discounts' => $discounts,
            'advanced_payments' => $advancedPayments,
            'rebates' => $rebates,
            'service_fees' => $serviceFees,
            'total_deductions' => $advancedPayments + $discounts + $rebates,
            'payment_received_previous' => $paymentReceived
        ];
    }

    protected function calculateStaggeredInstallFees(BillingAccount $account, int $userId, string $invoiceId, bool $updateStatus = false): float
    {
        $total = 0;

        $staggeredInstallations = StaggeredInstallation::where('account_no', $account->account_no)
            ->where('status', 'Active')
            ->where('months_to_pay', '>', 0)
            ->get();

        foreach ($staggeredInstallations as $installation) {
            $total += $installation->monthly_payment;
        }

        return round($total, 2);
    }

    protected function calculateDiscounts(BillingAccount $account, int $userId, string $invoiceId, bool $updateStatus = false): float
    {
        $total = 0;

        $discounts = Discount::where('account_no', $account->account_no)
            ->whereIn('status', ['Unused', 'Permanent', 'Monthly'])
            ->get();

        foreach ($discounts as $discount) {
            if ($discount->status === 'Unused') {
                $total += $discount->discount_amount;
            } elseif ($discount->status === 'Permanent') {
                $total += $discount->discount_amount;
            } elseif ($discount->status === 'Monthly' && $discount->remaining > 0) {
                $total += $discount->discount_amount;
            }
        }

        return round($total, 2);
    }

    protected function calculateAdvancedPayments(
        BillingAccount $account, 
        Carbon $date, 
        int $userId, 
        string $invoiceId
    ): float {
        $total = 0;
        $currentMonth = $date->format('F');

        $advancedPayments = AdvancedPayment::where('account_no', $account->account_no)
            ->where('payment_month', $currentMonth)
            ->where('status', 'Unused')
            ->get();

        foreach ($advancedPayments as $payment) {
            $total += $payment->payment_amount;
            $payment->update([
                'status' => 'Used',
                'invoice_used_id' => $invoiceId,
                'updated_by' => $userId
            ]);
        }

        return round($total, 2);
    }

    protected function calculateRebates(BillingAccount $account, Carbon $date, float $monthlyFee): float
    {
        $total = 0;
        $currentMonth = $date->format('F');
        
        $customer = $account->customer;
        if (!$customer) {
            return 0;
        }

        $technicalDetails = $account->technicalDetails->first();
        if (!$technicalDetails) {
            return 0;
        }

        $rebates = MassRebate::where('status', 'Unused')
            ->where('month', $currentMonth)
            ->get();

        $daysInCurrentMonth = $date->daysInMonth;
        $dailyRate = $monthlyFee / $daysInCurrentMonth;

        foreach ($rebates as $rebate) {
            $matchFound = false;

            if ($rebate->rebate_type === 'lcpnap') {
                if ($technicalDetails->lcpnap && $technicalDetails->lcpnap === $rebate->selected_rebate) {
                    $matchFound = true;
                }
            } elseif ($rebate->rebate_type === 'lcp') {
                if ($technicalDetails->lcp && $technicalDetails->lcp === $rebate->selected_rebate) {
                    $matchFound = true;
                }
            } elseif ($rebate->rebate_type === 'location') {
                if (($customer->location && $customer->location === $rebate->selected_rebate) ||
                    ($customer->barangay && $customer->barangay === $rebate->selected_rebate)) {
                    $matchFound = true;
                }
            }

            if ($matchFound) {
                $rebateUsage = RebateUsage::where('rebates_id', $rebate->id)
                    ->where('account_no', $account->account_no)
                    ->where('status', 'Unused')
                    ->first();

                if ($rebateUsage) {
                    $rebateDays = $rebate->number_of_dates ?? 0;
                    $rebateValue = $dailyRate * $rebateDays;
                    $total += $rebateValue;
                }
            }
        }

        return round($total, 2);
    }

    protected function calculateServiceFees(BillingAccount $account, Carbon $date, int $userId): float
    {
        $total = 0;

        $serviceFees = DB::table('service_charge_logs')
            ->where('account_no', $account->account_no)
            ->where('status', 'Unused')
            ->get();

        foreach ($serviceFees as $fee) {
            $total += $fee->service_charge;
            
            DB::table('service_charge_logs')
                ->where('id', $fee->id)
                ->update([
                    'status' => 'Used',
                    'date_used' => now(),
                    'updated_at' => now()
                ]);
        }

        return round($total, 2);
    }

    protected function calculatePaymentReceived(BillingAccount $account, Carbon $date): float
    {
        $lastMonth = $date->copy()->subMonth();
        
        $transactions = DB::table('transactions')
            ->where('account_no', $account->account_no)
            ->where('status', 'Done')
            ->whereNotIn('transaction_type', ['Security Deposit', 'Installation Fee'])
            ->whereMonth('payment_date', $lastMonth->month)
            ->whereYear('payment_date', $lastMonth->year)
            ->sum('received_payment');

        return floatval($transactions);
    }

    protected function extractPlanName(string $desiredPlan): string
    {
        // First handle " - " separator
        if (strpos($desiredPlan, ' - ') !== false) {
            $parts = explode(' - ', $desiredPlan);
            $desiredPlan = trim($parts[0]);
        }
        
        // Then handle space separator (e.g., "SWIFT 1000" -> "SWIFT")
        if (strpos($desiredPlan, ' ') !== false) {
            $parts = explode(' ', $desiredPlan);
            return trim($parts[0]);
        }
        
        return trim($desiredPlan);
    }

    protected function getPreviousBalance(BillingAccount $account, Carbon $currentDate): float
    {
        $accountBalance = floatval($account->account_balance);
        
        $this->log('info', 'Getting previous balance for SOA', [
            'account_no' => $account->account_no,
            'account_balance' => $accountBalance,
            'current_date' => $currentDate->format('Y-m-d')
        ]);
        
        return $accountBalance;
    }

    protected function markDiscountsAsUsed(BillingAccount $account, int $userId, string $invoiceId): void
    {
        $discounts = Discount::where('account_no', $account->account_no)
            ->whereIn('status', ['Unused', 'Permanent', 'Monthly'])
            ->get();

        foreach ($discounts as $discount) {
            if ($discount->status === 'Unused') {
                $discount->update([
                    'status' => 'Used',
                    'invoice_used_id' => $invoiceId,
                    'used_date' => now(),
                    'updated_by_user_id' => $userId
                ]);
            } elseif ($discount->status === 'Permanent') {
                $discount->update([
                    'invoice_used_id' => $invoiceId,
                    'updated_by_user_id' => $userId
                ]);
            } elseif ($discount->status === 'Monthly' && $discount->remaining > 0) {
                $discount->update([
                    'invoice_used_id' => $invoiceId,
                    'remaining' => $discount->remaining - 1,
                    'updated_by_user_id' => $userId
                ]);
            }
        }
    }

    protected function markPlanChangesAsUsed(BillingAccount $account, int $userId, string $invoiceId): void
    {
        DB::table('plan_change_logs')
            ->where('account_id', $account->id)
            ->where('status', 'Unused')
            ->update([
                'status' => 'Used',
                'date_used' => now(),
                'remarks' => DB::raw("CONCAT(IFNULL(remarks, ''), ' [Applied to Invoice: ', '$invoiceId', ']')"),
                'updated_by_user' => (string) $userId,
                'updated_at' => now()
            ]);
    }

    protected function markRebatesAsUsed(BillingAccount $account, int $userId, string $invoiceId): void
    {
        $currentMonth = Carbon::now('Asia/Manila')->format('F');
        $customer = $account->customer;
        
        if (!$customer) {
            return;
        }

        $technicalDetails = $account->technicalDetails->first();
        if (!$technicalDetails) {
            return;
        }

        $rebates = MassRebate::where('status', 'Unused')
            ->where('month', $currentMonth)
            ->get();

        foreach ($rebates as $rebate) {
            $matchFound = false;

            if ($rebate->rebate_type === 'lcpnap') {
                if ($technicalDetails->lcpnap && $technicalDetails->lcpnap === $rebate->selected_rebate) {
                    $matchFound = true;
                }
            } elseif ($rebate->rebate_type === 'lcp') {
                if ($technicalDetails->lcp && $technicalDetails->lcp === $rebate->selected_rebate) {
                    $matchFound = true;
                }
            } elseif ($rebate->rebate_type === 'location') {
                if (($customer->location && $customer->location === $rebate->selected_rebate) ||
                    ($customer->barangay && $customer->barangay === $rebate->selected_rebate)) {
                    $matchFound = true;
                }
            }

            if ($matchFound) {
                $rebateUsage = RebateUsage::where('rebates_id', $rebate->id)
                    ->where('account_no', $account->account_no)
                    ->where('status', 'Unused')
                    ->first();

                if ($rebateUsage) {
                    $rebateUsage->update(['status' => 'Used']);
                    $this->checkAndUpdateRebateStatus($rebate->id, $userId);
                }
            }
        }
    }

    protected function checkAndUpdateRebateStatus(int $rebateId, int $userId): void
    {
        $unusedCount = RebateUsage::where('rebates_id', $rebateId)
            ->where('status', 'Unused')
            ->count();

        if ($unusedCount === 0) {
            $rebate = MassRebate::find($rebateId);
            if ($rebate) {
                $rebate->update([
                    'status' => 'Used',
                    'modified_by' => (string) $userId,
                    'modified_date' => now()
                ]);
            }
        }
    }

    protected function trackStaggeredInvoiceAssociation(string $accountNo, int $invoiceId): void
    {
        try {
            $staggeredInstallations = StaggeredInstallation::where('account_no', $accountNo)
                ->where('status', 'Active')
                ->where('months_to_pay', '>', 0)
                ->get();

            foreach ($staggeredInstallations as $staggered) {
                $monthColumn = null;
                for ($i = 1; $i <= 12; $i++) {
                    $col = 'month' . $i;
                    if (empty($staggered->$col)) {
                        $monthColumn = $col;
                        break;
                    }
                }

                if (!$monthColumn) {
                    continue;
                }

                $staggered->$monthColumn = (string)$invoiceId;
                $staggered->months_to_pay = $staggered->months_to_pay - 1;

                if ($staggered->months_to_pay <= 0) {
                    $staggered->status = 'Completed';
                }

                $staggered->modified_by = 'system';
                $staggered->modified_date = now();
                $staggered->timestamps = false;
                $staggered->save();
            }
        } catch (\Exception $e) {
            $this->log('error', 'Error tracking staggered invoice association: ' . $e->getMessage());
        }
    }

    public function generateOverdueNotices(bool $force = false, int $userId = 1): array
    {
        $config = [
            'overdue_off' => 1 // Default 1 day after due date
        ];
        
        $targetDue = Carbon::now('Asia/Manila')->subDays($config['overdue_off'])->format('Y-m-d');
        $this->log('info', ">> OVERDUE GEN: Finding Invoices with Due Date = $targetDue");

        $invoices = Invoice::whereDate('due_date', $targetDue)
            ->whereIn('status', ['Unpaid', 'Partial'])
            ->get();
            
        $this->log('info', ">> Found " . $invoices->count() . " potential overdue invoices.");

        $cnt = 0;
        $results = [
            'success' => 0, 
            'failed' => 0, 
            'errors' => [],
            'target_due_date' => $targetDue,
            'found_invoices' => $invoices->count()
        ];

        foreach ($invoices as $inv) {
            // Skip accounts that are already Pullout or Disconnected
            $billingAccount = \App\Models\BillingAccount::where('account_no', $inv->account_no)->first();
            if ($billingAccount) {
                $statusName = $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null;
                if (in_array($statusName, ['Pullout', 'Disconnected', 'Pullout Restricted'])) {
                    $this->log('info', "   Skipping Inv: {$inv->id} (Account status is {$statusName} - no notification)");
                    continue;
                }
            }

            if (!$force) {
                // Check if Overdue record exists
                $exists = Overdue::where('invoice_id', $inv->id)->exists();
                if ($exists) {
                    $this->log('info', "   Skipping Inv: {$inv->id} (Overdue notice already sent)");
                    continue;
                }
            }

            $this->log('info', "   Processing Overdue for Inv: {$inv->id} (Acct: {$inv->account_no})");

            try {
                $systemUserId = $userId; 

                // Use Notification Service to Generate PDF and Send Notifications
                $notificationResult = $this->notificationService->notifyOverdue($inv);
                
                $pdfUrl = $notificationResult['pdf_url'] ?? null;

                // Resolve account_id from billing_accounts using account_no
                $billingAccount = \App\Models\BillingAccount::where('account_no', $inv->account_no)->first();
                $accountId = $billingAccount ? $billingAccount->id : $inv->account_id;

                // Insert into Overdue table
                Overdue::create([
                    'account_id' => $accountId,
                    'account_no' => $inv->account_no,
                    'invoice_id' => $inv->id, 
                    'overdue_date' => now(),
                    'print_link' => $pdfUrl,
                    'created_by_user_id' => $systemUserId,
                    'updated_by_user_id' => $systemUserId
                ]);

                $cnt++;
                $results['success']++;

            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = "Error processing invoice {$inv->id}: " . $e->getMessage();
                $this->log('error', "ERROR in Overdue {$inv->account_no}: " . $e->getMessage());
            }
        }

        return $results;
    }

    public function generateDCNotices(bool $force = false, int $userId = 1, bool $bypassDateCheck = false): array
    {
        $config = [
            'dc_note_off' => 3 // Default 3 days after due date
        ];

        $targetDue = Carbon::now('Asia/Manila')->subDays($config['dc_note_off'])->format('Y-m-d');
        $query = Invoice::whereIn('status', ['Unpaid', 'Partial']);
        
        if (!$bypassDateCheck) {
            $query->whereDate('due_date', $targetDue);
            $this->log('info', ">> DC NOTICE GEN: Finding Invoices with Due Date = $targetDue");
        } else {
            $this->log('info', ">> DC NOTICE GEN: Bypassing Date Check (Fetching ALL Unpaid)");
        }
            
        $invoices = $query->get();
            
        $this->log('info', ">> Found " . $invoices->count() . " invoices qualifying for DC Notice.");

        $cnt = 0;
        $results = [
            'success' => 0, 
            'failed' => 0, 
            'errors' => [],
            'target_due_date' => $targetDue,
            'found_invoices' => $invoices->count()
        ];

        foreach ($invoices as $inv) {
            // Skip accounts that are already Pullout or Disconnected
            $billingAccount = \App\Models\BillingAccount::where('account_no', $inv->account_no)->first();
            if ($billingAccount) {
                $statusName = $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null;
                if (in_array($statusName, ['Pullout', 'Disconnected', 'Pullout Restricted'])) {
                    $this->log('info', "   Skipping Inv: {$inv->id} (Account status is {$statusName} - no DC notice)");
                    continue;
                }
            }

            if (!$force) {
                // Check if DC Notice record exists
                $exists = DCNotice::where('invoice_id', $inv->id)->exists();
                if ($exists) {
                    $this->log('info', "   Skipping Inv: {$inv->id} (DC notice already sent)");
                    continue;
                }
            }

            $this->log('info', "   Processing DC Notice for Inv: {$inv->id}");

            try {
                $systemUserId = $userId;

                // Use Notification Service
                $notificationResult = $this->notificationService->notifyDcNotice($inv);

                $pdfUrl = $notificationResult['pdf_url'] ?? null;
                
                if (!$inv->account_no) {
                     throw new \Exception("Invoice {$inv->id} has no account_no");
                }

                // Resolve account_id from billing_accounts using account_no
                $billingAccount = \App\Models\BillingAccount::where('account_no', $inv->account_no)->first();
                $accountId = $billingAccount ? $billingAccount->id : $inv->account_id;

                // Insert into DC Notice table
                DCNotice::create([
                    'account_id' => $accountId,
                    'account_no' => $inv->account_no,
                    'invoice_id' => $inv->id,
                    'dc_notice_date' => now(),
                    'print_link' => $pdfUrl,
                    'created_by_user_id' => $systemUserId,
                    'updated_by_user_id' => $systemUserId
                ]);

                $cnt++;
                $results['success']++;

            } catch (\Exception $e) {
                $results['failed']++;
                $results['errors'][] = "Error processing invoice {$inv->id}: " . $e->getMessage();
                $this->log('error', "ERROR in DC Notice {$inv->account_no}: " . $e->getMessage());
            }
        }

        return $results;
    }
}