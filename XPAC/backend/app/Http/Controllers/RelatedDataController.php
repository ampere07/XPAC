<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RelatedDataController extends Controller
{
    /**
     * Get related invoices by account number
     */
    public function getInvoicesByAccount(string $accountNo): JsonResponse
    {
        try {
            $invoices = DB::table('invoices')
                ->where('account_no', $accountNo)
                ->orderBy('invoice_date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $invoices,
                'count' => $invoices->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching invoices for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch invoices',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related payment portal logs by account number
     */
    public function getPaymentPortalLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $logs = DB::table('payment_portal_logs')
                ->where('account_id', $billingAccount->id)
                ->orderBy('date_time', 'desc')
                ->orderBy('updated_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching payment portal logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch payment portal logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related transactions by account number
     */
    public function getTransactionsByAccount(string $accountNo): JsonResponse
    {
        try {
            $transactions = DB::table('transactions')
                ->leftJoin('payment_methods', 'transactions.payment_method', '=', 'payment_methods.id')
                ->where('transactions.account_no', $accountNo)
                ->select([
                    'transactions.*',
                    'payment_methods.payment_method as payment_method_name'
                ])
                ->orderBy('transactions.created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $transactions,
                'count' => $transactions->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching transactions for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch transactions',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related staggered installations by account number
     */
    public function getStaggeredByAccount(string $accountNo): JsonResponse
    {
        try {
            $staggered = DB::table('staggered_installation')
                ->where('account_no', $accountNo)
                ->orderBy('staggered_date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $staggered,
                'count' => $staggered->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching staggered installations for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch staggered installations',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related discounts by account number
     */
    public function getDiscountsByAccount(string $accountNo): JsonResponse
    {
        try {
            $discounts = DB::table('discounts')
                ->where('account_no', $accountNo)
                ->orderBy('used_date', 'desc')
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $discounts,
                'count' => $discounts->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching discounts for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch discounts',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related service orders by account number
     */
    public function getServiceOrdersByAccount(string $accountNo): JsonResponse
    {
        try {
            $serviceOrders = DB::table('service_orders')
                ->leftJoin('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('service_orders.account_no', $accountNo)
                ->select([
                    'service_orders.*',
                    'billing_accounts.date_installed',
                    DB::raw("CONCAT(customers.first_name, ' ', COALESCE(customers.middle_initial, ''), ' ', customers.last_name) as full_name"),
                    'customers.contact_number_primary as contact_number',
                    'customers.email_address',
                    'customers.address',
                    'customers.desired_plan as plan',
                    'customers.group_name as provider',
                    'customers.barangay',
                    'customers.city',
                    'technical_details.username',
                    'technical_details.connection_type'
                ])
                ->orderBy('service_orders.timestamp', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $serviceOrders,
                'count' => $serviceOrders->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching service orders for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service orders',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related reconnection logs by account number
     */
    public function getReconnectionLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $logs = DB::table('reconnection_logs')
                ->leftJoin('plan_list', 'reconnection_logs.plan_id', '=', 'plan_list.id')
                ->where('reconnection_logs.account_id', $billingAccount->id)
                ->select([
                    'reconnection_logs.*',
                    'plan_list.plan_name'
                ])
                ->orderBy('reconnection_logs.created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching reconnection logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch reconnection logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related disconnected logs by account number
     */
    public function getDisconnectedLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $logs = DB::table('disconnected_logs')
                ->where('account_id', $billingAccount->id)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching disconnected logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch disconnected logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related details update logs by account number
     */
    public function getDetailsUpdateLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $logs = DB::table('details_update_logs')
                ->leftJoin('users as created_user', 'details_update_logs.created_by_user_id', '=', 'created_user.id')
                ->leftJoin('users as updated_user', 'details_update_logs.updated_by_user_id', '=', 'updated_user.id')
                ->where('details_update_logs.account_id', $billingAccount->id)
                ->select([
                    'details_update_logs.*',
                    'created_user.email_address as created_by_user',
                    'updated_user.email_address as updated_by_user',
                ])
                ->orderBy('details_update_logs.updated_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching details update logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch details update logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related audit trail logs by application ID
     */
    public function getAuditTrailLogsByApplication(string $applicationId): JsonResponse
    {
        try {
            $logs = DB::table('audit_trail_logs')
                ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.type')) = 'applications'")
                ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.id')) = ?", [$applicationId])
                ->orWhere(function ($query) use ($applicationId) {
                    $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.type')) = 'applications'")
                          ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.id')) = ?", [$applicationId]);
                })
                ->orderBy('created_at', 'desc')
                ->get();
                
            $logs->transform(function ($log) {
                // Since this model's properties are directly queried with DB query builder, it returns a plain stdClass object
                return [
                    'id' => $log->id ?? '-',
                    'old_details' => $log->old_details ?? null,
                    'new_details' => $log->new_details ?? null,
                    'created_by_user' => $log->created_by_user ?? '-',
                    'updated_by_user' => $log->updated_by_user ?? '-',
                    'created_at' => $log->created_at ?? null,
                    'updated_at' => $log->updated_at ?? null,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching audit trail logs for application: ' . $applicationId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch audit trail logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related plan change logs by account number
     */
    public function getPlanChangeLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $logs = DB::table('plan_change_logs')
                ->leftJoin('plan_list as old_plans', 'plan_change_logs.old_plan_id', '=', 'old_plans.id')
                ->leftJoin('plan_list as new_plans', 'plan_change_logs.new_plan_id', '=', 'new_plans.id')
                ->where('plan_change_logs.account_id', $billingAccount->id)
                ->select([
                    'plan_change_logs.*',
                    'old_plans.plan_name as old_plan_name',
                    'new_plans.plan_name as new_plan_name'
                ])
                ->orderBy('plan_change_logs.created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching plan change logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch plan change logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related service charge logs by account number
     */
    public function getServiceChargeLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            $logs = DB::table('service_charge_logs')
                ->where('account_no', $accountNo)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching service charge logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service charge logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related change due logs by account number
     */
    public function getChangeDueLogsByAccount(string $accountNo): JsonResponse
    {
        try {
            $logs = DB::table('change_due_logs')
                ->where('account_no', $accountNo)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching change due logs for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch change due logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related security deposits by account number
     */
    public function getSecurityDepositsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $deposits = DB::table('security_deposits')
                ->where('account_id', $billingAccount->id)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $deposits,
                'count' => $deposits->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching security deposits for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch security deposits',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related statement of accounts by account number
     */
    public function getStatementOfAccountsByAccount(string $accountNo): JsonResponse
    {
        try {
            $soas = DB::table('statement_of_accounts')
                ->where('account_no', $accountNo)
                ->orderBy('statement_date', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $soas,
                'count' => $soas->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching statement of accounts for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch statement of accounts',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }
    /**
     * Get statement of account by ID
     */
    public function getStatementOfAccountById($id): JsonResponse
    {
        try {
            $soa = \App\Models\StatementOfAccount::with([
                'billingAccount.customer',
                'billingAccount.technicalDetails'
            ])->find($id);

            if (!$soa) {
                return response()->json([
                    'success' => false,
                    'message' => 'Statement of Account not found'
                ], 404);
            }

            // Map the data to match what SOADetails expects
            $customer = $soa->billingAccount?->customer;
            
            $data = [
                'id' => $soa->id,
                'statementDate' => $soa->statement_date ? $soa->statement_date->format('Y-m-d') : null,
                'accountNo' => $soa->account_no,
                'dateInstalled' => $soa->billingAccount?->date_installed,
                'fullName' => $customer?->full_name ?? '',
                'contactNumber' => $customer?->contact_number_primary ?? '',
                'emailAddress' => $customer?->email_address ?? '',
                'address' => $customer?->address ?? '',
                'plan' => $customer?->desired_plan ?? '',
                'provider' => null,
                'balanceFromPreviousBill' => $soa->balance_from_previous_bill,
                'statementNo' => null,
                'paymentReceived' => $soa->payment_received_previous,
                'remainingBalance' => $soa->remaining_balance_previous,
                'monthlyServiceFee' => $soa->monthly_service_fee,
                'serviceCharge' => (float)($soa->service_charge ?? 0),
                'rebate' => (float)($soa->rebate ?? 0),
                'discounts' => (float)($soa->discounts ?? 0),
                'staggered' => (float)($soa->staggered ?? 0),
                'vat' => $soa->vat,
                'dueDate' => $soa->due_date ? $soa->due_date->format('Y-m-d') : null,
                'amountDue' => $soa->amount_due,
                'totalAmountDue' => $soa->total_amount_due,
                'deliveryStatus' => null,
                'printLink' => $soa->print_link,
                'barangay' => $customer?->barangay ?? '',
                'city' => $customer?->city ?? '',
                'region' => $customer?->region ?? '',
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching statement of account: ' . $id, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch statement of account',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Generate PDF for a Statement of Account and upload to Google Drive
     */
    public function generateSoaPdf($id): JsonResponse
    {
        try {
            $soa = \App\Models\StatementOfAccount::with(['billingAccount.customer'])->find($id);

            if (!$soa) {
                return response()->json([
                    'success' => false,
                    'message' => 'Statement of Account not found'
                ], 404);
            }

            $pdfService = app(\App\Services\GoogleDrivePdfGenerationService::class);
            $result = $pdfService->generateBillingPdf($soa->billingAccount, null, $soa);

            if ($result['success']) {
                $soa->print_link = $result['url'];
                $soa->save();

                return response()->json([
                    'success' => true,
                    'message' => 'PDF generated successfully',
                    'pdf_url' => $result['url'],
                    'data' => [
                        'url' => $result['url'],
                        'print_link' => $result['url']
                    ]
                ]);
            } else {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to generate PDF',
                    'error' => $result['error'] ?? 'Unknown error'
                ], 500);
            }
        } catch (\Exception $e) {
            Log::error('Error generating SOA PDF: ' . $id, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to generate PDF',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    /**
     * Get invoice by ID
     */
    public function getInvoiceById($id): JsonResponse
    {
        try {
            $invoice = \App\Models\Invoice::with([
                'billingAccount.customer',
                'billingAccount.technicalDetails'
            ])->find($id);

            if (!$invoice) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invoice not found'
                ], 404);
            }

            // Map the data to match what InvoiceDetails expects
            $customer = $invoice->billingAccount?->customer;
            
            $data = [
                'id' => $invoice->id,
                'invoiceDate' => $invoice->invoice_date ? $invoice->invoice_date->format('Y-m-d') : null,
                'invoiceStatus' => $invoice->status,
                'accountNo' => $invoice->account_no,
                'fullName' => $customer?->full_name ?? '',
                'contactNumber' => $customer?->contact_number_primary ?? '',
                'emailAddress' => $customer?->email_address ?? '',
                'address' => $customer?->address ?? '',
                'plan' => $customer?->desired_plan ?? '',
                'dateInstalled' => $invoice->billingAccount?->date_installed,
                'provider' => null,
                'invoiceNo' => null, // Let frontend handle fallback
                'invoiceBalance' => (float)($invoice->invoice_balance ?? 0),
                'serviceCharge' => (float)($invoice->service_charge ?? 0),
                'rebate' => (float)($invoice->rebate ?? 0),
                'discounts' => (float)($invoice->discounts ?? 0),
                'staggered' => (float)($invoice->staggered ?? 0),
                'totalAmountDue' => (float)($invoice->total_amount ?? 0),
                'dueDate' => $invoice->due_date ? $invoice->due_date->format('Y-m-d') : null,
                'invoicePayment' => (float)($invoice->received_payment ?? 0),
                'paymentMethod' => null,
                'dateProcessed' => null,
                'processedBy' => null,
                'remarks' => null,
                'vat' => null,
                'amountDue' => (float)($invoice->amount_due ?? 0),
                'balanceFromPreviousBill' => (float)($invoice->balance_from_previous_bill ?? 0),
                'paymentReceived' => (float)($invoice->payment_received ?? 0),
                'remainingBalance' => (float)($invoice->remaining_balance ?? 0),
                'monthlyServiceFee' => (float)($invoice->monthly_service_fee ?? 0),
                'staggeredPaymentsCount' => 0,
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching invoice: ' . $id, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch invoice',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    /**
     * Get payment portal log by ID
     */
    public function getPaymentPortalLogById($id): JsonResponse
    {
        try {
            $log = DB::table('payment_portal_logs')
                ->leftJoin('billing_accounts', 'payment_portal_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('payment_portal_logs.id', $id)
                ->select([
                    'payment_portal_logs.*',
                    'billing_accounts.account_no as accountNo',
                    'billing_accounts.account_balance as accountBalance',
                    'customers.first_name',
                    'customers.middle_initial',
                    'customers.last_name',
                    'customers.contact_number_primary as contactNo',
                    'customers.address',
                    'customers.barangay',
                    'customers.city',
                    'customers.desired_plan as plan'
                ])
                ->first();

            if (!$log) {
                return response()->json([
                    'success' => false,
                    'message' => 'Payment portal log not found'
                ], 404);
            }

            // Manually add fullName if needed (though the DB might have it if it's a persisted field, but Customer model has it as an attribute)
            $log->fullName = trim(($log->first_name ?? '') . ' ' . ($log->middle_initial ?? '') . ' ' . ($log->last_name ?? ''));

            return response()->json([
                'success' => true,
                'data' => $log
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching payment portal log: ' . $id, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch payment portal log',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    /**
     * Get transaction by ID
     */
    public function getTransactionById($id): JsonResponse
    {
        try {
            $transaction = DB::table('transactions')
                ->leftJoin('payment_methods', 'transactions.payment_method', '=', 'payment_methods.id')
                ->leftJoin('billing_accounts', 'transactions.account_no', '=', 'billing_accounts.account_no')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('transactions.id', $id)
                ->select([
                    'transactions.*',
                    'payment_methods.payment_method as payment_method_name',
                    'billing_accounts.id as billing_account_id',
                    'billing_accounts.account_no as billing_account_no',
                    'billing_accounts.account_balance',
                    'customers.first_name',
                    'customers.middle_initial',
                    'customers.last_name',
                    'customers.contact_number_primary',
                    'customers.address',
                    'customers.barangay',
                    'customers.city',
                    'customers.region',
                    'customers.desired_plan'
                ])
                ->first();

            if (!$transaction) {
                return response()->json([
                    'success' => false,
                    'message' => 'Transaction not found'
                ], 404);
            }

            // Structure the data to match the frontend Transaction interface
            $data = [
                'id' => $transaction->id,
                'account_no' => $transaction->account_no,
                'transaction_type' => $transaction->transaction_type,
                'received_payment' => (float)$transaction->received_payment,
                'payment_date' => $transaction->payment_date,
                'date_processed' => $transaction->date_processed,
                'processed_by_user' => $transaction->processed_by_user,
                'payment_method' => $transaction->payment_method,
                'reference_no' => $transaction->reference_no,
                'or_no' => $transaction->or_no,
                'remarks' => $transaction->remarks,
                'status' => $transaction->status,
                'image_url' => $transaction->image_url,
                'created_at' => $transaction->created_at,
                'updated_at' => $transaction->updated_at,
                'payment_method_info' => [
                    'id' => $transaction->payment_method,
                    'payment_method' => $transaction->payment_method_name
                ],
                'account' => [
                    'id' => $transaction->billing_account_id,
                    'account_no' => $transaction->billing_account_no,
                    'account_balance' => (float)$transaction->account_balance,
                    'customer' => [
                        'full_name' => trim(($transaction->first_name ?? '') . ' ' . ($transaction->middle_initial ?? '') . ' ' . ($transaction->last_name ?? '')),
                        'contact_number_primary' => $transaction->contact_number_primary,
                        'address' => $transaction->address,
                        'barangay' => $transaction->barangay,
                        'city' => $transaction->city,
                        'region' => $transaction->region,
                        'desired_plan' => $transaction->desired_plan
                    ]
                ]
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching transaction: ' . $id, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get all payment methods
     */
    public function getPaymentMethods(): JsonResponse
    {
        try {
            $methods = DB::table('payment_methods')
                ->select('id', 'payment_method')
                ->orderBy('payment_method', 'asc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $methods
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch payment methods',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get distinct transaction types from transactions table
     */
    public function getDistinctTransactionTypes(): JsonResponse
    {
        try {
            $types = DB::table('transactions')
                ->whereNotNull('transaction_type')
                ->where('transaction_type', '!=', '')
                ->distinct()
                ->pluck('transaction_type');

            return response()->json([
                'success' => true,
                'data' => $types
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch distinct transaction types',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get distinct barangay and city from customers table
     */
    public function getDistinctCustomerLocations(): JsonResponse
    {
        try {
            $barangays = DB::table('customers')
                ->whereNotNull('barangay')
                ->where('barangay', '!=', '')
                ->distinct()
                ->pluck('barangay')
                ->sort()
                ->values();

            $cities = DB::table('customers')
                ->whereNotNull('city')
                ->where('city', '!=', '')
                ->distinct()
                ->pluck('city')
                ->sort()
                ->values();

            $regions = DB::table('customers')
                ->whereNotNull('region')
                ->where('region', '!=', '')
                ->distinct()
                ->pluck('region')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'barangays' => $barangays,
                    'cities' => $cities,
                    'regions' => $regions
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch customer locations',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get distinct status and transaction_status from payment_portal_logs
     */
    public function getPaymentPortalLookupData(): JsonResponse
    {
        try {
            $statuses = DB::table('payment_portal_logs')
                ->whereNotNull('status')
                ->where('status', '!=', '')
                ->distinct()
                ->pluck('status')
                ->sort()
                ->values();

            $transactionStatuses = DB::table('payment_portal_logs')
                ->whereNotNull('transaction_status')
                ->where('transaction_status', '!=', '')
                ->distinct()
                ->pluck('transaction_status')
                ->sort()
                ->values();

            $channels = DB::table('payment_portal_logs')
                ->whereNotNull('payment_channel')
                ->where('payment_channel', '!=', '')
                ->distinct()
                ->pluck('payment_channel')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'statuses' => $statuses,
                    'transaction_statuses' => $transactionStatuses,
                    'payment_channels' => $channels
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch payment portal lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get lookup data for Job Order filters
     */
    public function getJobOrderLookupData(): JsonResponse
    {
        try {
            $lcpNames = DB::table('lcp')
                ->whereNotNull('lcp_name')
                ->where('lcp_name', '!=', '')
                ->distinct()
                ->pluck('lcp_name')
                ->sort()
                ->values();

            $napNames = DB::table('nap')
                ->whereNotNull('nap_name')
                ->where('nap_name', '!=', '')
                ->distinct()
                ->pluck('nap_name')
                ->sort()
                ->values();

            $ports = DB::table('job_orders')
                ->whereNotNull('port')
                ->where('port', '!=', '')
                ->distinct()
                ->pluck('port')
                ->sort()
                ->values();

            $vlans = DB::table('job_orders')
                ->whereNotNull('vlan')
                ->where('vlan', '!=', '')
                ->distinct()
                ->pluck('vlan')
                ->sort()
                ->values();

            $lcpnaps = DB::table('job_orders')
                ->whereNotNull('lcpnap')
                ->where('lcpnap', '!=', '')
                ->distinct()
                ->pluck('lcpnap')
                ->sort()
                ->values();

            $routerModels = DB::table('job_orders')
                ->whereNotNull('router_model')
                ->where('router_model', '!=', '')
                ->distinct()
                ->pluck('router_model')
                ->sort()
                ->values();

            $usageTypes = DB::table('job_orders')
                ->whereNotNull('usage_type')
                ->where('usage_type', '!=', '')
                ->distinct()
                ->pluck('usage_type')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'lcp_names' => $lcpNames,
                    'nap_names' => $napNames,
                    'ports' => $ports,
                    'vlans' => $vlans,
                    'lcpnaps' => $lcpnaps,
                    'router_models' => $routerModels,
                    'usage_types' => $usageTypes
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch job order lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get lookup data for Service Order filters
     */
    public function getServiceOrderLookupData(): JsonResponse
    {
        try {
            $lcpNames = DB::table('lcp')
                ->whereNotNull('lcp_name')
                ->where('lcp_name', '!=', '')
                ->distinct()
                ->pluck('lcp_name')
                ->sort()
                ->values();

            $napNames = DB::table('nap')
                ->whereNotNull('nap_name')
                ->where('nap_name', '!=', '')
                ->distinct()
                ->pluck('nap_name')
                ->sort()
                ->values();

            // From service_orders table - old values
            $ports = DB::table('service_orders')
                ->whereNotNull('old_port')
                ->where('old_port', '!=', '')
                ->distinct()
                ->pluck('old_port')
                ->sort()
                ->values();

            $vlans = DB::table('service_orders')
                ->whereNotNull('old_vlan')
                ->where('old_vlan', '!=', '')
                ->distinct()
                ->pluck('old_vlan')
                ->sort()
                ->values();

            $lcpnaps = DB::table('service_orders')
                ->whereNotNull('old_lcpnap')
                ->where('old_lcpnap', '!=', '')
                ->distinct()
                ->pluck('old_lcpnap')
                ->sort()
                ->values();

            // From service_orders table - new values
            $newPorts = DB::table('service_orders')
                ->whereNotNull('new_port')
                ->where('new_port', '!=', '')
                ->distinct()
                ->pluck('new_port')
                ->sort()
                ->values();

            $newVlans = DB::table('service_orders')
                ->whereNotNull('new_vlan')
                ->where('new_vlan', '!=', '')
                ->distinct()
                ->pluck('new_vlan')
                ->sort()
                ->values();

            $newLcpnaps = DB::table('service_orders')
                ->whereNotNull('new_lcpnap')
                ->where('new_lcpnap', '!=', '')
                ->distinct()
                ->pluck('new_lcpnap')
                ->sort()
                ->values();

            $routerModels = DB::table('job_orders')
                ->whereNotNull('router_model')
                ->where('router_model', '!=', '')
                ->distinct()
                ->pluck('router_model')
                ->sort()
                ->values();

            $usageTypes = DB::table('job_orders')
                ->whereNotNull('usage_type')
                ->where('usage_type', '!=', '')
                ->distinct()
                ->pluck('usage_type')
                ->sort()
                ->values();

            $concerns = DB::table('service_orders')
                ->whereNotNull('concern')
                ->where('concern', '!=', '')
                ->distinct()
                ->pluck('concern')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'lcp_names' => $lcpNames,
                    'nap_names' => $napNames,
                    'ports' => $ports,
                    'vlans' => $vlans,
                    'lcpnaps' => $lcpnaps,
                    'new_ports' => $newPorts,
                    'new_vlans' => $newVlans,
                    'new_lcpnaps' => $newLcpnaps,
                    'router_models' => $routerModels,
                    'usage_types' => $usageTypes,
                    'concerns' => $concerns
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch service order lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getCustomerLookupData(): JsonResponse
    {
        try {
            $lcpNames = DB::table('lcp')->pluck('lcp_name')->sort()->values();
            $napNames = DB::table('nap')->pluck('nap_name')->sort()->values();

            $ports = DB::table('technical_details')
                ->whereNotNull('port')
                ->where('port', '!=', '')
                ->distinct()
                ->pluck('port')
                ->sort()
                ->values();

            $vlans = DB::table('technical_details')
                ->whereNotNull('vlan')
                ->where('vlan', '!=', '')
                ->distinct()
                ->pluck('vlan')
                ->sort()
                ->values();

            $lcpnaps = DB::table('technical_details')
                ->whereNotNull('lcpnap')
                ->where('lcpnap', '!=', '')
                ->distinct()
                ->pluck('lcpnap')
                ->sort()
                ->values();

            $routerModels = DB::table('technical_details')
                ->whereNotNull('router_model')
                ->where('router_model', '!=', '')
                ->distinct()
                ->pluck('router_model')
                ->sort()
                ->values();

            $usageTypes = DB::table('technical_details')
                ->whereNotNull('usage_type')
                ->where('usage_type', '!=', '')
                ->distinct()
                ->pluck('usage_type')
                ->sort()
                ->values();

            $connectionTypes = DB::table('technical_details')
                ->whereNotNull('connection_type')
                ->where('connection_type', '!=', '')
                ->distinct()
                ->pluck('connection_type')
                ->sort()
                ->values();

            $usernameStatuses = DB::table('technical_details')
                ->whereNotNull('username_status')
                ->where('username_status', '!=', '')
                ->distinct()
                ->pluck('username_status')
                ->sort()
                ->values();

            $groupNames = DB::table('customers')
                ->whereNotNull('group_name')
                ->where('group_name', '!=', '')
                ->distinct()
                ->pluck('group_name')
                ->sort()
                ->values();

            // Fetch session_status and session_group from online_status table
            $sessionStatuses = DB::table('online_status')
                ->whereNotNull('session_status')
                ->where('session_status', '!=', '')
                ->distinct()
                ->pluck('session_status')
                ->sort()
                ->values();

            $sessionGroups = DB::table('online_status')
                ->whereNotNull('session_group')
                ->where('session_group', '!=', '')
                ->distinct()
                ->pluck('session_group')
                ->sort()
                ->values();

            // Try to get billing statuses, if table exists
            $billingStatuses = [];
            try {
                $billingStatuses = DB::table('billing_status')->select('id', 'status_name as name')->get();
            } catch (\Exception $e) {
                // Ignore if table doesn't exist
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'lcp_names' => $lcpNames,
                    'nap_names' => $napNames,
                    'ports' => $ports,
                    'vlans' => $vlans,
                    'lcpnaps' => $lcpnaps,
                    'router_models' => $routerModels,
                    'usage_types' => $usageTypes,
                    'connection_types' => $connectionTypes,
                    'username_statuses' => $usernameStatuses,
                    'group_names' => $groupNames,
                    'session_statuses' => $sessionStatuses,
                    'session_groups' => $sessionGroups,
                    'billing_statuses' => $billingStatuses
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch customer lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    /**
     * Get unique payment channels from logs
     */
    public function getUniquePaymentChannels(): JsonResponse
    {
        try {
            $channels = DB::table('payment_portal_logs')
                ->whereNotNull('payment_channel')
                ->where('payment_channel', '!=', '')
                ->distinct()
                ->pluck('payment_channel');

            return response()->json([
                'success' => true,
                'data' => $channels
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to fetch unique payment channels', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch unique payment channels',
                'data' => []
            ], 500);
        }
    }

    public function getInvoiceLookupData(): JsonResponse
    {
        try {
            $remarks = DB::table('invoices')
                ->whereNotNull('remarks')
                ->where('remarks', '!=', '')
                ->distinct()
                ->pluck('remarks')
                ->sort()
                ->values();

            $modifiedBy = DB::table('invoices')
                ->whereNotNull('updated_by')
                ->where('updated_by', '!=', '')
                ->distinct()
                ->pluck('updated_by')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'remarks' => $remarks,
                    'modified_by' => $modifiedBy
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch invoice lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getSOALookupData(): JsonResponse
    {
        try {
            $updatedBy = DB::table('statement_of_accounts')
                ->whereNotNull('updated_by')
                ->where('updated_by', '!=', '')
                ->distinct()
                ->pluck('updated_by');

            $createdBy = DB::table('statement_of_accounts')
                ->whereNotNull('created_by')
                ->where('created_by', '!=', '')
                ->distinct()
                ->pluck('created_by');

            $modifiedBy = $updatedBy->merge($createdBy)->unique()->sort()->values();

            $remarks = DB::table('statement_of_accounts')
                ->whereNotNull('remarks')
                ->where('remarks', '!=', '')
                ->distinct()
                ->pluck('remarks')
                ->sort()
                ->values();

            $statuses = DB::table('statement_of_accounts')
                ->whereNotNull('status')
                ->where('status', '!=', '')
                ->distinct()
                ->pluck('status')
                ->sort()
                ->values();

            return response()->json([
                'success' => true,
                'data' => [
                    'modified_by' => $modifiedBy,
                    'remarks' => $remarks,
                    'statuses' => $statuses
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch SOA lookup data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get related audit trail logs by job order ID
     */
    public function getAuditTrailLogsByJobOrder(string $jobOrderId): JsonResponse
    {
        try {
            // Fetch the job order to get the associated application_id
            $jobOrder = DB::table('job_orders')->where('id', $jobOrderId)->first();
            $applicationId = $jobOrder ? $jobOrder->application_id : null;

            $query = DB::table('audit_trail_logs')
                ->where(function ($query) use ($jobOrderId) {
                    $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.type')) = 'joborders'")
                          ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.id')) = ?", [$jobOrderId])
                          ->orWhere(function ($q) use ($jobOrderId) {
                              $q->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.type')) = 'joborders'")
                                ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.id')) = ?", [$jobOrderId]);
                          });
                });

            // If there's an associated application, also fetch its audit logs
            if ($applicationId) {
                $query->orWhere(function ($query) use ($applicationId) {
                    $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.type')) = 'applications'")
                          ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(new_details, '$.id')) = ?", [$applicationId])
                          ->orWhere(function ($q) use ($applicationId) {
                              $q->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.type')) = 'applications'")
                                ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(old_details, '$.id')) = ?", [$applicationId]);
                          });
                });
            }

            $logs = $query->orderBy('created_at', 'desc')->get();
                
            $logs->transform(function ($log) {
                return [
                    'id' => $log->id ?? '-',
                    'old_details' => $log->old_details ?? null,
                    'new_details' => $log->new_details ?? null,
                    'created_by_user' => $log->created_by_user ?? '-',
                    'updated_by_user' => $log->updated_by_user ?? '-',
                    'created_at' => $log->created_at ?? null,
                    'updated_at' => $log->updated_at ?? null,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching audit trail logs for job order: ' . $jobOrderId, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch audit trail logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related details update logs by service order ID
     *
     * Service order edits are logged into details_update_logs with a JSON
     * payload containing a "service_order_id" key (types: service_order_details
     * and service_order_related_tables).
     */
    public function getDetailsUpdateLogsByServiceOrder(string $serviceOrderId): JsonResponse
    {
        try {
            $logs = DB::table('details_update_logs')
                ->leftJoin('users as created_user', 'details_update_logs.created_by_user_id', '=', 'created_user.id')
                ->leftJoin('users as updated_user', 'details_update_logs.updated_by_user_id', '=', 'updated_user.id')
                ->where(function ($query) use ($serviceOrderId) {
                    $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(details_update_logs.new_details, '$.service_order_id')) = ?", [$serviceOrderId])
                          ->orWhereRaw("JSON_UNQUOTE(JSON_EXTRACT(details_update_logs.old_details, '$.service_order_id')) = ?", [$serviceOrderId]);
                })
                ->select([
                    'details_update_logs.*',
                    'created_user.email_address as created_by_user',
                    'updated_user.email_address as updated_by_user',
                ])
                ->orderBy('details_update_logs.updated_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $logs,
                'count' => $logs->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching details update logs for service order: ' . $serviceOrderId, [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch details update logs',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related job orders by account number
     */
    public function getJobOrdersByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $jobOrders = DB::table('job_orders')
                ->where('account_id', $billingAccount->id)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $jobOrders,
                'count' => $jobOrders->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching job orders for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch job orders',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }

    /**
     * Get related applications by account number
     */
    public function getApplicationsByAccount(string $accountNo): JsonResponse
    {
        try {
            // First find the numeric account ID from the account number
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->first();
            
            if (!$billingAccount) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $applicationIds = DB::table('job_orders')
                ->where('account_id', $billingAccount->id)
                ->whereNotNull('application_id')
                ->pluck('application_id')
                ->unique()
                ->toArray();

            if (empty($applicationIds)) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'count' => 0
                ]);
            }

            $applications = DB::table('applications')
                ->whereIn('id', $applicationIds)
                ->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $applications,
                'count' => $applications->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching applications for account: ' . $accountNo, [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch applications',
                'error' => $e->getMessage(),
                'data' => [],
                'count' => 0
            ], 500);
        }
    }
}




