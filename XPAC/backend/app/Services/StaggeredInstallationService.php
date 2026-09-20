<?php

namespace App\Services;

use App\Models\StaggeredInstallation;
use App\Models\BillingAccount;
use App\Models\Invoice;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class StaggeredInstallationService
{
    /**
     * Create a new staggered installation and apply initial payment to invoices
     */
    public function createStaggeredInstallation(array $data): StaggeredInstallation
    {
        DB::beginTransaction();
        
        try {
            $staggered = StaggeredInstallation::create([
                'account_no' => $data['account_no'],
                'staggered_install_no' => $data['staggered_install_no'] ?? $this->generateInstallNo($data['account_no']),
                'staggered_date' => $data['staggered_date'] ?? now(),
                'staggered_balance' => $data['staggered_balance'],
                'months_to_pay' => $data['months_to_pay'],
                'monthly_payment' => $data['monthly_payment'],
                'modified_by' => $data['modified_by'] ?? 'unknown',
                'modified_date' => now(),
                'user_email' => $data['user_email'] ?? 'unknown',
                'remarks' => $data['remarks'] ?? null
            ]);

            // Apply initial staggered_balance to oldest invoices
            if ($staggered->staggered_balance > 0) {
                $this->applyPaymentToInvoices(
                    $staggered->account_no,
                    $staggered->staggered_balance,
                    $staggered->id,
                    'Initial staggered payment'
                );
            }

            DB::commit();
            Log::info('Staggered installation created', [
                'staggered_id' => $staggered->id,
                'account_no' => $staggered->account_no,
                'staggered_balance' => $staggered->staggered_balance,
                'months_to_pay' => $staggered->months_to_pay
            ]);

            return $staggered;
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Failed to create staggered installation: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Apply payment to oldest unpaid/partial invoices
     */
    private function applyPaymentToInvoices(string $accountNo, float $paymentAmount, int $staggeredId, string $remarks): array
    {
        $invoices = Invoice::where('account_no', $accountNo)
            ->whereIn('status', ['Unpaid', 'Partial'])
            ->orderBy('invoice_date', 'asc')
            ->get();

        $remainingPayment = $paymentAmount;
        $invoicesPaid = [];
        $invoicesPartial = [];

        foreach ($invoices as $invoice) {
            if ($remainingPayment <= 0) {
                break;
            }

            $totalAmount = floatval($invoice->total_amount ?? 0);
            $currentReceived = floatval($invoice->received_payment ?? 0);
            $amountDue = $totalAmount - $currentReceived;

            if ($remainingPayment >= $amountDue) {
                // Fully pay invoice
                $invoice->received_payment = round($totalAmount, 2);
                $invoice->status = 'Paid';
                $remainingPayment -= $amountDue;
                $invoicesPaid[] = $invoice->id;
            } else {
                // Partial payment
                $invoice->received_payment = round($currentReceived + $remainingPayment, 2);
                $invoice->status = 'Partial';
                $invoicesPartial[] = $invoice->id;
                $remainingPayment = 0;
            }

            $invoice->updated_by = 'staggered_system';
            $invoice->save();
        }

        // Update billing account balance
        $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
        if ($billingAccount) {
            $currentBalance = floatval($billingAccount->account_balance ?? 0);
            $newBalance = $currentBalance - $paymentAmount;
            $billingAccount->account_balance = round($newBalance, 2);
            $billingAccount->balance_update_date = now();
            $billingAccount->save();
        }

        Log::info('Payment applied to invoices', [
            'account_no' => $accountNo,
            'payment_amount' => $paymentAmount,
            'invoices_paid' => $invoicesPaid,
            'invoices_partial' => $invoicesPartial,
            'remaining_payment' => $remainingPayment
        ]);

        return [
            'invoices_paid' => $invoicesPaid,
            'invoices_partial' => $invoicesPartial,
            'remaining_payment' => $remainingPayment
        ];
    }

    /**
     * Process monthly payment for active staggered installations
     * Called during invoice generation
     */
    public function processMonthlyPayments(string $accountNo, int $invoiceId): void
    {
        $staggeredInstallations = StaggeredInstallation::where('account_no', $accountNo)
            ->where('months_to_pay', '>', 0)
            ->get();

        foreach ($staggeredInstallations as $staggered) {
            try {
                $this->applyMonthlyPayment($staggered, $invoiceId);
            } catch (\Exception $e) {
                Log::error('Failed to apply monthly staggered payment', [
                    'staggered_id' => $staggered->id,
                    'account_no' => $accountNo,
                    'error' => $e->getMessage()
                ]);
            }
        }
    }

    /**
     * Apply monthly payment for a single staggered installation
     */
    private function applyMonthlyPayment(StaggeredInstallation $staggered, int $invoiceId): void
    {
        DB::beginTransaction();

        try {
            // Determine which month column to update
            $monthsRemaining = $staggered->months_to_pay;
            $monthColumn = $this->getNextMonthColumn($staggered);

            if (!$monthColumn) {
                Log::warning('No available month column for staggered', [
                    'staggered_id' => $staggered->id,
                    'months_to_pay' => $monthsRemaining
                ]);
                DB::rollBack();
                return;
            }

            // Add monthly payment to account balance
            $billingAccount = BillingAccount::where('account_no', $staggered->account_no)->first();
            if ($billingAccount) {
                $currentBalance = floatval($billingAccount->account_balance ?? 0);
                $newBalance = $currentBalance + $staggered->monthly_payment;
                $billingAccount->account_balance = round($newBalance, 2);
                $billingAccount->balance_update_date = now();
                $billingAccount->save();

                Log::info('Monthly staggered payment added to balance', [
                    'account_no' => $staggered->account_no,
                    'monthly_payment' => $staggered->monthly_payment,
                    'old_balance' => $currentBalance,
                    'new_balance' => $newBalance
                ]);
            }

            // Store invoice ID in the month column
            $staggered->{$monthColumn} = $invoiceId;
            
            // Decrement months_to_pay
            $staggered->months_to_pay = $monthsRemaining - 1;
            $staggered->modified_date = now();
            $staggered->save();

            Log::info('Staggered monthly payment processed', [
                'staggered_id' => $staggered->id,
                'account_no' => $staggered->account_no,
                'month_column' => $monthColumn,
                'invoice_id' => $invoiceId,
                'months_remaining' => $staggered->months_to_pay
            ]);

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * Get the next available month column to store invoice ID
     */
    private function getNextMonthColumn(StaggeredInstallation $staggered): ?string
    {
        $monthColumns = [
            'month1', 'month2', 'month3', 'month4', 'month5', 'month6',
            'month7', 'month8', 'month9', 'month10', 'month11', 'month12'
        ];

        foreach ($monthColumns as $column) {
            if (empty($staggered->{$column})) {
                return $column;
            }
        }

        return null;
    }

    /**
     * Generate installation number
     */
    private function generateInstallNo(string $accountNo): string
    {
        $count = StaggeredInstallation::where('account_no', $accountNo)->count();
        return $accountNo . '-SI-' . str_pad($count + 1, 3, '0', STR_PAD_LEFT);
    }

    /**
     * Get active staggered installations for an account
     */
    public function getActiveStaggeredInstallations(string $accountNo): \Illuminate\Database\Eloquent\Collection
    {
        return StaggeredInstallation::where('account_no', $accountNo)
            ->where('months_to_pay', '>', 0)
            ->get();
    }
}
