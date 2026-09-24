<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Hash;
use App\Http\Controllers\UserController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\SetupController;
use App\Http\Controllers\LogsController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\JobOrderController;
use App\Http\Controllers\ApplicationVisitController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\CityController;
use App\Http\Controllers\RegionController;
use App\Http\Controllers\DebugController;
use App\Http\Controllers\EmergencyLocationController;
use App\Http\Controllers\RadiusController;
use App\Http\Controllers\RadiusConfigController;
use App\Http\Controllers\ManualRadiusOperationsController;
use App\Http\Controllers\SmsConfigController;
use App\Http\Controllers\SMSTemplateController;
use App\Http\Controllers\EmailTemplateController;
use App\Http\Controllers\EmailQueueController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\BillingGenerationController;
use App\Http\Controllers\ImageProxyController;
use App\Http\Controllers\SettingsColorPaletteController;
use App\Http\Controllers\RelatedDataController;
use App\Http\Controllers\InventoryRelatedDataController;
use App\Http\Controllers\PPPoEController;
use App\Models\User;
use App\Models\MassRebate;
use App\Services\TechnicianSessionGuard;
use App\Http\Controllers\Api\MonitorController;
use App\Http\Controllers\Api\SmsBlastController;
use App\Http\Controllers\Api\ExpensesLogController;
use App\Http\Controllers\Api\DisconnectionLogsController;
use App\Http\Controllers\Api\ReconnectionLogsController;
use App\Http\Controllers\ConsolidatedNotificationController;
use App\Http\Controllers\Api\ServiceOrderItemApiController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\TechnicianController;
use App\Http\Controllers\AgentController;
use App\Http\Controllers\TechInOutController;
use App\Http\Controllers\Api\PaymentPortalLogsController;
use App\Http\Controllers\CommissionController;

Route::apiResource('technicians', TechnicianController::class);
Route::apiResource('agents', AgentController::class);
Route::apiResource('roles', RoleController::class);
Route::get('/tech-in-out/status', [TechInOutController::class, 'getStatus']);
Route::post('/tech-in-out/time-in', [TechInOutController::class, 'timeIn']);
Route::post('/tech-in-out/time-out', [TechInOutController::class, 'timeOut']);
Route::get('/commissions', [CommissionController::class, 'index']);
Route::get('/commissions/history', [CommissionController::class, 'getHistory']);
Route::post('/commissions/history', [CommissionController::class, 'storeHistory']);
Route::get('/commissions/trend', [CommissionController::class, 'getTrend']);
Route::get('/commissions/agent-job-orders', [CommissionController::class, 'getJobOrdersByAgent']);
Route::get('/commissions/incentive-history', [CommissionController::class, 'getIncentiveHistory']);
Route::get('/commissions/bonus-history', [CommissionController::class, 'getBonusHistory']);
Route::post('/commissions/bonus-history', [CommissionController::class, 'storeBonusHistory']);
// Weekly / monthly onboarding achievements. Reading is scoped in the controller
// (a non-admin reads their own); claiming credits the caller, and only an
// administrator may name another agent.
Route::get('/commissions/achievements', [CommissionController::class, 'getAchievements']);
Route::post('/commissions/achievements', [CommissionController::class, 'storeAchievement']);
// Payout approval: a payout or bonus is recorded as Pending and only moves the
// agent's balance once approved here. Administrator / SuperAdmin only (enforced
// in the controller via App\Support\AgentAccess); the approver is taken from
// the signed-in user, never from the request body.
Route::post('/commissions/history/{id}/approve', [CommissionController::class, 'approveHistory'])->whereNumber('id');
Route::post('/commissions/history/{id}/reject', [CommissionController::class, 'rejectHistory'])->whereNumber('id');
Route::post('/commissions/bonus-history/{id}/approve', [CommissionController::class, 'approveBonus'])->whereNumber('id');
Route::post('/commissions/bonus-history/{id}/reject', [CommissionController::class, 'rejectBonus'])->whereNumber('id');

// ── Weekly agent referral invoices ──────────────────────────────────────────
// Scoped inside the controller: an agent sees their team's invoices, or their
// own when they have no team; an administrator sees their organisation's; a
// superadmin sees all. generate / status are Administrator / SuperAdmin only.
// The literal paths are registered before the /{id} ones (which also carry
// whereNumber) so they can never be read as an id.
Route::get('/agent-invoices', [\App\Http\Controllers\AgentInvoiceController::class, 'index']);
Route::post('/agent-invoices/generate', [\App\Http\Controllers\AgentInvoiceController::class, 'generate']);
Route::get('/agent-invoices/periods', [\App\Http\Controllers\AgentInvoiceController::class, 'periods']);
Route::get('/agent-invoices/archive', [\App\Http\Controllers\AgentInvoiceController::class, 'archive']);
Route::get('/agent-invoices/{id}', [\App\Http\Controllers\AgentInvoiceController::class, 'show'])->whereNumber('id');
Route::get('/agent-invoices/{id}/pdf', [\App\Http\Controllers\AgentInvoiceController::class, 'pdf'])->whereNumber('id');
Route::patch('/agent-invoices/{id}/status', [\App\Http\Controllers\AgentInvoiceController::class, 'updateStatus'])->whereNumber('id');

// Reports module is Super Admin only — enforced here (not just hidden in the UI) since
// reports can expose org-wide financial/commission data.
Route::middleware('role:superadmin')->group(function () {
    Route::get('/reports', [ReportController::class , 'index']);
    Route::post('/reports', [ReportController::class , 'store']);
    Route::get('/reports/options', [ReportController::class , 'options']);
    // Registered before the /reports/{id} routes below, which have no numeric
    // constraint and would otherwise match "settings" as an id.
    // Draft preview: renders the form's current values without creating anything.
    // Registered with the other literal paths, ahead of /reports/{id}.
    Route::post('/reports/preview', [ReportController::class , 'previewDraft']);
    Route::get('/reports/settings', [ReportController::class , 'settings']);
    Route::put('/reports/settings', [ReportController::class , 'updateSettings']);
    Route::put('/reports/{id}', [ReportController::class , 'update'])->whereNumber('id');
    Route::delete('/reports/{id}', [ReportController::class , 'destroy'])->whereNumber('id');
    Route::get('/reports/{id}/preview', [ReportController::class , 'preview'])->whereNumber('id');
    Route::post('/reports/{id}/regenerate', [ReportController::class , 'regenerate'])->whereNumber('id');
    Route::post('/reports/{id}/send-now', [ReportController::class , 'sendNow'])->whereNumber('id');
    Route::get('/reports/{id}/dispatches', [ReportController::class , 'dispatches'])->whereNumber('id');
    Route::get('/reports-migrate-pdf', function () {
        $reports = \App\Models\Report::all();
        $pdfService = new \App\Services\ReportPdfService();
        $driveService = resolve(\App\Services\GoogleDriveService::class);
        $folderId = $driveService->findFolder('Reports') ?? $driveService->createFolder('Reports');

        $count = 0;
        $failures = [];
        foreach ($reports as $report) {
            try {
                // generate() picks the summary or tabular layout itself. The old
                // branch called generateTablePdf(), which did not exist, so every
                // non-summary report silently failed inside the catch below.
                $tempPath = $pdfService->generate($report);
                $fileName = basename($tempPath);

                $fileUrl = $driveService->uploadFile($tempPath, $folderId, $fileName, 'application/pdf');

                $oldUrl = $report->file_url;
                if ($oldUrl && preg_match('/\/d\/([a-zA-Z0-9_-]+)/', $oldUrl, $matches)) {
                    try {
                        $driveService->deleteFile($matches[1]);
                    }
                    catch (\Exception $e) {
                    }
                }

                $report->file_url = $fileUrl;
                $report->save();
                @unlink($tempPath);
                $count++;
            }
            catch (\Throwable $e) {
                // Previously swallowed entirely, which is why a broken PDF pipeline
                // could report "Converted 0 reports." and look like success.
                $failures[] = "#{$report->id} {$report->report_name}: {$e->getMessage()}";
                \Illuminate\Support\Facades\Log::error('Report PDF migration failed', [
                    'report_id' => $report->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
        return response()->json([
            'success' => $failures === [],
            'message' => "Converted {$count} of {$reports->count()} reports.",
            'failures' => $failures,
        ], $failures === [] ? 200 : 207);
    });
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/monitor/handle', [MonitorController::class , 'handle']);
    Route::get('/dashboard/counts', [\App\Http\Controllers\Api\DashboardController::class , 'getCounts']);
    Route::post('/monitor/handle', [MonitorController::class , 'handle']);

    // Technician live location (Life360-style monitoring)
    // POST: authenticated technician reports own GPS. GET: admin reads all technicians.
    Route::post('/technician-location', [\App\Http\Controllers\Api\TechnicianLocationController::class , 'update']);
    Route::get('/technician-locations', [\App\Http\Controllers\Api\TechnicianLocationController::class , 'index']);
    Route::get('/technician-locations/{userId}/trail', [\App\Http\Controllers\Api\TechnicianLocationController::class , 'trail']);
});
Route::get('/sms-blast', [SmsBlastController::class , 'index']);
Route::post('/sms-blast', [SmsBlastController::class , 'store']);
// Expenses module. The bare GET stays first and unchanged so the legacy
// ExpensesLog page keeps hitting exactly the endpoint it already knows.
Route::prefix('expenses-logs')->group(function () {
    Route::get('/', [ExpensesLogController::class , 'index']);
    // Literal segments before /{id}, or the wildcard swallows them.
    Route::get('/summary', [ExpensesLogController::class , 'summary']);
    Route::get('/export', [ExpensesLogController::class , 'export']);
    Route::post('/', [ExpensesLogController::class , 'store']);
    Route::get('/{id}', [ExpensesLogController::class , 'show']);
    // POST+_method=PUT is how the frontend sends multipart updates; PHP does not
    // populate $_FILES on a real PUT body.
    Route::match(['put', 'post'], '/{id}', [ExpensesLogController::class , 'update']);
    Route::delete('/{id}', [ExpensesLogController::class , 'destroy']);
});

// Monthly Payables. Behind auth:sanctum, unlike the older expenses-logs routes above:
// these rows are amounts owed to named vendors with account numbers on them, so the
// endpoints get the session guard rather than relying on the SPA to be the only caller.
Route::middleware('auth:sanctum')->prefix('monthly-payables')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'index']);
    // Literal segments before /{id}, or the wildcard swallows them.
    Route::get('/alert-count', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'alertCount']);
    Route::post('/generate', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'generateMonthlyBatch']);
    Route::post('/', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'show'])->whereNumber('id');
    // POST+_method=PUT is how the frontend sends multipart updates; PHP does not
    // populate $_FILES on a real PUT body.
    Route::match(['put', 'post'], '/{id}', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'update'])->whereNumber('id');
    Route::delete('/{id}', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'destroy'])->whereNumber('id');
    Route::post('/{id}/payments', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'recordPayment'])->whereNumber('id');
    Route::delete('/{id}/payments/{paymentId}', [\App\Http\Controllers\Api\MonthlyPayableController::class , 'deletePayment'])
        ->whereNumber('id')->whereNumber('paymentId');
});

Route::prefix('expenses-categories')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\ExpensesCategoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\ExpensesCategoryApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\ExpensesCategoryApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\ExpensesCategoryApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\ExpensesCategoryApiController::class , 'destroy']);
});
Route::get('/disconnection-logs', [DisconnectionLogsController::class , 'index']);
Route::get('/smart-olt/validate-sn', [\App\Http\Controllers\SmartOltController::class , 'validateOnuSn']);
Route::post('/smart-olt/update-name', [\App\Http\Controllers\SmartOltController::class , 'updateOnuNameBySn']);
Route::post('/smart-olt/delete-name', [\App\Http\Controllers\SmartOltController::class , 'deleteOnuNameBySn']);
Route::get('/smart-olt', [\App\Http\Controllers\SmartOltController::class , 'index']);
Route::post('/smart-olt', [\App\Http\Controllers\SmartOltController::class , 'store']);
Route::put('/smart-olt/{id}', [\App\Http\Controllers\SmartOltController::class , 'update']);
Route::delete('/smart-olt/{id}', [\App\Http\Controllers\SmartOltController::class , 'destroy']);
Route::get('/reconnection-logs', [ReconnectionLogsController::class , 'index']);
Route::get('/data-logs', [\App\Http\Controllers\Api\DataLogsController::class , 'index']);

// File-based Log Viewers (SmartOLT & Radius)
Route::get('/file-logs/{type}', [\App\Http\Controllers\FileLogController::class, 'getLogFile']);

// SMS Template Routes
Route::apiResource('sms-templates', SMSTemplateController::class);

// Handle all OPTIONS requests
Route::options('{any}', function () {
    return response('', 200)
    ->header('Access-Control-Allow-Origin', '*')
    ->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    ->header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With, X-XSRF-TOKEN, X-App-ID')
    ->header('Access-Control-Allow-Credentials', 'true')
    ->header('Access-Control-Max-Age', '86400');
})->where('any', '.*');

// CORS Test Endpoint - First route to test CORS configuration
Route::get('/cors-test', function (Request $request) {
    return response()->json([
    'success' => true,
    'message' => 'CORS is working',
    'origin' => $request->header('Origin'),
    'headers' => [
    'Access-Control-Allow-Origin' => $request->header('Origin'),
    'Access-Control-Allow-Credentials' => 'true',
    ],
    'timestamp' => now()->toISOString()
    ]);
});

// Debug transaction relationships
Route::get('/debug/transaction-relationships', function () {
    try {
        $transaction = \App\Models\Transaction::latest()->first();

        if (!$transaction) {
            return response()->json(['success' => false, 'message' => 'No transactions found']);
        }

        $billingAccount = \App\Models\BillingAccount::where('account_no', $transaction->account_no)->first();
        $customer = null;
        if ($billingAccount) {
            $customer = \App\Models\Customer::find($billingAccount->customer_id);
        }

        return response()->json([
        'success' => true,
        'transaction' => [
        'id' => $transaction->id,
        'account_no' => $transaction->account_no,
        'account_no_type' => gettype($transaction->account_no)
        ],
        'billing_account' => $billingAccount ? [
        'id' => $billingAccount->id,
        'account_no' => $billingAccount->account_no,
        'customer_id' => $billingAccount->customer_id
        ] : null,
        'customer' => $customer ? [
        'id' => $customer->id,
        'first_name' => $customer->first_name,
        'full_name' => $customer->full_name
        ] : null,
        'relationship_loaded' => $transaction->account ? true : false,
        'columns_in_transactions' => \Illuminate\Support\Facades\Schema::getColumnListing('transactions')
        ]);
    }
    catch (\Exception $e) {
        return response()->json(['success' => false, 'error' => $e->getMessage()], 500);
    }
});

// Fixed, reliable location endpoints that won't change
// Route::post('/fixed/location/region', [\App\Http\Controllers\Api\LocationFixedEndpointsController::class, 'addRegion']);
// Route::post('/fixed/location/city', [\App\Http\Controllers\Api\LocationFixedEndpointsController::class, 'addCity']);
// Route::post('/fixed/location/barangay', [\App\Http\Controllers\Api\LocationFixedEndpointsController::class, 'addBarangay']);

// Emergency region endpoints directly accessible in API routes
Route::post('/emergency/regions', [EmergencyLocationController::class , 'addRegion']);
Route::post('/emergency/cities', [EmergencyLocationController::class , 'addCity']);
Route::post('/emergency/barangays', [EmergencyLocationController::class , 'addBarangay']);

// Direct location routes at API root level - matching frontend requests
Route::get('/regions', [\App\Http\Controllers\Api\LocationApiController::class , 'getRegions']);
Route::post('/regions', [\App\Http\Controllers\Api\LocationApiController::class , 'addRegion']);
Route::put('/regions/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->updateLocation('region', $id, $request);
});

// Debug routes for new features
Route::prefix('debug')->group(function () {
    Route::get('/billing-features', function () {
            return response()->json([
            'success' => true,
            'message' => 'Enhanced billing features available',
            'features' => [
            'installment_tracking' => true,
            'advanced_payments' => true,
            'mass_rebates' => true,
            'invoice_id_generation' => true,
            'payment_received_tracking' => true
            ],
            'endpoints' => [
            'advanced_payments' => '/api/advanced-payments',
            'mass_rebates' => '/api/mass-rebates',
            'installment_schedules' => '/api/installment-schedules',
            'discounts' => '/api/discounts',
            'service_charges' => '/api/service-charges',
            'installments' => '/api/installments'
            ]
            ]);
        }
        );    });

// Discount Management Routes
Route::prefix('discounts')->middleware('auth:sanctum')->group(function () {
    Route::get('/', [\App\Http\Controllers\DiscountController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\DiscountController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\DiscountController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\DiscountController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\DiscountController::class , 'destroy']);
});

// Form UI Configuration - Public Route (no auth required)
Route::get('/form-ui/config', [\App\Http\Controllers\FormUIController::class , 'getConfig']);

// Color Palette - Public Route (no auth required)
Route::get('/settings-color-palette/active', [SettingsColorPaletteController::class , 'getActive']);

// Image Proxy - Public Route (no auth required)
Route::get('/proxy/image', [ImageProxyController::class , 'proxyGoogleDriveImage']);

// Service Charge Logs Routes
Route::prefix('service-charges')->group(function () {
    Route::get('/', function (Request $request) {
            $query = DB::table('service_charge_logs');

            if ($request->has('account_no')) {
                $query->where('account_no', $request->account_no);
            }

            if ($request->has('account_id')) {
                $billingAccount = \App\Models\BillingAccount::find($request->account_id);
                if ($billingAccount) {
                    $query->where('account_no', $billingAccount->account_no);
                }
            }

            if ($request->has('status')) {
                $query->where('status', $request->status);
            }

            $charges = $query->orderBy('created_at', 'desc')->get();

            return response()->json([
            'success' => true,
            'data' => $charges,
            'count' => $charges->count()
            ]);
        }
        );

        Route::post('/', function (Request $request) {
            try {
                $validated = $request->validate([
                    'account_no' => 'required|string|exists:billing_accounts,account_no',
                    'service_charge' => 'required|numeric|min:0',
                    'remarks' => 'nullable|string'
                ]);

                $validated['status'] = 'Unused';
                $validated['created_by_user_id'] = $request->user()->id ?? 1;
                $validated['updated_by_user_id'] = $request->user()->id ?? 1;
                $validated['created_at'] = now();
                $validated['updated_at'] = now();

                $id = DB::table('service_charge_logs')->insertGetId($validated);
                $charge = DB::table('service_charge_logs')->find($id);

                return response()->json([
                'success' => true,
                'message' => 'Service charge created successfully',
                'data' => $charge
                ], 201);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

// Statement of Accounts Routes
Route::prefix('statement-of-accounts')->group(function () {
    Route::get('/by-account/{accountNo}', [RelatedDataController::class , 'getStatementOfAccountsByAccount']);
    Route::get('/{id}', [RelatedDataController::class , 'getStatementOfAccountById']);
    Route::post('/{id}/generate-pdf', [RelatedDataController::class, 'generateSoaPdf']);
});

// Invoice Routes
Route::prefix('invoices')->group(function () {
    Route::get('/by-account/{accountNo}', [RelatedDataController::class , 'getInvoicesByAccount']);
    Route::get('/{id}', [RelatedDataController::class , 'getInvoiceById']);
});

// Payment Portal Logs Routes
Route::prefix('payment-portal-logs')->group(function () {
    Route::get('/by-account/{accountNo}', [RelatedDataController::class , 'getPaymentPortalLogsByAccount']);
    Route::get('/unique-channels', [RelatedDataController::class, 'getUniquePaymentChannels']);
    Route::get('/{id}', [RelatedDataController::class , 'getPaymentPortalLogById']);
});

// Transaction Routes
Route::prefix('transactions')->group(function () {
    Route::get('/by-account/{accountNo}', [RelatedDataController::class , 'getTransactionsByAccount']);
    Route::get('/{id}', [RelatedDataController::class , 'getTransactionById']);
});

// Installment Management Routes (Enhanced)
Route::prefix('installments')->group(function () {
    Route::get('/', function (Request $request) {
            $query = \App\Models\Installment::with(['billingAccount.customer', 'billingAccount.technicalDetails', 'invoice', 'schedules']);

            if ($request->has('account_no')) {
                $query->where('account_no', $request->account_no);
            }

            if ($request->has('account_id')) {
                $billingAccount = \App\Models\BillingAccount::find($request->account_id);
                if ($billingAccount) {
                    $query->where('account_no', $billingAccount->account_no);
                }
            }

            if ($request->has('status')) {
                $query->where('status', $request->status);
            }

            $installments = $query->orderBy('created_at', 'desc')->get();

            return response()->json([
            'success' => true,
            'data' => $installments,
            'count' => $installments->count()
            ]);
        }
        );

        Route::post('/', function (Request $request) {
            try {
                $validated = $request->validate([
                    'account_no' => 'required|string|exists:billing_accounts,account_no',
                    'invoice_id' => 'nullable|exists:invoices,id',
                    'total_balance' => 'required|numeric|min:0',
                    'months_to_pay' => 'required|integer|min:1',
                    'start_date' => 'required|date',
                    'remarks' => 'nullable|string'
                ]);

                \Illuminate\Support\Facades\DB::beginTransaction();

                $validated['monthly_payment'] = $validated['total_balance'] / $validated['months_to_pay'];
                $validated['status'] = 'active';
                $validated['created_by'] = $request->user()->id ?? 1;
                $validated['updated_by'] = $request->user()->id ?? 1;

                $installment = \App\Models\Installment::create($validated);

                $balanceChanges = null;

                if (isset($validated['invoice_id'])) {
                    $invoice = \App\Models\Invoice::find($validated['invoice_id']);
                    $billingAccount = \App\Models\BillingAccount::where('account_no', $validated['account_no'])->first();

                    if ($invoice && $billingAccount) {
                        $staggeredBalance = $validated['total_balance'];
                        $currentAccountBalance = $billingAccount->account_balance ?? 0;

                        $newAccountBalance = $currentAccountBalance - $staggeredBalance;

                        $billingAccount->update([
                            'account_balance' => round($newAccountBalance, 2),
                            'balance_update_date' => now()
                        ]);

                        $currentReceivedPayment = $invoice->received_payment ?? 0;
                        $newReceivedPayment = $currentReceivedPayment + $staggeredBalance;

                        $remainingInvoiceBalance = $invoice->total_amount - $newReceivedPayment;

                        $invoiceStatus = 'Unpaid';
                        if ($remainingInvoiceBalance <= 0) {
                            $invoiceStatus = 'Paid';
                        }
                        elseif ($newReceivedPayment > 0) {
                            $invoiceStatus = 'Partial';
                        }

                        $invoice->update([
                            'received_payment' => round($newReceivedPayment, 2),
                            'status' => $invoiceStatus,
                            'updated_by' => (string)($request->user()->id ?? 1)
                        ]);

                        $balanceChanges = [
                            'account_balance' => [
                                'previous' => round($currentAccountBalance, 2),
                                'staggered_payment' => round($staggeredBalance, 2),
                                'new' => round($newAccountBalance, 2)
                            ],
                            'invoice' => [
                                'total_amount' => round($invoice->total_amount, 2),
                                'previous_received' => round($currentReceivedPayment, 2),
                                'new_received' => round($newReceivedPayment, 2),
                                'remaining' => round($remainingInvoiceBalance, 2),
                                'status' => $invoiceStatus
                            ]
                        ];

                        \Illuminate\Support\Facades\Log::info('Staggered installment created', [
                            'installment_id' => $installment->id,
                            'account_no' => $validated['account_no'],
                            'invoice_id' => $validated['invoice_id'],
                            'balance_changes' => $balanceChanges
                        ]);
                    }
                }

                \Illuminate\Support\Facades\DB::commit();

                return response()->json([
                'success' => true,
                'message' => 'Installment created successfully and balances updated',
                'data' => $installment,
                'balance_changes' => $balanceChanges
                ], 201);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\DB::rollBack();
                \Illuminate\Support\Facades\Log::error('Failed to create staggered installment', [
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString()
                ]);
                return response()->json([
                'success' => false,
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::get('/{id}', function ($id) {
            try {
                $installment = \App\Models\Installment::with(['billingAccount', 'invoice', 'schedules'])->findOrFail($id);

                return response()->json([
                'success' => true,
                'data' => $installment
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage()
                ], 404);
            }
        }
        );

        Route::put('/{id}', function ($id, Request $request) {
            try {
                $installment = \App\Models\Installment::findOrFail($id);

                $validated = $request->validate([
                    'total_balance' => 'sometimes|numeric|min:0',
                    'months_to_pay' => 'sometimes|integer|min:0',
                    'monthly_payment' => 'sometimes|numeric|min:0',
                    'status' => 'sometimes|in:active,completed,cancelled',
                    'remarks' => 'nullable|string'
                ]);

                $validated['updated_by'] = $request->user()->id ?? 1;

                $installment->update($validated);

                return response()->json([
                'success' => true,
                'message' => 'Installment updated successfully',
                'data' => $installment->fresh()
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::delete('/{id}', function ($id) {
            try {
                $installment = \App\Models\Installment::findOrFail($id);
                $installment->delete();

                return response()->json([
                'success' => true,
                'message' => 'Installment deleted successfully'
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

// Service Order Items Routes
Route::prefix('service-order-items')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\ServiceOrderItemApiController::class, 'index']);
    Route::post('/', [\App\Http\Controllers\Api\ServiceOrderItemApiController::class, 'store']);
    Route::get('/{serviceOrderId}', [\App\Http\Controllers\Api\ServiceOrderItemApiController::class, 'getByServiceOrderId']);
    Route::put('/{serviceOrderId}', [\App\Http\Controllers\Api\ServiceOrderItemApiController::class, 'updateByServiceOrderId']);
    // Note: The frontend uses /service-order-items/{id} for deletion. If it expects to delete all items by SO ID, it would need a custom method. We map destroy for now.
    Route::delete('/{id}', [\App\Http\Controllers\Api\ServiceOrderItemApiController::class, 'destroy']);
});

// Scheduled Billing Generation Job Route
Route::get('/billing-generation/trigger-scheduled', function () {
    try {
        $service = app(\App\Services\EnhancedBillingGenerationService::class);
        $today = \Carbon\Carbon::now();
        $results = $service->generateAllBillingsForToday(1);

        return response()->json([
        'success' => true,
        'message' => 'Scheduled billing generation completed',
        'data' => $results
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Scheduled billing generation failed',
        'error' => $e->getMessage()
        ], 500);
    }
});

// Test Invoice ID Generation
Route::post('/billing-generation/test-single-account', function (Request $request) {
    try {
        $validated = $request->validate([
            'account_id' => 'required|integer'
        ]);

        $account = \App\Models\BillingAccount::with(['customer'])->findOrFail($validated['account_id']);
        $service = app(\App\Services\EnhancedBillingGenerationService::class);
        $today = \Carbon\Carbon::now();
        $userId = 1;

        $soaResult = null;
        $invoiceResult = null;
        $errors = [];

        try {
            $account->refresh();
            $soaResult = $service->createEnhancedStatement($account, $today, $userId);
        }
        catch (\Exception $e) {
            $errors['soa'] = $e->getMessage();
        }

        try {
            $account->refresh();
            $invoiceResult = $service->createEnhancedInvoice($account, $today, $userId);
        }
        catch (\Exception $e) {
            $errors['invoice'] = $e->getMessage();
        }

        return response()->json([
        'success' => true,
        'message' => 'Test generation completed for single account',
        'data' => [
        'account_no' => $account->account_no,
        'soa' => $soaResult ? [
        'id' => $soaResult->id,
        'balance_from_previous_bill' => $soaResult->balance_from_previous_bill,
        'payment_received_previous' => $soaResult->payment_received_previous,
        'remaining_balance_previous' => $soaResult->remaining_balance_previous,
        'amount_due' => $soaResult->amount_due,
        'total_amount_due' => $soaResult->total_amount_due
        ] : null,
        'invoice' => $invoiceResult ? [
        'id' => $invoiceResult->id,
        'invoice_balance' => $invoiceResult->invoice_balance,
        'total_amount' => $invoiceResult->total_amount
        ] : null,
        'errors' => $errors
        ]
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Test generation failed',
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

Route::get('/billing-generation/test-invoice-id', function () {
    $date = \Carbon\Carbon::now();
    $year = $date->format('y');
    $month = $date->format('m');
    $day = $date->format('d');
    $hour = $date->format('H');
    $invoiceId = $year . $month . $day . $hour . '0000';

    return response()->json([
    'success' => true,
    'invoice_id' => $invoiceId,
    'date' => $date->format('Y-m-d H:i:s'),
    'format' => 'YYMMDDHHXXXX'
    ]);
});
Route::delete('/regions/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->deleteLocation('region', $id, $request);
});

// Debug endpoint for billing calculations
Route::get('/billing-generation/debug-calculations/{accountId}', function ($accountId) {
    try {
        $account = \App\Models\BillingAccount::with(['customer'])->findOrFail($accountId);
        $service = app(\App\Services\EnhancedBillingGenerationService::class);

        $customer = $account->customer;
        $plan = \App\Models\AppPlan::where('Plan_Name', $customer->desired_plan)->first();

        return response()->json([
        'success' => true,
        'account' => $account,
        'plan' => $plan,
        'calculations' => [
        'monthly_fee' => $plan ? $plan->Plan_Price : 0,
        'billing_day' => $account->billing_day,
        'account_balance' => $account->account_balance,
        'date_installed' => $account->date_installed,
        'balance_update_date' => $account->balance_update_date
        ]
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

Route::get('/cities', [\App\Http\Controllers\Api\LocationApiController::class , 'getAllCities']);
Route::post('/cities', [\App\Http\Controllers\Api\LocationApiController::class , 'addCity']);
Route::put('/cities/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->updateLocation('city', $id, $request);
});
Route::delete('/cities/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->deleteLocation('city', $id, $request);
});

Route::get('/barangays', [\App\Http\Controllers\Api\LocationApiController::class , 'getAllBarangays']);
Route::post('/barangays', [\App\Http\Controllers\Api\LocationApiController::class , 'addBarangay']);
Route::put('/barangays/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->updateLocation('barangay', $id, $request);
});
Route::delete('/barangays/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->deleteLocation('barangay', $id, $request);
});

Route::get('/villages', [\App\Http\Controllers\Api\LocationApiController::class , 'getAllDetails']);
Route::post('/villages', [\App\Http\Controllers\Api\LocationApiController::class , 'addLocation']);
Route::put('/villages/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->updateLocation('location', $id, $request);
});
Route::delete('/villages/{id}', function ($id, Request $request) {
    return app(\App\Http\Controllers\Api\LocationApiController::class)->deleteLocation('location', $id, $request);
});

// Alternative endpoint formats for maximum compatibility
Route::post('/locations/add-region', [\App\Http\Controllers\Api\LocationApiController::class , 'addRegion']);
Route::post('/locations/add-city', [\App\Http\Controllers\Api\LocationApiController::class , 'addCity']);
Route::post('/locations/add-barangay', [\App\Http\Controllers\Api\LocationApiController::class , 'addBarangay']);

// Direct routes for location management - top level for maximum compatibility
Route::post('/locations/regions', [\App\Http\Controllers\Api\LocationApiController::class , 'addRegion']);
Route::post('/locations/cities', [\App\Http\Controllers\Api\LocationApiController::class , 'addCity']);
Route::post('/locations/barangays', [\App\Http\Controllers\Api\LocationApiController::class , 'addBarangay']);
Route::put('/locations/region/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
Route::put('/locations/city/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
Route::put('/locations/barangay/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
Route::delete('/locations/region/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);
Route::delete('/locations/city/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);
Route::delete('/locations/barangay/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);
Route::get('/locations/{type}/{id}/related', [\App\Http\Controllers\Api\LocationApiController::class , 'getRelatedData']);

// Direct test endpoint for troubleshooting
Route::get('/locations-ping', function () {
    return response()->json([
    'success' => true,
    'message' => 'Locations API is responding',
    'timestamp' => now()->toDateTimeString(),
    'environment' => app()->environment(),
    'routes' => [
    '/locations/all' => 'getAllLocations',
    '/locations/regions' => 'getRegions',
    '/debug/model-test' => 'Database model test'
    ]
    ]);
});

// Mock data endpoint for locations
Route::get('/locations/mock', function () {
    return response()->json([
    'success' => true,
    'data' => [
    [
    'id' => 1,
    'code' => '1',
    'name' => 'Metro Manila',
    'description' => 'National Capital Region',
    'is_active' => true,
    'created_at' => now(),
    'updated_at' => now(),
    'active_cities' => [
    [
    'id' => 101,
    'code' => '101',
    'name' => 'Quezon City',
    'description' => 'QC',
    'is_active' => true,
    'region_id' => 1,
    'created_at' => now(),
    'updated_at' => now(),
    'active_barangays' => [
    [
    'id' => 1001,
    'code' => '1001',
    'name' => 'Barangay A',
    'description' => '',
    'is_active' => true,
    'city_id' => 101,
    'created_at' => now(),
    'updated_at' => now()
    ],
    [
    'id' => 1002,
    'code' => '1002',
    'name' => 'Barangay B',
    'description' => '',
    'is_active' => true,
    'city_id' => 101,
    'created_at' => now(),
    'updated_at' => now()
    ]
    ]
    ],
    [
    'id' => 102,
    'code' => '102',
    'name' => 'Manila',
    'description' => '',
    'is_active' => true,
    'region_id' => 1,
    'created_at' => now(),
    'updated_at' => now(),
    'active_barangays' => [
    [
    'id' => 1003,
    'code' => '1003',
    'name' => 'Barangay X',
    'description' => '',
    'is_active' => true,
    'city_id' => 102,
    'created_at' => now(),
    'updated_at' => now()
    ],
    [
    'id' => 1004,
    'code' => '1004',
    'name' => 'Barangay Y',
    'description' => '',
    'is_active' => true,
    'city_id' => 102,
    'created_at' => now(),
    'updated_at' => now()
    ]
    ]
    ]
    ]
    ],
    [
    'id' => 2,
    'code' => '2',
    'name' => 'CALABARZON',
    'description' => 'Region IV-A',
    'is_active' => true,
    'created_at' => now(),
    'updated_at' => now(),
    'active_cities' => [
    [
    'id' => 201,
    'code' => '201',
    'name' => 'Binangonan',
    'description' => '',
    'is_active' => true,
    'region_id' => 2,
    'created_at' => now(),
    'updated_at' => now(),
    'active_barangays' => [
    [
    'id' => 2001,
    'code' => '2001',
    'name' => 'Angono',
    'description' => '',
    'is_active' => true,
    'city_id' => 201,
    'created_at' => now(),
    'updated_at' => now()
    ],
    [
    'id' => 2002,
    'code' => '2002',
    'name' => 'Bilibiran',
    'description' => '',
    'is_active' => true,
    'city_id' => 201,
    'created_at' => now(),
    'updated_at' => now()
    ]
    ]
    ]
    ]
    ]
    ]
    ]);
});

// Debug routes for troubleshooting
Route::prefix('debug')->group(function () {
    Route::get('/routes', [DebugController::class , 'listRoutes']);
    Route::get('/location-test', [DebugController::class , 'locationTest']);

    // Direct location test routes - no controller method
    Route::get('/location-echo', function () {
            return response()->json([
            'success' => true,
            'message' => 'Location echo test is working',
            'timestamp' => now()
            ]);
        }
        );

        // Direct model tests
        Route::get('/model-test', function () {
            try {
                $regions = \App\Models\Region::count();
                $cities = \App\Models\City::count();
                $barangays = \App\Models\Barangay::count();

                return response()->json([
                'success' => true,
                'message' => 'Model test successful',
                'data' => [
                'region_count' => $regions,
                'city_count' => $cities,
                'barangay_count' => $barangays
                ],
                'database_config' => [
                'connection' => config('database.default'),
                'database' => config('database.connections.' . config('database.default') . '.database'),
                ],
                'tables_exist' => [
                'region_list' => \Illuminate\Support\Facades\Schema::hasTable('region_list'),
                'city_list' => \Illuminate\Support\Facades\Schema::hasTable('city_list'),
                'barangay_list' => \Illuminate\Support\Facades\Schema::hasTable('barangay_list')
                ]
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Model test failed',
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
                ], 500);
            }
        }
        );    });

// Authentication endpoints
Route::post('/fix-customer-password', function (Request $request) {
    try {
        $username = $request->input('username');

        if (!$username) {
            return response()->json([
            'status' => 'error',
            'message' => 'Username is required'
            ], 400);
        }

        $user = User::where('username', $username)->first();

        if (!$user) {
            return response()->json([
            'status' => 'error',
            'message' => 'User not found'
            ], 404);
        }

        // Get the customer contact number
        $customer = \App\Models\Customer::where('email_address', $user->email_address)->first();

        if (!$customer) {
            return response()->json([
            'status' => 'error',
            'message' => 'Customer record not found'
            ], 404);
        }

        // Reset password to contact number
        $newPassword = $customer->contact_number_primary;
        $user->password_hash = Hash::make($newPassword);
        $user->save();

        return response()->json([
        'status' => 'success',
        'message' => 'Password reset successfully',
        'data' => [
        'username' => $user->username,
        'email' => $user->email_address,
        'contact_number' => $customer->contact_number_primary,
        'new_password' => $newPassword
        ]
        ]);

    }
    catch (\Exception $e) {
        return response()->json([
        'status' => 'error',
        'message' => 'Failed to reset password',
        'error' => $e->getMessage()
        ], 500);
    }
});

// Work Order Category Management Routes
Route::prefix('work-categories')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'destroy']);
});

// Work Order Management Routes
Route::prefix('work-orders')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'destroy']);
});

// Authentication endpoints
Route::post('/login-debug', function (Request $request) {
    try {
        $identifier = $request->input('email');
        $password = $request->input('password');

        if (!$identifier || !$password) {
            return response()->json([
            'status' => 'error',
            'message' => 'Email/username and password are required',
            'step' => 'validation'
            ], 400);
        }

        // Step 1: Find user
        $user = User::where('email_address', $identifier)
            ->orWhere('username', $identifier)
            ->first();

        if (!$user) {
            return response()->json([
            'status' => 'error',
            'message' => 'User not found',
            'step' => 'user_lookup',
            'identifier' => $identifier
            ], 401);
        }

        // Step 2: Check password
        if (!Hash::check($password, $user->password_hash)) {
            return response()->json([
            'status' => 'error',
            'message' => 'Invalid password',
            'step' => 'password_check'
            ], 401);
        }

        // Step 3: Load relationships
        $user->load('organization', 'role', 'group');

        // Step 4: Get role
        $primaryRole = $user->role ? $user->role->role_name : 'User';

        // Step 5: Build response
        return response()->json([
        'status' => 'success',
        'message' => 'Login successful',
        'step' => 'complete',
        'data' => [
        'user' => [
        'user_id' => $user->id,
        'username' => $user->username,
        'email' => $user->email_address,
        'first_name' => $user->first_name,
        'last_name' => $user->last_name,
        'role' => $primaryRole,
        'group' => $user->group,
        'organization' => $user->organization
        ],
        'token' => 'user_token_' . $user->id . '_' . time()
        ]
        ]);

    }
    catch (\Exception $e) {
        return response()->json([
        'status' => 'error',
        'message' => 'Login failed',
        'step' => 'exception',
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// Authentication endpoints
Route::post('/login', function (Request $request) {
    $identifier = $request->input('email');
    $password = $request->input('password');

    if (!$identifier || !$password) {
        return response()->json([
        'status' => 'error',
        'message' => 'Email/username and password are required'
        ], 400);
    }

    try {
        // Find user by email_address or username
        $user = User::where('email_address', $identifier)
            ->orWhere('username', $identifier)
            ->first();

        if (!$user) {
            \Log::warning('Login failed: User not found', [
                'identifier' => $identifier,
                'ip' => $request->ip()
            ]);

            return response()->json([
            'status' => 'error',
            'message' => 'Invalid credentials'
            ], 401);
        }

        // Verify password
        $passwordMatches = Hash::check($password, $user->password_hash);

        // For customers (role_id 3), allow variations of the leading '0' if the primary check fails
        if (!$passwordMatches && $user->role_id == 3) {
            $altPassword = null;
            if (str_starts_with($password, '0')) {
                $altPassword = substr($password, 1); // Try without leading '0'
            }
            else {
                $altPassword = '0' . $password; // Try with leading '0'
            }

            if ($altPassword && Hash::check($altPassword, $user->password_hash)) {
                $passwordMatches = true;
                \Log::info('Customer login: Password matched using variation', ['user_id' => $user->id]);
            }
        }

        if (!$passwordMatches) {
            \Log::warning('Login failed: Invalid password', [
                'identifier' => $identifier,
                'ip' => $request->ip()
            ]);

            return response()->json([
            'status' => 'error',
            'message' => 'Invalid credentials'
            ], 401);
        }

        // Check if account is suspended
        if (!$user->active) {
            \Log::warning('Login attempt from suspended account', [
                'identifier' => $identifier,
                'user_id' => $user->id,
                'ip' => $request->ip()
            ]);

            return response()->json([
                'status' => 'suspended',
                'message' => 'your account is suspended contact a support'
            ], 403);
        }

        // Technicians get one live login and no more. Everyone else falls straight through
        // this block unchanged.
        //
        // Runs before Auth::login() on purpose: a refused attempt must not leave an
        // authenticated session behind for the device that was told to confirm first.
        if (TechnicianSessionGuard::applies($user)) {
            $currentSessionId = TechnicianSessionGuard::currentSessionId($request);

            if (TechnicianSessionGuard::hasSessionElsewhere($user, $currentSessionId)) {
                // Anything other than an explicit true — absent, false, '0' — means the client
                // has not shown the confirmation prompt yet.
                $forceLogin = filter_var($request->input('force_login', false), FILTER_VALIDATE_BOOLEAN);

                if (! $forceLogin) {
                    \Log::info('Technician login needs takeover confirmation', [
                        'user_id' => $user->id,
                        'username' => $user->username,
                        'ip' => $request->ip()
                    ]);

                    return response()->json([
                        'status' => 'already_logged_in',
                        'require_confirmation' => true,
                        'message' => 'Account active on another device. Proceed and log out previous session?'
                    ], 409);
                }

                // Confirmed. Ends the other device's session, tokens and recaller cookie in one
                // transaction, and must happen before Auth::login() so the new device is issued
                // a fresh remember_token rather than the revoked one.
                TechnicianSessionGuard::takeOver($user, $request);
            }
        }

        // CRITICAL: Actually log the user in to create an authenticated session.
        //
        // $remember = true issues the long-lived recaller cookie. This is what keeps people
        // signed in: the session itself still expires after SESSION_LIFETIME of inactivity,
        // but on the next request SessionGuard::userFromRecaller() silently rebuilds the
        // session from that cookie, so the user never sees a 401. Without it, closing the
        // laptop overnight guaranteed a trip back to the login screen.
        \Auth::login($user, true);

        // Rotate the session id now that privileges have changed, so a session id captured
        // before login cannot be reused afterwards. Must run AFTER login(), and the recaller
        // cookie survives it.
        try {
            $request->session()->regenerate();
        } catch (\Throwable $sessionError) {
            // A request without a started session must not break login.
            \Log::warning('Could not regenerate session on login', [
                'user_id' => $user->id,
                'error' => $sessionError->getMessage()
            ]);
        }

        // Claim the single technician session slot. After regenerate(), so the id recorded is
        // the one the device will actually present — recording the pre-login id would make
        // this technician's own next login on this same device look like a second device.
        if (TechnicianSessionGuard::applies($user)) {
            TechnicianSessionGuard::register($user, $request);
        }

        // Verify session was created
        $sessionUserId = \Auth::id();
        \Log::info('User authenticated', [
            'user_id' => $user->id,
            'session_user_id' => $sessionUserId,
            'session_id' => session()->getId(),
            'username' => $user->username
        ]);

        // Load relationships after authentication succeeds
        try {
            $user->load(['organization', 'role', 'group']);
        }
        catch (\Exception $relationError) {
            \Log::error('Failed to load user relationships', [
                'user_id' => $user->id,
                'error' => $relationError->getMessage()
            ]);
        }

        // Get user role for response
        $primaryRole = 'user';
        if ($user->role && $user->role->role_name) {
            $primaryRole = strtolower($user->role->role_name);
        }

        // Update last login timestamp
        $user->last_login = now();
        $user->save();

        // Prepare response data
        $fullName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
        if (empty($fullName)) {
            $fullName = $user->username;
        }

        // The role's effective permission keys.
        //
        // Resolved through App\Support\Permissions rather than read straight off
        // the role row, so a seeded role (1-8) gets the keys its role implies
        // and a custom role (9+) gets its own stored list — plus, if it is a
        // hybrid, everything its base role holds, and, if it was saved before
        // per-action keys existed, every action of each page it holds. The
        // clients receive one shape and do not have to know which kind of role
        // they hold. A SuperAdmin gets ["*"].
        //
        // This is the same list /api/me/permissions returns; sending it at
        // sign-in saves the first paint a round trip.
        $rolePermissions = \App\Support\Permissions::forUser($user);

        $responseData = [
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email_address,
                'full_name' => $fullName,
                'role' => $primaryRole,
                'role_id' => $user->role_id,
                'permissions' => $rolePermissions,
                // Where this role should land. The client uses it instead of
                // guessing from the first key in the list. Null for a
                // standalone custom role: the client picks its first page.
                'home' => \App\Support\Permissions::homeFor($user),
                // A custom role saved before per-action keys existed.
                'permissions_legacy' => \App\Support\Permissions::isLegacyUser($user),
            ]
        ];

        // Add organization data if available
        try {
            if ($user->organization) {
                $responseData['user']['organization'] = [
                    'id' => $user->organization->id,
                    'name' => $user->organization->organization_name ?? 'Unknown Organization'
                ];
            }
        }
        catch (\Exception $orgError) {
            \Log::warning('Failed to load organization data', [
                'user_id' => $user->id,
                'error' => $orgError->getMessage()
            ]);
        }

        // Generate token
        $token = 'user_token_' . $user->id . '_' . time();
        $responseData['token'] = $token;

        return response()->json([
        'status' => 'success',
        'message' => 'Login successful',
        'data' => $responseData
        ]);

    }
    catch (\Exception $e) {
        \Log::error('Login exception: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString()
        ]);

        return response()->json([
        'status' => 'error',
        'message' => 'Login failed',
        'error' => 'An error occurred during authentication'
        ], 500);
    }
});

Route::post('/forgot-password', function (Request $request) {
    $identifier = $request->input('email') ?: $request->input('account_no');

    if (!$identifier) {
        return response()->json([
        'status' => 'error',
        'message' => 'Email address or account number is required'
        ], 400);
    }

    // Find user by username (account number) or email address
    $user = \App\Models\User::where('username', $identifier)
        ->orWhere('email_address', $identifier)
        ->first();

    if (!$user) {
        return response()->json([
        'status' => 'error',
        'message' => 'Account or email not found'
        ], 404);
    }

    if (!$user->email_address) {
        return response()->json([
        'status' => 'error',
        'message' => 'This account does not have a registered email address. Please contact support.'
        ], 400);
    }

    try {
        $emailQueueService = app(\App\Services\EmailQueueService::class);
        $emailQueueService->sendUserCredentials($user);

        return response()->json([
        'status' => 'success',
        'message' => 'Your account details have been sent to your registered email address.'
        ]);
    }
    catch (\Exception $e) {
        \Log::error('Forgot password email queuing failed', ['error' => $e->getMessage()]);
        return response()->json([
        'status' => 'error',
        'message' => 'An error occurred while processing your request. Please try again later.'
        ], 500);
    }
});

// Health check
Route::get('/health', function () {
    return response()->json([
    'status' => 'success',
    'message' => 'API is running',
    'data' => [
    'server' => 'Laravel ' . app()->version(),
    'timestamp' => now()->toISOString()
    ]
    ]);
});

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

/**
 * Explicit logout. There was previously no logout endpoint at all — the SPA just dropped
 * localStorage, leaving the server session and (now) the recaller cookie alive. With
 * remember-me enabled that would mean logging out never actually logged you out.
 *
 * Deliberately NOT behind auth:sanctum: logging out must succeed even when the session has
 * already lapsed, otherwise the client gets a 401 while trying to clean up.
 */
Route::post('/logout', function (Request $request) {
    $userId = \Auth::id();

    // Free the technician's single-session slot before anything is torn down: invalidate()
    // below rotates the session id, and the id being released has to be the one that was
    // recorded at login. A no-op for every other role — they hold no such record.
    TechnicianSessionGuard::release($userId, TechnicianSessionGuard::currentSessionId($request));

    // Cycles remember_token, so the old recaller cookie can never re-authenticate — this is
    // what makes "explicitly logged out" stick across devices holding a stale cookie.
    \Auth::logout();

    try {
        $request->session()->invalidate();
        $request->session()->regenerateToken();
    } catch (\Throwable $sessionError) {
        // Already-dead session: nothing to invalidate, and that is a successful logout.
        \Log::info('Logout with no active session', ['error' => $sessionError->getMessage()]);
    }

    \Log::info('User logged out', ['user_id' => $userId]);

    return response()->json(['success' => true, 'message' => 'Logged out']);
});

/**
 * The signed-in user's effective permission keys and landing page.
 *
 * The server is the authority on what a role may do; this is how a client
 * asks. The clients cache the same table locally so the first paint after a
 * reload does not have to wait on a round trip, and reconcile against this —
 * so a user whose role is changed while they are signed in loses the menu
 * entries on their next load rather than on their next sign-in.
 *
 * `permissions` may be `["*"]` for a SuperAdmin, which the clients read as
 * "everything, including keys added later".
 */
Route::middleware('auth:sanctum')->get('/me/permissions', function (Request $request) {
    $user = $request->user();

    return response()->json([
        'success' => true,
        'data' => [
            'role_id'     => (int) $user->role_id,
            'role'        => strtolower(optional($user->role)->role_name ?? ''),
            'permissions' => \App\Support\Permissions::forUser($user),
            'home'        => \App\Support\Permissions::homeFor($user),
            'permissions_legacy' => \App\Support\Permissions::isLegacyUser($user),
        ],
    ]);
});

/**
 * Cheap "is my session still good?" probe for the SPA to call on boot and before deciding a
 * 401 is terminal. Unauthenticated is a normal answer here, not an error, so it returns 200
 * with authenticated=false rather than a 401 — that keeps it from tripping the SPA's own
 * 401 handling and causing a redirect loop.
 */
Route::get('/auth/session', function (Request $request) {
    // Resolving the web guard is what triggers the recaller-cookie path, so simply asking
    // this question is enough to transparently rebuild a lapsed session.
    $user = \Auth::guard('web')->user();

    if (! $user) {
        return response()->json(['authenticated' => false], 200);
    }

    try {
        $user->load(['organization', 'role', 'group']);
    } catch (\Throwable $e) {
        // Relationship failure must not make a valid session look invalid.
        \Log::warning('Could not load relations for session probe', ['error' => $e->getMessage()]);
    }

    return response()->json(['authenticated' => true, 'user' => $user], 200);
});

// User Management Routes
Route::prefix('users')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [UserController::class , 'index']);
    Route::post('/', [UserController::class , 'store']);
    Route::get('/{id}', [UserController::class , 'show']);
    Route::put('/{id}', [UserController::class , 'update']);
    Route::delete('/{id}', [UserController::class , 'destroy']);
    Route::post('/{id}/roles', [UserController::class , 'assignRole']);
    Route::delete('/{id}/roles', [UserController::class , 'removeRole']);
    Route::post('/{id}/groups', [UserController::class , 'assignGroup']);
    Route::delete('/{id}/groups', [UserController::class , 'removeGroup']);
});

// Organization Management Routes
Route::prefix('organizations')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [OrganizationController::class , 'index']);
    Route::post('/', [OrganizationController::class , 'store']);
    Route::get('/{id}', [OrganizationController::class , 'show']);
    Route::put('/{id}', [OrganizationController::class , 'update']);
    Route::delete('/{id}', [OrganizationController::class , 'destroy']);
});

// Database diagnostic endpoint
Route::get('/debug/organizations', function () {
    try {
        // Check if table exists
        $tableExists = \Illuminate\Support\Facades\Schema::hasTable('organizations');

        if (!$tableExists) {
            return response()->json([
            'success' => false,
            'message' => 'Organizations table does not exist',
            'table_exists' => false
            ]);
        }

        // Get column information
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('organizations');

        // Try to get organizations
        $organizations = \App\Models\Organization::all();

        return response()->json([
        'success' => true,
        'message' => 'Organizations table exists',
        'table_exists' => true,
        'columns' => $columns,
        'count' => $organizations->count(),
        'data' => $organizations
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Error checking organizations',
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// SmartOLT Validation Route
Route::get('/smart-olt/validate-sn', [\App\Http\Controllers\SmartOltController::class , 'validateOnuSn']);


// Group Management Routes
Route::prefix('groups')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [GroupController::class , 'index']);
    Route::post('/', [GroupController::class , 'store']);
    Route::get('/{id}', [GroupController::class , 'show']);
    Route::put('/{id}', [GroupController::class , 'update']);
    Route::delete('/{id}', [GroupController::class , 'destroy']);
    Route::get('/organization/{orgId}', [GroupController::class , 'getByOrganization']);
});

// Role Management Routes
Route::prefix('roles')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [RoleController::class , 'index']);
    Route::post('/', [RoleController::class , 'store']);
    Route::get('/{id}', [RoleController::class , 'show']);
    Route::put('/{id}', [RoleController::class , 'update']);
    Route::delete('/{id}', [RoleController::class , 'destroy']);
});

// Database Setup Routes
Route::prefix('setup')->group(function () {
    Route::post('/initialize', [SetupController::class , 'initializeDatabase']);
    Route::get('/status', [SetupController::class , 'checkDatabaseStatus']);
});

// Logs Management Routes
Route::prefix('logs')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [LogsController::class , 'index']);
    Route::get('/stats', [LogsController::class , 'getStats']);
    Route::get('/export', [LogsController::class , 'export']);
    Route::get('/{id}', [LogsController::class , 'show']);
    Route::delete('/clear', [LogsController::class , 'clear']);
});

// Applications Management Routes
Route::prefix('applications')->middleware('auth:sanctum')->group(function () {
    Route::get('/', [ApplicationController::class , 'index']);
    Route::post('/', [ApplicationController::class , 'store']);
    Route::post('/broadcast-viewing', [ApplicationController::class, 'broadcastViewing']);
    // Above /{id}: the parameter is unconstrained and would match "my-count".
    Route::get('/my-count', [ApplicationController::class , 'myCount']);
    Route::get('/{id}', [ApplicationController::class , 'show']);
    Route::put('/{id}', [ApplicationController::class , 'update']);
    Route::post('/{id}/upload-images', [ApplicationController::class, 'uploadImages']);
    Route::delete('/{id}', [ApplicationController::class , 'destroy']);
});

// Job Orders Management Routes
Route::prefix('job-orders')->middleware(['auth:sanctum', 'ensure.database.tables'])->group(function () {
    Route::get('/validate-sn', [JobOrderController::class , 'validateModemRouterSN']);
    Route::post('/broadcast-viewing', [JobOrderController::class, 'broadcastViewing'])->withoutMiddleware([\App\Http\Middleware\EnsureDatabaseTables::class]);
    Route::get('/', [JobOrderController::class , 'index']);
    Route::post('/', [JobOrderController::class , 'store']);
    Route::get('/{id}', [JobOrderController::class , 'show']);
    Route::put('/{id}', [JobOrderController::class , 'update']);
    Route::delete('/{id}', [JobOrderController::class , 'destroy']);
    Route::post('/{id}/approve', [JobOrderController::class , 'approve']);
    Route::post('/{id}/log-blocked-transfer', [JobOrderController::class , 'logBlockedTransfer']);
    Route::post('/{id}/create-radius-account', [JobOrderController::class , 'createRadiusAccount']);
    Route::post('/{id}/upload-images', [JobOrderController::class , 'uploadImages']);

    // Lookup table endpoints
    Route::get('/lookup/modem-router-sns', [JobOrderController::class , 'getModemRouterSNs']);
    Route::get('/lookup/contract-templates', [JobOrderController::class , 'getContractTemplates']);
    Route::get('/lookup/ports', [JobOrderController::class , 'getPorts']);
    Route::get('/lookup/vlans', [JobOrderController::class , 'getVLANs']);
    Route::get('/lookup/lcpnaps', [JobOrderController::class , 'getLCPNAPs']);
});

// Job Order Items Management Routes
Route::prefix('job-order-items')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\JobOrderItemApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\JobOrderItemApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\JobOrderItemApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\JobOrderItemApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\JobOrderItemApiController::class , 'destroy']);
});

// Test endpoint for job-order-items
Route::get('/job-order-items-test', function () {
    return response()->json([
    'success' => true,
    'message' => 'Job Order Items routes are working',
    'routes' => [
    'GET /api/job-order-items' => 'List all items (filter by job_order_id)',
    'POST /api/job-order-items' => 'Create items (batch)',
    'GET /api/job-order-items/{id}' => 'Get specific item',
    'PUT /api/job-order-items/{id}' => 'Update item',
    'DELETE /api/job-order-items/{id}' => 'Delete item'
    ],
    'model' => 'JobOrderItem',
    'table' => 'job_order_items',
    'table_exists' => \Illuminate\Support\Facades\Schema::hasTable('job_order_items'),
    'columns' => \Illuminate\Support\Facades\Schema::hasTable('job_order_items')
    ?\Illuminate\Support\Facades\Schema::getColumnListing('job_order_items')
    : []
    ]);
});

// Application Visits Management Routes
Route::prefix('application-visits')->middleware('ensure.database.tables')->group(function () {
    Route::get('/', [ApplicationVisitController::class , 'index']);
    Route::post('/', [ApplicationVisitController::class , 'store']);
    Route::get('/{id}', [ApplicationVisitController::class , 'show']);
    Route::put('/{id}', [ApplicationVisitController::class , 'update']);
    Route::delete('/{id}', [ApplicationVisitController::class , 'destroy']);
    Route::get('/application/{applicationId}', [ApplicationVisitController::class , 'getByApplication']);
    Route::post('/{id}/upload-images', [\App\Http\Controllers\ApplicationVisitImageController::class , 'uploadImages']);
});

// Location Management Routes - New centralized system
// IMPORTANT: Remove the middleware that might be blocking this
Route::prefix('locations')->group(function () {
    // Test endpoint
    Route::get('/test', function () {
            return response()->json([
            'success' => true,
            'message' => 'Location API is working',
            'timestamp' => now()
            ]);
        }
        );

        // Debug endpoint for locations/all route
        Route::get('/all-debug', function () {
            try {
                $controller = new \App\Http\Controllers\LocationController();
                return $controller->getAllLocations();
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Debug error: ' . $e->getMessage(),
                'trace' => $e->getTraceAsString()
                ], 500);
            }
        }
        );

        // Debug route to log all requests and trace route matching
        Route::post('/locations/debug', function (Request $request) {
            \Illuminate\Support\Facades\Log::info('[LocationDebug] Debug route hit', [
                'method' => $request->method(),
                'url' => $request->fullUrl(),
                'path' => $request->path(),
                'payload' => $request->all(),
                'headers' => $request->headers->all()
            ]);

            return response()->json([
            'success' => true,
            'message' => 'Debug route working',
            'data' => [
            'method' => $request->method(),
            'url' => $request->fullUrl(),
            'path' => $request->path(),
            'payload' => $request->all()
            ]
            ]);
        }
        );

        // Direct API endpoints that match the frontend requests
        Route::get('/all', [\App\Http\Controllers\Api\LocationApiController::class , 'getAllLocations']);
        Route::get('/regions', [\App\Http\Controllers\Api\LocationApiController::class , 'getRegions']);
        Route::get('/regions/{regionId}/cities', [\App\Http\Controllers\Api\LocationApiController::class , 'getCitiesByRegion']);
        Route::get('/cities/{cityId}/barangays', [\App\Http\Controllers\Api\LocationApiController::class , 'getBarangaysByCity']);

        // Region routes - explicit path for frontend compatibility
        Route::post('/regions', [\App\Http\Controllers\Api\LocationApiController::class , 'addRegion']);

        // City routes - explicit path for frontend compatibility
        Route::post('/cities', [\App\Http\Controllers\Api\LocationApiController::class , 'addCity']);

        // Barangay routes - explicit path for frontend compatibility
        Route::post('/barangays', [\App\Http\Controllers\Api\LocationApiController::class , 'addBarangay']);

        // General location routes
        Route::get('/statistics', [\App\Http\Controllers\Api\LocationApiController::class , 'getStatistics']);
        Route::put('/{type}/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
        Route::delete('/{type}/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);

        // Specific update/delete routes for frontend compatibility
        Route::put('/region/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
        Route::put('/city/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
        Route::put('/barangay/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'updateLocation']);
        Route::delete('/region/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);
        Route::delete('/city/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);
        Route::delete('/barangay/{id}', [\App\Http\Controllers\Api\LocationApiController::class , 'deleteLocation']);

        // Legacy routes (keep for compatibility)
        Route::get('/', [LocationController::class , 'index']);
        Route::post('/', [LocationController::class , 'store']);
        Route::get('/stats', [LocationController::class , 'getStats']);
        Route::get('/type/{type}', [LocationController::class , 'getByType']);
        Route::get('/parent/{parentId}', [LocationController::class , 'getChildren']);
        Route::get('/{id}', [LocationController::class , 'show']);
        Route::put('/{id}', [LocationController::class , 'update']);
        Route::delete('/{id}', [LocationController::class , 'destroy']);
        Route::patch('/{id}/toggle-status', [LocationController::class , 'toggleStatus']);    });

// Test endpoint for plan routes - MUST BE BEFORE other plan routes
Route::get('/plans-test', function () {
    return response()->json([
    'success' => true,
    'message' => 'Plan routes are working',
    'timestamp' => now()->toDateTimeString(),
    'database' => [
    'plan_list_exists' => \Illuminate\Support\Facades\Schema::hasTable('plan_list'),
    'plan_count' => \Illuminate\Support\Facades\DB::table('plan_list')->count()
    ]
    ]);
});

// Direct test route that doesn't use controller
Route::get('/plans-direct', function () {
    try {
        $plans = \Illuminate\Support\Facades\DB::table('plan_list')
            ->select(
            'id',
            'plan_name as name',
            'description',
            'price',
            'modified_date',
            'modified_by_user_id as modified_by'
        )
            ->get();

        return response()->json([
        'success' => true,
        'data' => $plans,
        'message' => 'Direct query successful'
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => $e->getMessage()
        ], 500);
    }
});

// Plan Management Routes - Direct routes at API root level for maximum compatibility
Route::get('/plans', [\App\Http\Controllers\Api\PlanApiController::class , 'index']);
Route::post('/plans', [\App\Http\Controllers\Api\PlanApiController::class , 'store']);
Route::get('/plans/statistics', [\App\Http\Controllers\Api\PlanApiController::class , 'getStatistics']);
Route::get('/plans/{id}', [\App\Http\Controllers\Api\PlanApiController::class , 'show']);
Route::put('/plans/{id}', [\App\Http\Controllers\Api\PlanApiController::class , 'update']);
Route::delete('/plans/{id}', [\App\Http\Controllers\Api\PlanApiController::class , 'destroy']);

// Plan Related Data - fetch applications, job orders, customers by plan name
Route::get('/plans/{id}/related', function ($id) {
    try {
        $plan = \Illuminate\Support\Facades\DB::table('plan_list')->where('id', $id)->first();
        if (!$plan) {
            return response()->json(['success' => false, 'message' => 'Plan not found'], 404);
        }
        $planName = $plan->plan_name;

        // Related Applications (match by desired_plan string)
        $applications = collect([]);
        try {
            $applications = \Illuminate\Support\Facades\DB::table('applications')
                ->leftJoin('application_visits', 'applications.id', '=', 'application_visits.application_id')
                ->leftJoin('job_orders', 'applications.id', '=', 'job_orders.application_id')
                ->where(function ($query) use ($planName) {
                    $query->where('applications.desired_plan', $planName)
                        ->orWhere('applications.desired_plan', 'LIKE', '%' . $planName . '%');
                }
                )
                    ->select(
                    'applications.*',
                    'application_visits.visit_by',
                    'application_visits.visit_with',
                    'application_visits.visit_with_other',
                    'application_visits.visit_remarks as remarks',
                    'job_orders.usage_type',
                    \Illuminate\Support\Facades\DB::raw('NULL as ownership'),
                    'applications.promo as applying_for',
                    \Illuminate\Support\Facades\DB::raw('(SELECT COUNT(*) FROM job_orders jo2 WHERE jo2.application_id = applications.id) as job_orders_count')
                )
                    ->orderBy('applications.created_at', 'desc')
                    ->get()
                    ->map(function ($app) {
                    $app->full_name = trim(($app->first_name ?? '') . ' ' . ($app->last_name ?? ''));
                    return $app;
                }
                );
            }
            catch (\Exception $e) {
                \Log::warning('Plan related applications query failed: ' . $e->getMessage());
            }
            // Related Job Orders (go through applications table via application_id FK)
            $jobOrders = collect([]);
            try {
                $applicationIds = $applications->pluck('id')->toArray();
                if (!empty($applicationIds)) {
                    $jobOrders = \Illuminate\Support\Facades\DB::table('job_orders')
                        ->whereIn('application_id', $applicationIds)
                        ->orderBy('created_at', 'desc')
                        ->get()
                        ->map(function ($jo) {
                        try {
                            $app = \Illuminate\Support\Facades\DB::table('applications')->where('id', $jo->application_id)->first();
                            $visit = \Illuminate\Support\Facades\DB::table('application_visits')->where('application_id', $jo->application_id)->first();

                            $billing = null;
                            if (isset($jo->account_id)) {
                                $billing = \Illuminate\Support\Facades\DB::table('billing_accounts')->where('id', $jo->account_id)->first();
                            }

                            $updatedBy = null;
                            if (isset($jo->updated_by_user_id)) {
                                $updatedBy = \Illuminate\Support\Facades\DB::table('users')->where('id', $jo->updated_by_user_id)->first();
                            }

                            $visitByUser = null;
                            if (isset($jo->visit_by_user_id)) {
                                $visitByUser = \Illuminate\Support\Facades\DB::table('users')->where('id', $jo->visit_by_user_id)->first();
                            }

                            $first_name = $jo->first_name ?? ($app ? $app->first_name : '');
                            $last_name = $jo->last_name ?? ($app ? $app->last_name : '');

                            $jo->first_name = $first_name;
                            $jo->last_name = $last_name;
                            $jo->email_address = $jo->email_address ?? ($app ? $app->email_address : '');
                            $jo->mobile_number = $jo->mobile_number ?? ($app ? $app->mobile_number : '');
                            $jo->installation_address = $jo->installation_address ?? ($app ? $app->installation_address : '');
                            $jo->barangay = $jo->barangay ?? ($app ? $app->barangay : '');
                            $jo->city = $jo->city ?? ($app ? $app->city : '');
                            $jo->region = $jo->region ?? ($app ? $app->region : '');
                            $jo->desired_plan = $jo->desired_plan ?? ($app ? $app->desired_plan : '');
                            // Shown as a name, with the id kept beside it so the
                            // mobile forms write the same referral back rather
                            // than turning it into a name again.
                            $rawReferral = $jo->referred_by ?? ($app ? $app->referred_by : '');
                            $jo->referred_by = \App\Support\AgentReferral::displayName($rawReferral);
                            $jo->referred_by_agent_id = \App\Support\AgentReferral::agentIdIfAgent($rawReferral);
                            $jo->applying_for = $jo->applying_for ?? ($app ? $app->promo : '');
                            $jo->terms_agreed = $jo->terms_agreed ?? ($app ? $app->terms_agreed : '');

                            $jo->visit_with_other = $jo->visit_with_other ?? ($visit ? ($visit->visit_with_other ?? '') : '');
                            $jo->visit_remarks = $jo->visit_remarks ?? ($visit ? ($visit->visit_remarks ?? '') : '');

                            $jo->account_no = $jo->account_no ?? ($billing ? $billing->account_no : '');

                            $modifier_first = $updatedBy ? $updatedBy->first_name : '';
                            $modifier_last = $updatedBy ? $updatedBy->last_name : '';
                            $jo->modified_by = trim($modifier_first . ' ' . $modifier_last);
                            if (empty($jo->modified_by)) {
                                $jo->modified_by = $jo->updated_by ?? '';
                            }

                            $v_first = $visitByUser ? $visitByUser->first_name : '';
                            $v_last = $visitByUser ? $visitByUser->last_name : '';
                            $computedUser = trim($v_first . ' ' . $v_last);

                            $jo->computed_visit_by = $computedUser ?: ($jo->visit_by ?? ($visit ? ($visit->visit_by ?? '') : ''));

                            $jo->job_order_no = 'JO-' . str_pad($jo->id, 5, '0', STR_PAD_LEFT);
                            $jo->customer_name = trim($first_name . ' ' . $last_name);
                            $jo->computed_full_address = trim(implode(', ', array_filter([$jo->installation_address, $jo->barangay, $jo->city, $jo->region])));

                            $jo->duration = null;
                            if (isset($jo->start_time) && isset($jo->end_time) && $jo->start_time && $jo->end_time) {
                                try {
                                    $start = new \DateTime($jo->start_time);
                                    $end = new \DateTime($jo->end_time);
                                    $interval = $start->diff($end);
                                    $jo->duration = $interval->format('%H:%I:%S');
                                }
                                catch (\Exception $e) {
                                }
                            }

                            $lcpnap = isset($jo->lcpnap) ? $jo->lcpnap : '';
                            $port = isset($jo->port) ? $jo->port : '';
                            $jo->lcpnapport = trim($lcpnap . ' ' . $port);

                        }
                        catch (\Exception $e) {
                            \Log::error('Job Order mapping error: ' . $e->getMessage());
                        }

                        return $jo;
                    }
                    );
                }
            }
            catch (\Exception $e) {
                \Log::warning('Plan related job orders query failed: ' . $e->getMessage());
            }

            // Subscribed Customers (desired_plan string matches plan name, OR billing_accounts.plan_id matches)
            $customers = collect([]);
            try {
                $customers = \Illuminate\Support\Facades\DB::table('customers')
                    ->leftJoin('billing_accounts', 'customers.id', '=', 'billing_accounts.customer_id')
                    ->where(function ($query) use ($planName, $id) {
                    $query->where('customers.desired_plan', $planName)
                        ->orWhere('billing_accounts.plan_id', $id);
                }
                )
                    ->select('customers.id', 'customers.first_name', 'customers.last_name', 'customers.desired_plan', 'customers.email_address', 'customers.contact_number_primary', 'customers.address', 'customers.created_at', 'billing_accounts.id as account_no')
                    ->distinct()
                    ->orderBy('customers.created_at', 'desc')
                    ->get()
                    ->map(function ($cust) {
                    $cust->full_name = trim(($cust->first_name ?? '') . ' ' . ($cust->last_name ?? ''));
                    return $cust;
                }
                );
            }
            catch (\Exception $e) {
                \Log::warning('Plan related customers query failed: ' . $e->getMessage());
            }

            return response()->json([
            'success' => true,
            'data' => [
            'applications' => $applications,
            'job_orders' => $jobOrders,
            'customers' => $customers,
            ],
            'counts' => [
            'applications' => count($applications),
            'job_orders' => count($jobOrders),
            'customers' => count($customers),
            ]
            ]);
        }
        catch (\Exception $e) {
            \Log::error('Plan related data error: ' . $e->getMessage());
            return response()->json([
            'success' => false,
            'message' => 'Error fetching related data: ' . $e->getMessage()
            ], 500);
        }    });

// Promo Management Routes - Direct routes at API root level for maximum compatibility
Route::get('/promos', [\App\Http\Controllers\Api\PromoApiController::class , 'index']);
Route::post('/promos', [\App\Http\Controllers\Api\PromoApiController::class , 'store']);
Route::get('/promos/{id}', [\App\Http\Controllers\Api\PromoApiController::class , 'show']);
Route::put('/promos/{id}', [\App\Http\Controllers\Api\PromoApiController::class , 'update']);
Route::delete('/promos/{id}', [\App\Http\Controllers\Api\PromoApiController::class , 'destroy']);

// Router Models Management Routes
Route::prefix('router-models')->group(function () {
    Route::get('/', [\App\Http\Controllers\RouterModelController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\RouterModelController::class , 'store']);
    Route::get('/{model}', [\App\Http\Controllers\RouterModelController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\RouterModelController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\RouterModelController::class , 'destroy']);
});

// Status Remarks Management Routes
Route::middleware('auth:sanctum')->prefix('status-remarks')->group(function () {
    Route::get('/', [\App\Http\Controllers\StatusRemarksController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\StatusRemarksController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\StatusRemarksController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\StatusRemarksController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\StatusRemarksController::class , 'destroy']);
});

// Debug route for status_remarks_list table
Route::get('/debug/status-remarks-structure', function () {
    try {
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('status_remarks_list');
        $sample = \Illuminate\Support\Facades\DB::table('status_remarks_list')->first();

        return response()->json([
        'success' => true,
        'table' => 'status_remarks_list',
        'columns' => $columns,
        'sample_data' => $sample,
        'count' => \Illuminate\Support\Facades\DB::table('status_remarks_list')->count()
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

// Inventory Management Routes - Using Inventory table
Route::prefix('inventory')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\InventoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\InventoryApiController::class , 'store']);
    Route::post('/upload-image', [\App\Http\Controllers\Api\InventoryApiController::class , 'uploadImage']);
    Route::get('/debug', [\App\Http\Controllers\Api\InventoryApiController::class , 'debug']);
    Route::get('/statistics', [\App\Http\Controllers\Api\InventoryApiController::class , 'getStatistics']);
    Route::get('/categories', [\App\Http\Controllers\Api\InventoryApiController::class , 'getCategories']);
    Route::get('/suppliers', [\App\Http\Controllers\Api\InventoryApiController::class , 'getSuppliers']);
    Route::get('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'show']);
    Route::put('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'update']);
    Route::delete('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'destroy']);
});

// Inventory Categories Management Routes - Using inventory_category table
Route::prefix('inventory-categories')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\InventoryCategoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\InventoryCategoryApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\InventoryCategoryApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\InventoryCategoryApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\InventoryCategoryApiController::class , 'destroy']);
});

// LCP Management Routes - Using lcp table
Route::prefix('lcp')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\LcpApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\LcpApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\LcpApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\LcpApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\LcpApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\LcpApiController::class , 'destroy']);
});

// NAP Management Routes - Using nap table
Route::prefix('nap')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\NapApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\NapApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\NapApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\NapApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\NapApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\NapApiController::class , 'destroy']);
});

// Port Management Routes - Using port table (both singular and plural for compatibility)
Route::prefix('port')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\PortApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\PortApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\PortApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'destroy']);
});

// Ports (plural) for frontend compatibility
Route::prefix('ports')->group(function () {
    Route::get('/used', [\App\Http\Controllers\Api\PortApiController::class , 'getUsedPorts']);
    Route::get('/', [\App\Http\Controllers\Api\PortApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\PortApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\PortApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\PortApiController::class , 'destroy']);
});

// VLAN Management Routes - Using vlan table
Route::prefix('vlan')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\VlanApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\VlanApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\VlanApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'destroy']);
});

// Usage Type Management Routes - Using usage_type table
Route::prefix('usage-types')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\UsageTypeApiController::class , 'destroy']);
});

// Payment Method Management Routes - Using payment_methods table
Route::prefix('payment-methods')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\PaymentMethodApiController::class , 'destroy']);
});

// Work Order Category Management Routes
Route::prefix('work-categories')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\WorkOrderCategoryApiController::class , 'destroy']);
});

// Work Order Management Routes
Route::prefix('work-orders')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'destroy']);
    Route::post('/{id}/upload-images', [\App\Http\Controllers\Api\WorkOrderApiController::class , 'uploadImages']);
});

// VLANs (plural) for frontend compatibility
Route::prefix('vlans')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\VlanApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\VlanApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\VlanApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\VlanApiController::class , 'destroy']);
});

// LCPNAP Location Management Routes - Using lcpnap table
Route::prefix('lcpnap')->group(function () {
    Route::get('/get-most-used', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'getMostUsedLCPNAPs']);
    Route::get('/', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'show']);
    Route::get('/{id}/related-customers', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'getRelatedCustomers']);
    Route::put('/{id}', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'destroy']);
});

// LCPNAP Locations endpoint (for distinct locations)
Route::get('/lcp-nap-locations', [\App\Http\Controllers\Api\LcpNapLocationController::class , 'getLocations']);

// Inventory Items for frontend compatibility
Route::prefix('inventory-items')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\InventoryApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\InventoryApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\InventoryApiController::class , 'getStatistics']);
    Route::get('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'show']);
    Route::put('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'update']);
    Route::delete('/{itemName}', [\App\Http\Controllers\Api\InventoryApiController::class , 'destroy']);
});

// Inventory Logs
Route::prefix('inventory-logs')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\InventoryLogApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\InventoryLogApiController::class , 'store']);
});



// Routes to match frontend requests - using the *_list tables directly
Route::prefix('region_list')->group(function () {
    Route::get('/', [RegionController::class , 'index']);
    Route::get('/{id}', [RegionController::class , 'show']);
});

Route::prefix('city_list')->group(function () {
    Route::get('/', [CityController::class , 'index']);
    Route::get('/{id}', [CityController::class , 'show']);
    Route::get('/region/{regionId}', [CityController::class , 'getByRegion']);
});

Route::prefix('barangay_list')->group(function () {
    Route::get('/', function () {
            try {
                $barangays = \App\Models\Barangay::all();
                return response()->json([
                'success' => true,
                'data' => $barangays
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching barangays: ' . $e->getMessage()
                ], 500);
            }
        }
        );
        Route::get('/{id}', function ($id) {
            try {
                $barangay = \App\Models\Barangay::findOrFail($id);
                return response()->json([
                'success' => true,
                'data' => $barangay
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching barangay: ' . $e->getMessage()
                ], 404);
            }
        }
        );
        Route::get('/city/{cityId}', function ($cityId) {
            try {
                $barangays = \App\Models\Barangay::where('city_id', $cityId)->get();
                return response()->json([
                'success' => true,
                'data' => $barangays
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching barangays: ' . $e->getMessage()
                ], 500);
            }
        }
        );    });

// Add debug routes for location troubleshooting
Route::get('/debug/location-tables', [\App\Http\Controllers\LocationDebugController::class , 'verifyTables']);

// Add debug route to inspect database tables
Route::get('/debug/tables', function () {
    try {
        $tables = [
            'region_list' => \Illuminate\Support\Facades\DB::select('SELECT * FROM region_list LIMIT 10'),
            'city_list' => \Illuminate\Support\Facades\DB::select('SELECT * FROM city_list LIMIT 10'),
            'barangay_list' => \Illuminate\Support\Facades\DB::select('SELECT * FROM barangay_list LIMIT 10')
        ];

        $hasAppTables = [
            'app_regions' => \Illuminate\Support\Facades\Schema::hasTable('app_regions'),
            'app_cities' => \Illuminate\Support\Facades\Schema::hasTable('app_cities'),
            'app_barangays' => \Illuminate\Support\Facades\Schema::hasTable('app_barangays')
        ];

        return response()->json([
        'success' => true,
        'list_tables' => $tables,
        'has_app_tables' => $hasAppTables,
        'models' => [
        'Region' => get_class_vars('\\App\\Models\\Region'),
        'City' => get_class_vars('\\App\\Models\\City'),
        'Barangay' => get_class_vars('\\App\\Models\\Barangay')
        ]
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Error checking tables: ' . $e->getMessage()
        ], 500);
    }
});

// Service Orders Management Routes
Route::prefix('service-orders')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'store']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'broadcastViewing']);
    Route::get('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'update']);
    Route::post('/{id}/log-blocked-transfer', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'logBlockedTransfer']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'destroy']);
});

// Service Order Items Management Routes
Route::prefix('service-order-items')->group(function () {
    Route::get('/', [ServiceOrderItemApiController::class , 'index']);
    Route::post('/', [ServiceOrderItemApiController::class , 'store']);
    Route::get('/{id}', [ServiceOrderItemApiController::class , 'show']);
    Route::put('/{id}', [ServiceOrderItemApiController::class , 'update']);
    Route::delete('/{id}', [ServiceOrderItemApiController::class , 'destroy']);
});

// Also add underscore version for compatibility
Route::prefix('service_order_items')->group(function () {
    Route::get('/', [ServiceOrderItemApiController::class , 'index']);
    Route::post('/', [ServiceOrderItemApiController::class , 'store']);
    Route::get('/{id}', [ServiceOrderItemApiController::class , 'show']);
    Route::put('/{id}', [ServiceOrderItemApiController::class , 'update']);
    Route::delete('/{id}', [ServiceOrderItemApiController::class , 'destroy']);
});

// Also add underscore version for compatibility
Route::prefix('service_orders')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'store']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'broadcastViewing']);
    Route::get('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'update']);
    Route::post('/{id}/log-blocked-transfer', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'logBlockedTransfer']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\ServiceOrderApiController::class , 'destroy']);
});

// Customer Detail Management - Dedicated endpoint for customer details view
Route::get('/customer-detail/{accountNo}', [\App\Http\Controllers\CustomerDetailController::class , 'show']);

// Customer Detail Update Routes - Update customer, billing, and technical details
Route::put('/customer-detail/{accountNo}', [\App\Http\Controllers\CustomerDetailUpdateController::class , 'update']);
Route::put('/customer-detail/{accountNo}/customer', [\App\Http\Controllers\CustomerDetailUpdateController::class , 'updateCustomerDetails']);
Route::put('/customer-detail/{accountNo}/billing', [\App\Http\Controllers\CustomerDetailUpdateController::class , 'updateBillingDetails']);
Route::put('/customer-detail/{accountNo}/technical', [\App\Http\Controllers\CustomerDetailUpdateController::class , 'updateTechnicalDetails']);

// Customer Management Routes
Route::prefix('customers')->group(function () {
    Route::get('/', [\App\Http\Controllers\CustomerController::class , 'index']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\CustomerController::class , 'broadcastViewing']);
    Route::post('/', [\App\Http\Controllers\CustomerController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\CustomerController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\CustomerController::class , 'update']);
    Route::post('/{id}/upload-images', [\App\Http\Controllers\CustomerController::class, 'uploadImages']);
    Route::delete('/{id}', [\App\Http\Controllers\CustomerController::class, 'destroy']);
});

// Billing API Routes - Fetches from customers, billing_accounts, and technical_details
Route::prefix('billing')->group(function () {
    Route::get('/check-updates', [\App\Http\Controllers\BillingController::class , 'checkUpdates']);
    Route::get('/', [\App\Http\Controllers\BillingController::class , 'index']);
    Route::get('/{id}', [\App\Http\Controllers\BillingController::class , 'show']);
    Route::get('/accounts/active', function () {
            try {
                $accounts = \App\Models\BillingAccount::with(['customer'])
                    ->where('billing_status_id', 2)
                    ->whereNotNull('date_installed')
                    ->get();
                return response()->json([
                'success' => true,
                'data' => $accounts,
                'count' => $accounts->count()
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching active accounts',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );
        Route::get('/accounts/by-day/{day}', function ($day) {
            try {
                $accounts = \App\Models\BillingAccount::with(['customer'])
                    ->where('billing_day', $day)
                    ->where('billing_status_id', 2)
                    ->whereNotNull('date_installed')
                    ->get();
                return response()->json([
                'success' => true,
                'data' => $accounts,
                'count' => $accounts->count(),
                'billing_day' => $day
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching accounts by billing day',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

// Billing Details API Routes
Route::prefix('billing-details')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'destroy']);
});

// Also add underscore version for compatibility
Route::prefix('billing_details')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\BillingDetailsApiController::class , 'destroy']);
});

// Billing Status API Routes
Route::prefix('billing-statuses')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\BillingStatusApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\BillingStatusApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\BillingStatusApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\BillingStatusApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\BillingStatusApiController::class , 'destroy']);
});

// Debug route to check customers table structure
Route::get('/debug/customers-structure', function () {
    try {
        $customer = \App\Models\Customer::first();

        if (!$customer) {
            return response()->json([
            'success' => false,
            'message' => 'No customers found in database'
            ]);
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('customers');

        return response()->json([
        'success' => true,
        'columns' => $columns,
        'sample_customer' => $customer->getAttributes(),
        'desired_plan_value' => $customer->desired_plan ?? 'NULL or not accessible'
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

// Debug route to check customers table structure
Route::get('/debug/customers-structure', function () {
    try {
        $customer = \App\Models\Customer::first();

        if (!$customer) {
            return response()->json([
            'success' => false,
            'message' => 'No customers found in database'
            ]);
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('customers');

        return response()->json([
        'success' => true,
        'columns' => $columns,
        'sample_customer' => $customer->getAttributes(),
        'contact_number_primary' => $customer->contact_number_primary ?? 'NULL',
        'contact_number_secondary' => $customer->contact_number_secondary ?? 'NULL',
        'has_secondary_field' => in_array('contact_number_secondary', $columns)
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

// Debug route to check billing data
Route::get('/debug/billing-data', function () {
    try {
        $billingAccount = \App\Models\BillingAccount::with(['customer', 'technicalDetails'])->first();

        if (!$billingAccount) {
            return response()->json([
            'success' => false,
            'message' => 'No billing accounts found'
            ]);
        }

        $customer = $billingAccount->customer;
        $technicalDetail = $billingAccount->technicalDetails->first();

        return response()->json([
        'success' => true,
        'billing_account' => $billingAccount->getAttributes(),
        'customer_exists' => $customer ? true : false,
        'customer_data' => $customer ? $customer->getAttributes() : null,
        'desired_plan_from_customer' => $customer ? $customer->desired_plan : 'NO CUSTOMER',
        'technical_detail_exists' => $technicalDetail ? true : false,
        'mapped_plan_value' => $customer ? $customer->desired_plan : null,
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// Billing Generation Routes
Route::prefix('billing-generation')->group(function () {
    Route::post('/generate-invoices', [\App\Http\Controllers\BillingGenerationController::class , 'generateInvoices']);
    Route::post('/generate-statements', [\App\Http\Controllers\BillingGenerationController::class , 'generateStatements']);
    Route::post('/generate-today', [\App\Http\Controllers\BillingGenerationController::class , 'generateTodaysBillings']);
    Route::post('/generate-enhanced-invoices', [\App\Http\Controllers\BillingGenerationController::class , 'generateEnhancedInvoices']);
    Route::post('/generate-enhanced-statements', [\App\Http\Controllers\BillingGenerationController::class , 'generateEnhancedStatements']);
    Route::post('/generate-for-day', [\App\Http\Controllers\BillingGenerationController::class , 'generateBillingsForDay']);
    Route::post('/force-generate-all', [\App\Http\Controllers\BillingGenerationController::class , 'forceGenerateAll']);
    Route::get('/invoices', [\App\Http\Controllers\BillingGenerationController::class , 'getInvoices']);
    Route::get('/statements', [\App\Http\Controllers\BillingGenerationController::class , 'getStatements']);
    Route::post('/generate-custom', [\App\Http\Controllers\BillingGenerationController::class , 'generateCustomBilling']);
});

// Billing Records Routes - Direct database fetch (separate from billing-generation)
Route::get('/soa-records', [\App\Http\Controllers\BillingRecordsController::class , 'getSOARecords']);
Route::get('/invoice-records', [\App\Http\Controllers\BillingRecordsController::class , 'getInvoiceRecords']);


// Advanced Payment Routes
Route::prefix('advanced-payments')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\AdvancedPaymentApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\AdvancedPaymentApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\AdvancedPaymentApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\AdvancedPaymentApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\AdvancedPaymentApiController::class , 'destroy']);
});

// Mass Rebate Routes
Route::prefix('mass-rebates')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\MassRebateApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\MassRebateApiController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\Api\MassRebateApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\MassRebateApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\MassRebateApiController::class , 'destroy']);
    Route::post('/{id}/mark-used', [\App\Http\Controllers\Api\MassRebateApiController::class , 'markAsUsed']);
});

// Installment Schedule Routes
Route::prefix('installment-schedules')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\InstallmentScheduleApiController::class , 'index']);
    Route::post('/generate', [\App\Http\Controllers\Api\InstallmentScheduleApiController::class , 'generateSchedules']);
    Route::get('/{id}', [\App\Http\Controllers\Api\InstallmentScheduleApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\InstallmentScheduleApiController::class , 'update']);
    Route::get('/account/{accountId}', [\App\Http\Controllers\Api\InstallmentScheduleApiController::class , 'getByAccount']);
});

Route::prefix('radius')->group(function () {
    Route::post('/create-account', [RadiusController::class , 'createAccount']);
    
    // Manual Operations
    Route::post('/operation', [ManualRadiusOperationsController::class, 'handleOperation']);
    Route::post('/disconnect', [ManualRadiusOperationsController::class, 'disconnectUser']);
    Route::post('/reconnect', [ManualRadiusOperationsController::class, 'reconnectUser']);
    Route::post('/update-group', [ManualRadiusOperationsController::class, 'updateGroup']);
    Route::post('/update-credentials', [ManualRadiusOperationsController::class, 'updateCredentials']);
    Route::post('/disable', [ManualRadiusOperationsController::class, 'disabledUser']);
    Route::post('/enable', [ManualRadiusOperationsController::class, 'enabledUser']);
});

// Custom Account Number Management Routes
Route::get('/custom-account-number', [\App\Http\Controllers\CustomAccountNumberController::class , 'index']);
Route::post('/custom-account-number', [\App\Http\Controllers\CustomAccountNumberController::class , 'store']);
Route::put('/custom-account-number', [\App\Http\Controllers\CustomAccountNumberController::class , 'update']);
Route::delete('/custom-account-number', [\App\Http\Controllers\CustomAccountNumberController::class , 'destroy']);

// Debug endpoint for custom account number table
Route::get('/debug/custom-account-number-table', function () {
    try {
        $tableExists = \Illuminate\Support\Facades\Schema::hasTable('custom_account_number');

        if (!$tableExists) {
            return response()->json([
            'success' => false,
            'message' => 'Table does not exist',
            'table_exists' => false,
            'migration_needed' => true
            ]);
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('custom_account_number');
        $count = \Illuminate\Support\Facades\DB::table('custom_account_number')->count();

        return response()->json([
        'success' => true,
        'message' => 'Table exists',
        'table_exists' => true,
        'columns' => $columns,
        'record_count' => $count
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Error checking table',
        'error' => $e->getMessage()
        ], 500);
    }
});

// Test endpoint to insert a record
Route::post('/debug/test-custom-account-number', function (\Illuminate\Http\Request $request) {
    try {
        \Illuminate\Support\Facades\Log::info('Test insert attempt', [
            'request_data' => $request->all()
        ]);

        $result = \Illuminate\Support\Facades\DB::table('custom_account_number')->insert([
            'starting_number' => 'TEST123',
            'updated_by' => 'test@example.com',
            'created_at' => now(),
            'updated_at' => now()
        ]);

        return response()->json([
        'success' => true,
        'message' => 'Test insert successful',
        'result' => $result
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Test insert failed',
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// Location Details Management Routes - Using location table
Route::prefix('location-details')->group(function () {
    Route::get('/', [\App\Http\Controllers\LocationDetailController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\LocationDetailController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\LocationDetailController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\LocationDetailController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\LocationDetailController::class , 'destroy']);
    Route::get('/barangay/{barangayId}', [\App\Http\Controllers\LocationDetailController::class , 'getByBarangay']);
});

// Billing Configuration Management Routes
Route::get('/billing-config', [\App\Http\Controllers\BillingConfigController::class , 'index']);
Route::post('/billing-config', [\App\Http\Controllers\BillingConfigController::class , 'store']);
Route::put('/billing-config', [\App\Http\Controllers\BillingConfigController::class , 'update']);
Route::delete('/billing-config', [\App\Http\Controllers\BillingConfigController::class , 'destroy']);

// RADIUS Configuration Management Routes
Route::get('/radius-config', [\App\Http\Controllers\RadiusConfigController::class , 'index']);
Route::post('/radius-config', [\App\Http\Controllers\RadiusConfigController::class , 'store']);
Route::put('/radius-config/{id}', [\App\Http\Controllers\RadiusConfigController::class , 'update']);
Route::delete('/radius-config/{id}', [\App\Http\Controllers\RadiusConfigController::class , 'destroy']);

// SMS Configuration Management Routes
Route::get('/sms-config', [\App\Http\Controllers\SmsConfigController::class , 'index']);
Route::post('/sms-config', [\App\Http\Controllers\SmsConfigController::class , 'store']);
Route::put('/sms-config/{id}', [\App\Http\Controllers\SmsConfigController::class , 'update']);
Route::delete('/sms-config/{id}', [\App\Http\Controllers\SmsConfigController::class , 'destroy']);

// Email Template Management Routes
Route::get('/email-templates', [\App\Http\Controllers\EmailTemplateController::class , 'index']);
Route::post('/email-templates', [\App\Http\Controllers\EmailTemplateController::class , 'store']);
Route::get('/email-templates/{templateCode}', [\App\Http\Controllers\EmailTemplateController::class , 'show']);
Route::put('/email-templates/{templateCode}', [\App\Http\Controllers\EmailTemplateController::class , 'update']);
Route::delete('/email-templates/{templateCode}', [\App\Http\Controllers\EmailTemplateController::class , 'destroy']);
Route::post('/email-templates/{templateCode}/toggle-active', [\App\Http\Controllers\EmailTemplateController::class , 'toggleActive']);

Route::prefix('email-queue')->group(function () {
    Route::get('/', [EmailQueueController::class , 'index']);
    Route::get('/stats', [EmailQueueController::class , 'stats']);
    Route::get('/{id}', [EmailQueueController::class , 'show']);
    Route::post('/queue', [EmailQueueController::class , 'queueEmail']);
    Route::post('/queue-template', [EmailQueueController::class , 'queueFromTemplate']);
    Route::post('/process', [EmailQueueController::class , 'processQueue']);
    Route::post('/retry-failed', [EmailQueueController::class , 'retryFailed']);
    Route::post('/{id}/retry', [EmailQueueController::class , 'retry']);
    Route::delete('/{id}', [EmailQueueController::class , 'delete']);
    Route::post('/send-credentials/{userId}', [EmailQueueController::class , 'sendUserCredentials']);
});

// Settings Image Size Management Routes
Route::prefix('settings-image-size')->group(function () {
    Route::get('/', [\App\Http\Controllers\SettingsImageSizeController::class , 'index']);
    Route::get('/active', [\App\Http\Controllers\SettingsImageSizeController::class , 'getActive']);
    Route::put('/{id}/status', [\App\Http\Controllers\SettingsImageSizeController::class , 'updateStatus']);
});

Route::get('/settings/image-size', function () {
    try {
        $sizes = \App\Models\SettingsImageSize::orderBy('id')->get();
        return response()->json([
        'success' => true,
        'data' => $sizes
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Error fetching image size settings',
        'error' => $e->getMessage()
        ], 500);
    }
});

// Settings Color Palette Management Routes
Route::prefix('settings-color-palette')->group(function () {
    Route::get('/', [\App\Http\Controllers\SettingsColorPaletteController::class , 'index']);
    Route::get('/active', [\App\Http\Controllers\SettingsColorPaletteController::class , 'getActive']);
    Route::post('/', [\App\Http\Controllers\SettingsColorPaletteController::class , 'store']);
    Route::put('/{id}', [\App\Http\Controllers\SettingsColorPaletteController::class , 'update']);
    Route::put('/{id}/status', [\App\Http\Controllers\SettingsColorPaletteController::class , 'updateStatus']);
    Route::delete('/{id}', [\App\Http\Controllers\SettingsColorPaletteController::class , 'destroy']);
});

// Transaction Management Routes
Route::prefix('transactions')->group(function () {
    Route::get('/', [\App\Http\Controllers\TransactionController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\TransactionController::class , 'store']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\TransactionController::class , 'broadcastViewing']);
    Route::post('/upload-images', [\App\Http\Controllers\TransactionController::class , 'uploadImages']);
    Route::post('/batch-approve', [\App\Http\Controllers\TransactionController::class , 'batchApprove']);
    Route::get('/{id}', [\App\Http\Controllers\TransactionController::class , 'show']);
    // Print-ready projection for the receipt / invoice templates. Registered ahead of the
    // parameterised routes below only for readability — it is a two-segment path, so the
    // single-segment `/{id}` above can never swallow it.
    Route::get('/{id}/receipt', [\App\Http\Controllers\TransactionController::class , 'receipt']);
    Route::put('/{id}', [\App\Http\Controllers\TransactionController::class , 'update']);
    Route::post('/{id}/approve', [\App\Http\Controllers\TransactionController::class , 'approve']);
    Route::post('/{id}/revert', [\App\Http\Controllers\TransactionController::class , 'revert']);
    Route::put('/{id}/status', [\App\Http\Controllers\TransactionController::class , 'updateStatus']);
    Route::delete('/{id}', [\App\Http\Controllers\TransactionController::class , 'destroy']);
});

// Transaction Revert Request Routes (Super Admin only)
Route::prefix('transaction-reverts')->group(function () {
    Route::get('/', [\App\Http\Controllers\TransactionRevertController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\TransactionRevertController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\TransactionRevertController::class , 'show']);
    Route::put('/{id}/status', [\App\Http\Controllers\TransactionRevertController::class , 'updateStatus']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\TransactionRevertController::class , 'broadcastViewing']);
});

/*
 * Prepaid Expiration Override Routes.
 *
 * billing_accounts.prepaid_expires_at is read-only on the Edit Billing Details form; these
 * endpoints are the only way it moves outside of a payment. Requests are raised from the clock
 * icon on Customer Details and decided in Billing -> Prepaid Override.
 */
Route::prefix('prepaid-overrides')->middleware('auth:sanctum')->group(function () {
    Route::get('/', [\App\Http\Controllers\PrepaidOverrideRequestController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\PrepaidOverrideRequestController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\PrepaidOverrideRequestController::class , 'show']);
    Route::put('/{id}/status', [\App\Http\Controllers\PrepaidOverrideRequestController::class , 'updateStatus']);
});

// Rebates endpoint for frontend
Route::get('/rebates', function () {
    try {
        $rebates = \App\Models\MassRebate::orderBy('id', 'desc')->get();
        return response()->json($rebates);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'message' => 'Error fetching rebates',
        'error' => $e->getMessage()
        ], 500);
    }
});

// Mass Rebate Management Routes
Route::prefix('mass-rebates')->group(function () {
    Route::post('/test', function (Request $request) {
            try {
                $data = $request->all();

                \Illuminate\Support\Facades\Log::info('Test endpoint received data', [
                    'data' => $data,
                    'headers' => $request->headers->all()
                ]);

                return response()->json([
                'success' => true,
                'message' => 'Test endpoint working',
                'received_data' => $data,
                'validation_would_pass' => true
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
                ], 500);
            }
        }
        );

        Route::get('/test-connection', function () {
            try {
                $tableExists = \Illuminate\Support\Facades\Schema::hasTable('rebates');

                if (!$tableExists) {
                    return response()->json([
                    'success' => false,
                    'message' => 'Rebates table does not exist'
                    ], 404);
                }

                $columns = \Illuminate\Support\Facades\Schema::getColumnListing('rebates');
                $count = \Illuminate\Support\Facades\DB::table('rebates')->count();

                return response()->json([
                'success' => true,
                'message' => 'Database connection successful',
                'table_exists' => true,
                'columns' => $columns,
                'record_count' => $count
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Database connection failed',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::get('/', function (Request $request) {
            try {
                $query = MassRebate::query();

                if ($request->has('rebate_type')) {
                    $query->byType($request->rebate_type);
                }

                if ($request->has('status')) {
                    if ($request->status === 'Unused') {
                        $query->unused();
                    }
                    elseif ($request->status === 'Used') {
                        $query->used();
                    }
                }

                if ($request->has('search')) {
                    $search = $request->search;
                    $query->where(function ($q) use ($search) {
                                    $q->byRebate($search)
                                        ->orWhere('modified_by', 'like', "%{$search}%");
                                }
                                );
                            }

                            $rebates = $query->orderBy('id', 'desc')->get();

                            \Illuminate\Support\Facades\Log::info('Fetched mass rebates', [
                                'count' => $rebates->count(),
                                'filters' => $request->only(['rebate_type', 'status', 'search'])
                            ]);

                            return response()->json([
                            'success' => true,
                            'data' => $rebates,
                            'count' => $rebates->count()
                            ]);
                        }
                        catch (\Exception $e) {
                            \Illuminate\Support\Facades\Log::error('Error fetching rebates', [
                                'error' => $e->getMessage()
                            ]);
                            return response()->json([
                            'success' => false,
                            'message' => 'Error fetching rebates',
                            'error' => $e->getMessage()
                            ], 500);
                        }
                    }
                    );

                    Route::post('/', function (Request $request) {
            try {
                \Illuminate\Support\Facades\Log::info('Received mass rebate creation request', [
                    'data' => $request->all(),
                    'method' => $request->method(),
                    'path' => $request->path()
                ]);

                $validated = $request->validate([
                    'number_of_dates' => 'required|integer|min:1',
                    'rebate_type' => 'required|in:lcpnap,lcp,location',
                    'selected_rebate' => 'required|string|max:255',
                    'month' => 'required|string|max:50',
                    'status' => 'sometimes|in:Unused,Used,Pending',
                    'created_by' => 'required|string|max:255',
                    'modified_by' => 'nullable|string|max:255'
                ]);

                $validated['status'] = $validated['status'] ?? 'Pending';

                \Illuminate\Support\Facades\Log::info('Validation passed, creating mass rebate', [
                    'data' => $validated
                ]);

                \Illuminate\Support\Facades\DB::beginTransaction();

                $rebate = MassRebate::create($validated);

                \Illuminate\Support\Facades\Log::info('Mass rebate created, finding matching accounts', [
                    'rebate_id' => $rebate->id,
                    'rebate_type' => $validated['rebate_type'],
                    'selected_rebate' => $validated['selected_rebate']
                ]);

                $accountNumbers = [];

                if ($validated['rebate_type'] === 'lcpnap') {
                    $accountNumbers = \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                        ->where('technical_details.lcpnap', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->pluck('billing_accounts.account_no')
                        ->toArray();

                    \Illuminate\Support\Facades\Log::info('LCPNAP query results', [
                        'query' => \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                        ->where('technical_details.lcpnap', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->toSql(),
                        'count' => count($accountNumbers)
                    ]);
                }
                elseif ($validated['rebate_type'] === 'lcp') {
                    $accountNumbers = \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                        ->where('technical_details.lcp', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->pluck('billing_accounts.account_no')
                        ->toArray();

                    \Illuminate\Support\Facades\Log::info('LCP query results', [
                        'query' => \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                        ->where('technical_details.lcp', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->toSql(),
                        'selected_rebate' => $validated['selected_rebate'],
                        'count' => count($accountNumbers),
                        'accounts' => $accountNumbers
                    ]);
                }
                elseif ($validated['rebate_type'] === 'location') {
                    $accountNumbers = \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.location', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->pluck('billing_accounts.account_no')
                        ->toArray();

                    \Illuminate\Support\Facades\Log::info('Location query results', [
                        'query' => \Illuminate\Support\Facades\DB::table('billing_accounts')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('customers.location', $validated['selected_rebate'])
                        ->whereNotNull('billing_accounts.date_installed')
                        ->toSql(),
                        'count' => count($accountNumbers)
                    ]);
                }

                \Illuminate\Support\Facades\Log::info('Found matching accounts', [
                    'count' => count($accountNumbers),
                    'accounts' => $accountNumbers
                ]);

                $usageRecords = [];
                foreach ($accountNumbers as $accountNo) {
                    $usageRecords[] = [
                        'rebates_id' => $rebate->id,
                        'account_no' => $accountNo,
                        'status' => 'Unused',
                        'month' => $validated['month']
                    ];
                }

                if (!empty($usageRecords)) {
                    \Illuminate\Support\Facades\DB::table('rebates_usage')->insert($usageRecords);
                    \Illuminate\Support\Facades\Log::info('Created rebate usage records', [
                        'count' => count($usageRecords)
                    ]);
                }

                \Illuminate\Support\Facades\DB::commit();

                \Illuminate\Support\Facades\Log::info('Mass rebate created successfully', [
                    'id' => $rebate->id,
                    'rebate' => $rebate->toArray(),
                    'usage_records_created' => count($usageRecords)
                ]);

                return response()->json([
                'success' => true,
                'message' => 'Mass rebate created successfully',
                'data' => $rebate,
                'usage_records_created' => count($usageRecords)
                ], 201);
            }
            catch (\Illuminate\Validation\ValidationException $e) {
                \Illuminate\Support\Facades\DB::rollBack();
                \Illuminate\Support\Facades\Log::error('Mass rebate validation failed', [
                    'errors' => $e->errors(),
                    'input' => $request->all()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
                ], 422);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\DB::rollBack();
                \Illuminate\Support\Facades\Log::error('Failed to create mass rebate', [
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString(),
                    'file' => $e->getFile(),
                    'line' => $e->getLine(),
                    'input' => $request->all()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Failed to create mass rebate',
                'error' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
                ], 500);
            }
        }
        );

        Route::get('/{id}', function ($id) {
            try {
                $rebate = MassRebate::find($id);

                if (!$rebate) {
                    return response()->json([
                    'success' => false,
                    'message' => 'Rebate not found'
                    ], 404);
                }

                return response()->json([
                'success' => true,
                'data' => $rebate
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Error fetching rebate',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::put('/{id}', function ($id, Request $request) {
            try {
                $rebate = MassRebate::find($id);

                if (!$rebate) {
                    return response()->json([
                    'success' => false,
                    'message' => 'Rebate not found'
                    ], 404);
                }

                $validated = $request->validate([
                    'number_of_dates' => 'sometimes|integer|min:1',
                    'rebate_type' => 'sometimes|in:lcpnap,lcp,location',
                    'selected_rebate' => 'sometimes|string|max:255',
                    'month' => 'sometimes|string|max:50',
                    'status' => 'sometimes|in:Unused,Used',
                    'modified_by' => 'sometimes|string|max:255'
                ]);

                \Illuminate\Support\Facades\Log::info('Updating mass rebate', [
                    'id' => $id,
                    'data' => $validated
                ]);

                $rebate->update($validated);

                return response()->json([
                'success' => true,
                'message' => 'Mass rebate updated successfully',
                'data' => $rebate->fresh()
                ]);
            }
            catch (\Illuminate\Validation\ValidationException $e) {
                return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
                ], 422);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Failed to update mass rebate', [
                    'id' => $id,
                    'error' => $e->getMessage()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Failed to update mass rebate',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::delete('/{id}', function ($id) {
            try {
                $rebate = MassRebate::find($id);

                if (!$rebate) {
                    return response()->json([
                    'success' => false,
                    'message' => 'Rebate not found'
                    ], 404);
                }

                \Illuminate\Support\Facades\Log::info('Deleting mass rebate', ['id' => $id]);

                $rebate->delete();

                return response()->json([
                'success' => true,
                'message' => 'Mass rebate deleted successfully'
                ]);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Failed to delete mass rebate', [
                    'id' => $id,
                    'error' => $e->getMessage()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Failed to delete mass rebate',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );

        Route::post('/{id}/mark-used', function ($id) {
            try {
                $rebate = MassRebate::find($id);

                if (!$rebate) {
                    return response()->json([
                    'success' => false,
                    'message' => 'Rebate not found'
                    ], 404);
                }

                \Illuminate\Support\Facades\Log::info('Marking mass rebate as used', ['id' => $id]);

                $rebate->markAsUsed();

                return response()->json([
                'success' => true,
                'message' => 'Mass rebate marked as used',
                'data' => $rebate->fresh()
                ]);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Failed to mark rebate as used', [
                    'id' => $id,
                    'error' => $e->getMessage()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Failed to mark rebate as used',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

// Rebates Usage Routes
Route::prefix('rebates-usage')->group(function () {
    Route::get('/', function (Request $request) {
            try {
                $query = \Illuminate\Support\Facades\DB::table('rebates_usage');

                if ($request->has('rebates_id')) {
                    $query->where('rebates_id', $request->rebates_id);
                }

                if ($request->has('account_no')) {
                    $query->where('account_no', $request->account_no);
                }

                if ($request->has('status')) {
                    $query->where('status', $request->status);
                }

                if ($request->has('month')) {
                    $query->where('month', $request->month);
                }

                $usages = $query->orderBy('id', 'desc')->get();

                return response()->json([
                'success' => true,
                'data' => $usages,
                'count' => $usages->count()
                ]);
            }
            catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Error fetching rebate usages', [
                    'error' => $e->getMessage()
                ]);
                return response()->json([
                'success' => false,
                'message' => 'Error fetching rebate usages',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

// Staggered Installation Management Routes
Route::prefix('staggered-installations')->group(function () {
    Route::get('/', [\App\Http\Controllers\StaggeredInstallationController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\StaggeredInstallationController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\StaggeredInstallationController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\StaggeredInstallationController::class , 'update']);
    Route::post('/{id}/approve', [\App\Http\Controllers\StaggeredInstallationController::class , 'approve']);
    Route::delete('/{id}', [\App\Http\Controllers\StaggeredInstallationController::class , 'destroy']);
    Route::post('/broadcast-viewing', [\App\Http\Controllers\StaggeredInstallationController::class , 'broadcastViewing']);
});

// Concern Management Routes
Route::prefix('concerns')->group(function () {
    Route::get('/', [\App\Http\Controllers\ConcernController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\ConcernController::class , 'store']);
    Route::get('/{id}', [\App\Http\Controllers\ConcernController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\ConcernController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\ConcernController::class , 'destroy']);
});

// Google Drive Upload Route
Route::post('/google-drive/upload', [\App\Http\Controllers\GoogleDriveController::class , 'upload']);

// Billing Notification Routes
Route::prefix('billing-notifications')->group(function () {
    Route::post('/generate-with-notifications', [\App\Http\Controllers\BillingNotificationController::class , 'generateWithNotifications']);
    Route::post('/send-overdue', [\App\Http\Controllers\BillingNotificationController::class , 'sendOverdueNotices']);
    Route::post('/send-dc-notices', [\App\Http\Controllers\BillingNotificationController::class , 'sendDcNotices']);
    Route::post('/test', [\App\Http\Controllers\BillingNotificationController::class , 'testNotification']);
    Route::post('/retry-failed', [\App\Http\Controllers\BillingNotificationController::class , 'retryFailedNotifications']);
});

// SMS Sending Routes
Route::prefix('sms')->group(function () {
    Route::post('/send', [\App\Http\Controllers\SmsController::class , 'sendSms']);
    Route::post('/blast', [\App\Http\Controllers\SmsController::class , 'sendBlast']);
    Route::get('/logs', [\App\Http\Controllers\SmsController::class , 'smsLogs']);

    // GET test route for browser testing
    Route::get('/test', function () {
            $smsService = app(\App\Services\ItexmoSmsService::class);

            $result = $smsService->send([
                'contact_no' => '09924313554',
                'message' => 'Test SMS from CBMS at ' . now()->format('Y-m-d H:i:s')
            ]);

            return response()->json($result);
        }
        );    });

// Debug route for concerns
Route::get('/debug/concerns', function () {
    try {
        $tableExists = \Illuminate\Support\Facades\Schema::hasTable('concern');

        if (!$tableExists) {
            return response()->json([
            'success' => false,
            'message' => 'Table concern does not exist',
            'table_exists' => false
            ]);
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('concern');
        $concerns = \Illuminate\Support\Facades\DB::table('concern')->get();

        return response()->json([
        'success' => true,
        'table_exists' => true,
        'columns' => $columns,
        'count' => $concerns->count(),
        'data' => $concerns
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

Route::prefix('billing-generation')->group(function () {
    Route::post('/generate-sample', [BillingGenerationController::class , 'generateSampleData']);
    Route::post('/force-generate-all', [BillingGenerationController::class , 'forceGenerateAll']);
    Route::post('/generate-for-day', [BillingGenerationController::class , 'generateBillingsForDay']);
    Route::post('/generate-today', [BillingGenerationController::class , 'generateTodaysBillings']);
    Route::post('/generate-statements', [BillingGenerationController::class , 'generateEnhancedStatements']);
    Route::post('/generate-invoices', [BillingGenerationController::class , 'generateEnhancedInvoices']);
    Route::get('/invoices', [BillingGenerationController::class , 'getInvoices']);
    Route::get('/statements', [BillingGenerationController::class , 'getStatements']);
    Route::post('/generate-custom', [BillingGenerationController::class , 'generateCustomBilling']);
});

Route::get('/billing-generation/test', function () {
    \Illuminate\Support\Facades\Log::info('Billing generation test route accessed');
    return response()->json(['success' => true, 'message' => 'Routes working!']);
});

// User Settings Routes
Route::prefix('user-settings')->group(function () {
    Route::post('/darkmode', [\App\Http\Controllers\UserSettingsController::class , 'updateDarkMode']);
    Route::get('/{userId}/darkmode', [\App\Http\Controllers\UserSettingsController::class , 'getDarkMode']);
});

// User Preferences Routes
Route::prefix('user-preferences')->middleware('web')->group(function () {
    Route::get('/debug', function () {
            try {
                $userId = \Auth::id();
                $tableExists = \Schema::hasTable('user_preferences');

                \Log::info('[UserPreferences Debug] Checking auth', [
                    'user_id' => $userId,
                    'session_id' => session()->getId(),
                    'has_session' => session()->has('_token'),
                    'cookies' => request()->cookies->all()
                ]);

                $result = [
                    'success' => true,
                    'user_authenticated' => $userId !== null,
                    'user_id' => $userId,
                    'session_id' => session()->getId(),
                    'table_exists' => $tableExists
                ];

                if ($tableExists) {
                    $result['columns'] = \Schema::getColumnListing('user_preferences');
                    $result['record_count'] = \DB::table('user_preferences')->count();

                    if ($userId) {
                        $result['user_preferences'] = \DB::table('user_preferences')
                            ->where('user_id', $userId)
                            ->get();
                    }
                }

                return response()->json($result);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
                ], 500);
            }
        }
        );

        Route::get('/all', [\App\Http\Controllers\UserPreferenceController::class , 'getAllPreferences']);
        Route::get('/{key}', [\App\Http\Controllers\UserPreferenceController::class , 'getPreference']);
        Route::post('/{key}', [\App\Http\Controllers\UserPreferenceController::class , 'setPreference']);
        Route::delete('/{key}', [\App\Http\Controllers\UserPreferenceController::class , 'deletePreference']);    });

// Debug route to check users table structure
Route::get('/debug/users-table', function () {
    try {
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('users');
        $user = \App\Models\User::first();

        return response()->json([
        'success' => true,
        'columns' => $columns,
        'has_darkmode' => in_array('darkmode', $columns),
        'sample_user' => $user ? [
        'id' => $user->id,
        'username' => $user->username,
        'darkmode' => $user->darkmode ?? 'column not found'
        ] : null
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

// System Config routes
Route::prefix('system-config')->group(function () {
    Route::get('/logo', [\App\Http\Controllers\SystemConfigController::class , 'getLogo']);
    Route::post('/logo', [\App\Http\Controllers\SystemConfigController::class , 'uploadLogo']);
    Route::delete('/logo', [\App\Http\Controllers\SystemConfigController::class , 'deleteLogo']);
});

// App Version Config routes
Route::prefix('app-version')->group(function () {
    Route::get('/config', [\App\Http\Controllers\SystemConfigController::class , 'getAppVersionConfig']);
    Route::put('/config', [\App\Http\Controllers\SystemConfigController::class , 'updateAppVersionConfig']);
});

// Notification routes
Route::prefix('notifications')->group(function () {
    Route::get('/recent-applications', [\App\Http\Controllers\NotificationController::class , 'getRecentApplications']);
    Route::get('/unread-count', [\App\Http\Controllers\NotificationController::class , 'getUnreadCount']);
    Route::get('/debug-timezone', [\App\Http\Controllers\NotificationController::class , 'debugTimezone']);
    Route::get('/consolidated', [ConsolidatedNotificationController::class , 'index']);
    // Attention counts for the sidebar menu badges and the header bell. Behind auth:sanctum
    // because the counts are scoped to the caller's organization — an unauthenticated request
    // would otherwise be told how much work exists across every tenant.
    Route::middleware('auth:sanctum')->get('/nav-badges', [\App\Http\Controllers\Api\NavBadgeCountController::class , 'index']);
});

Route::post('/debug/verify-password', function (Request $request) {
    $username = $request->input('username');
    $password = $request->input('password');

    $user = \App\Models\User::where('username', $username)->first();

    if (!$user) {
        return response()->json([
        'success' => false,
        'message' => 'User not found'
        ]);
    }

    $passwordMatch = Hash::check($password, $user->password_hash);

    return response()->json([
    'success' => true,
    'user' => [
    'username' => $user->username,
    'email' => $user->email_address,
    'contact' => $user->contact_number,
    ],
    'password_match' => $passwordMatch,
    'hash' => $user->password_hash
    ]);
});

// Xendit Payment routes
Route::prefix('payments')->group(function () {
    Route::post('/create', [\App\Http\Controllers\Api\XenditPaymentController::class , 'createPayment']);
    Route::post('/webhook', [\App\Http\Controllers\Api\XenditPaymentController::class , 'handleWebhook']);
    Route::post('/status', [\App\Http\Controllers\Api\XenditPaymentController::class , 'checkPaymentStatus']);
    Route::post('/check-pending', [\App\Http\Controllers\Api\XenditPaymentController::class , 'checkPendingPayment']);
    // Read-only: amount a prepaid onboarding bill would come to under a different plan.
    Route::post('/quote-plan-change', [\App\Http\Controllers\Api\XenditPaymentController::class , 'quotePlanChange']);
    Route::post('/account-balance', [\App\Http\Controllers\Api\XenditPaymentController::class , 'getAccountBalance']);
    Route::post('/cancel', [\App\Http\Controllers\Api\XenditPaymentController::class , 'cancelPayment']);
    // Read-only: the convenience fee rate, so a payment screen can disclose it before checkout.
    Route::get('/convenience-fee', [\App\Http\Controllers\Api\XenditPaymentController::class , 'getConvenienceFee']);

    // Test endpoint to verify webhook configuration
    Route::get('/webhook-info', function () {
            return response()->json([
            'status' => 'success',
            'message' => 'Xendit webhook endpoint is configured',
            'webhook_url' => 'https://backend.gowiser.ph/api/payments/webhook',
            'method' => 'POST',
            'required_header' => 'X-Callback-Token',
            'callback_token_configured' => !empty(env('XENDIT_CALLBACK_TOKEN')),
            'callback_token_length' => strlen(env('XENDIT_CALLBACK_TOKEN') ?? ''),
            'timestamp' => now()->toDateTimeString()
            ]);
        }
        );    });

Route::get('/xendit-webhook', function () {
    return response()->json([
    'status' => 'success',
    'message' => 'Xendit webhook endpoint is active',
    'method' => 'This endpoint accepts POST requests from Xendit',
    'timestamp' => now()->toDateTimeString()
    ]);
});

// Public webhook endpoint (no auth required)
Route::post('/xendit-webhook', [\App\Http\Controllers\Api\XenditPaymentController::class , 'handleWebhook']);

// Job Order Notification routes
Route::prefix('job-order-notifications')->group(function () {
    Route::post('/', [\App\Http\Controllers\JobOrderNotificationController::class , 'createJobOrderDoneNotification']);
    Route::get('/recent', [\App\Http\Controllers\JobOrderNotificationController::class , 'getRecentJobOrderNotifications']);
    Route::get('/unread-count', [\App\Http\Controllers\JobOrderNotificationController::class , 'getUnreadCount']);
    Route::put('/{id}/read', [\App\Http\Controllers\JobOrderNotificationController::class , 'markAsRead']);
    Route::put('/mark-all-read', [\App\Http\Controllers\JobOrderNotificationController::class , 'markAllAsRead']);
});

Route::prefix('payment-portal-logs')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\PaymentPortalLogsController::class , 'index']);
    Route::get('/{id}', [\App\Http\Controllers\Api\PaymentPortalLogsController::class , 'show']);
    Route::get('/account/{accountNo}', [\App\Http\Controllers\Api\PaymentPortalLogsController::class , 'getByAccountNo']);
});

// PPPoE Debug route
Route::get('/pppoe/debug', function () {
    try {
        $tableExists = \Illuminate\Support\Facades\Schema::hasTable('pppoe_username_patterns');

        $result = [
            'success' => true,
            'table_exists' => $tableExists
        ];

        if ($tableExists) {
            $result['columns'] = \Illuminate\Support\Facades\Schema::getColumnListing('pppoe_username_patterns');
            $result['count'] = \Illuminate\Support\Facades\DB::table('pppoe_username_patterns')->count();
            $result['sample'] = \Illuminate\Support\Facades\DB::table('pppoe_username_patterns')->first();

            // Check column types
            $columns = \Illuminate\Support\Facades\DB::select(
                "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_username_patterns'"
            );
            $result['column_types'] = $columns;
        }
        else {
            $result['message'] = 'Table does not exist. Run migration: php artisan migrate';
        }

        return response()->json($result);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// PPPoE Fix Column Types
Route::post('/pppoe/fix-columns', function () {
    try {
        \Illuminate\Support\Facades\DB::statement(
            "ALTER TABLE pppoe_username_patterns MODIFY COLUMN created_by VARCHAR(255) DEFAULT 'system'"
        );
        \Illuminate\Support\Facades\DB::statement(
            "ALTER TABLE pppoe_username_patterns MODIFY COLUMN updated_by VARCHAR(255) DEFAULT 'system'"
        );

        return response()->json([
        'success' => true,
        'message' => 'Columns fixed successfully'
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage()
        ], 500);
    }
});

// PPPoE Username Pattern routes
Route::prefix('pppoe')->group(function () {
    Route::get('/patterns', [PPPoEController::class , 'getPatterns']);
    Route::post('/patterns', [PPPoEController::class , 'createPattern']);
    Route::post('/patterns/save', [PPPoEController::class , 'savePattern']);
    Route::get('/patterns/types', [PPPoEController::class , 'getAvailableTypes']);
    Route::get('/patterns/{id}', [PPPoEController::class , 'getPattern']);
    Route::put('/patterns/{id}', [PPPoEController::class , 'updatePattern']);
    Route::delete('/patterns/{id}', [PPPoEController::class , 'deletePattern']);

    Route::post('/test-save', function (Request $request) {
            try {
                \Log::info('PPPoE Test Save', ['data' => $request->all()]);

                $validated = $request->validate([
                    'pattern_name' => 'required|string|max:255',
                    'pattern_type' => 'required|in:username,password',
                    'sequence' => 'required|array|min:1',
                    'created_by' => 'nullable|string|max:255',
                ]);

                return response()->json([
                'success' => true,
                'message' => 'Validation passed',
                'data' => $validated
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
                ], 500);
            }
        }
        );    });


Route::get('/pppoe/generate-credentials', function (Request $request) {
    try {
        $pppoeService = new \App\Services\PppoeUsernameService();

        $customerData = [
            'first_name' => $request->input('first_name', 'John'),
            'middle_initial' => $request->input('middle_initial', 'D'),
            'last_name' => $request->input('last_name', 'Doe'),
            'mobile_number' => $request->input('mobile_number', '09123456789'),
            'tech_input_username' => $request->input('tech_input_username'),
            'custom_password' => $request->input('custom_password'),
        ];

        $username = $pppoeService->generateUsername($customerData);
        $password = $pppoeService->generatePassword($customerData);

        return response()->json([
        'success' => true,
        'username' => $username,
        'password' => $password,
        'customer_data' => $customerData,
        'patterns' => [
        'username_pattern' => \App\Models\PPPoEUsernamePattern::getUsernamePattern(),
        'password_pattern' => \App\Models\PPPoEUsernamePattern::getPasswordPattern(),
        ]
        ]);
    }
    catch (\Exception $e) {
        return response()->json([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
        ], 500);
    }
});

// DC Notice Management Routes
Route::prefix('dc-notices')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\DCNoticeApiController::class , 'destroy']);
});

// Overdue Management Routes
Route::prefix('overdues')->group(function () {
    Route::get('/', [\App\Http\Controllers\Api\OverdueApiController::class , 'index']);
    Route::post('/', [\App\Http\Controllers\Api\OverdueApiController::class , 'store']);
    Route::get('/statistics', [\App\Http\Controllers\Api\OverdueApiController::class , 'getStatistics']);
    Route::get('/{id}', [\App\Http\Controllers\Api\OverdueApiController::class , 'show']);
    Route::put('/{id}', [\App\Http\Controllers\Api\OverdueApiController::class , 'update']);
    Route::delete('/{id}', [\App\Http\Controllers\Api\OverdueApiController::class , 'destroy']);
});

// Debug endpoint for monitor routes
Route::get('/monitor/debug', function () {
    return response()->json([
    'status' => 'success',
    'message' => 'Monitor routes are working',
    'timestamp' => now(),
    'routes' => [
    'billing_status' => '/api/monitor/billing_status',
    'online_status' => '/api/monitor/online_status',
    'app_status' => '/api/monitor/app_status'
    ]
    ]);
});

// Live Monitor Routes - All methods use unified getData endpoint
Route::prefix('monitor')->group(function () {
    // Unified endpoint for all widget data
    Route::match (['GET', 'OPTIONS'], '/{action}', [MonitorController::class , 'getData']);

    // Template management
    Route::match (['GET', 'OPTIONS'], '/templates', [MonitorController::class , 'listTemplates']);
    Route::match (['POST', 'OPTIONS'], '/templates', [MonitorController::class , 'saveTemplate']);
    Route::match (['PUT', 'OPTIONS'], '/templates/{id}', [MonitorController::class , 'updateTemplate']);
    Route::match (['GET', 'OPTIONS'], '/templates/{id}', [MonitorController::class , 'loadTemplate']);
    Route::match (['DELETE', 'OPTIONS'], '/templates/{id}', [MonitorController::class , 'deleteTemplate']);
});

Route::get('/invoices/{id}', [RelatedDataController::class , 'getInvoiceById']);
Route::get('/payment-portal-logs/{id}', [RelatedDataController::class , 'getPaymentPortalLogById']);
Route::get('/lookup/payment-methods', [RelatedDataController::class , 'getPaymentMethods']);
Route::get('/lookup/transaction-types', [RelatedDataController::class , 'getDistinctTransactionTypes']);
Route::get('/lookup/customer-locations', [RelatedDataController::class , 'getDistinctCustomerLocations']);
Route::get('/lookup/payment-portal', [RelatedDataController::class , 'getPaymentPortalLookupData']);
Route::get('/lookup/job-orders', [RelatedDataController::class , 'getJobOrderLookupData']);
Route::get('/lookup/service-orders', [RelatedDataController::class , 'getServiceOrderLookupData']);
Route::get('/lookup/customers', [RelatedDataController::class , 'getCustomerLookupData']);
Route::get('/lookup/application-visits', [RelatedDataController::class , 'getApplicationVisitLookupData']);
Route::get('/lookup/work-orders', [RelatedDataController::class , 'getWorkOrderLookupData']);
Route::get('/lookup/invoices', [RelatedDataController::class , 'getInvoiceLookupData']);
Route::get('/lookup/statements', [RelatedDataController::class , 'getSOALookupData']);
Route::get('/transactions/{id}/details', [RelatedDataController::class , 'getTransactionById']);

Route::get('/invoices/by-account/{accountNo}', [RelatedDataController::class , 'getInvoicesByAccount']);
Route::get('/payment-portal-logs/by-account/{accountNo}', [RelatedDataController::class , 'getPaymentPortalLogsByAccount']);
Route::get('/transactions/by-account/{accountNo}', [RelatedDataController::class , 'getTransactionsByAccount']);
Route::get('/staggered-installations/by-account/{accountNo}', [RelatedDataController::class , 'getStaggeredByAccount']);
Route::get('/discounts/by-account/{accountNo}', [RelatedDataController::class , 'getDiscountsByAccount']);
Route::get('/service-orders/by-account/{accountNo}', [RelatedDataController::class , 'getServiceOrdersByAccount']);
Route::get('/job-orders/by-account/{accountNo}', [RelatedDataController::class , 'getJobOrdersByAccount']);
Route::get('/applications/by-account/{accountNo}', [RelatedDataController::class , 'getApplicationsByAccount']);

// Service Order Items Routes
Route::get('/service-order-items/{serviceOrderId}', [ServiceOrderItemApiController::class, 'getByServiceOrderId']);
Route::put('/service-order-items/{serviceOrderId}', [ServiceOrderItemApiController::class, 'updateByServiceOrderId']);
Route::apiResource('service-order-items', ServiceOrderItemApiController::class)->except(['show', 'update']);
Route::get('/service-order-items/item/{id}', [ServiceOrderItemApiController::class, 'show']);
Route::put('/service-order-items/item/{id}', [ServiceOrderItemApiController::class, 'update']);
Route::get('/reconnection-logs/by-account/{accountNo}', [RelatedDataController::class , 'getReconnectionLogsByAccount']);
Route::get('/disconnected-logs/by-account/{accountNo}', [RelatedDataController::class , 'getDisconnectedLogsByAccount']);
Route::get('/details-update-logs/by-account/{accountNo}', [RelatedDataController::class , 'getDetailsUpdateLogsByAccount']);
Route::get('/audit-trail-logs/by-application/{applicationId}', [RelatedDataController::class , 'getAuditTrailLogsByApplication']);
Route::get('/audit-trail-logs/by-job-order/{jobOrderId}', [RelatedDataController::class , 'getAuditTrailLogsByJobOrder']);
Route::get('/details-update-logs/by-service-order/{serviceOrderId}', [RelatedDataController::class , 'getDetailsUpdateLogsByServiceOrder']);

Route::get('/plan-change-logs/by-account/{accountNo}', [RelatedDataController::class , 'getPlanChangeLogsByAccount']);
Route::get('/service-charge-logs/by-account/{accountNo}', [RelatedDataController::class , 'getServiceChargeLogsByAccount']);
Route::get('/change-due-logs/by-account/{accountNo}', [RelatedDataController::class , 'getChangeDueLogsByAccount']);
Route::get('/security-deposits/by-account/{accountNo}', [RelatedDataController::class , 'getSecurityDepositsByAccount']);
Route::get('/statement-of-accounts/by-account/{accountNo}', [RelatedDataController::class , 'getStatementOfAccountsByAccount']);

// SOA PDF Generation Route
Route::post('/soa/{id}/generate-pdf', function ($id) {
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

        $account = $soa->billingAccount;

        if (!$account) {
            return response()->json([
                'success' => false,
                'message' => 'Billing account not found for this SOA'
            ], 404);
        }

        $pdfService = app(\App\Services\GoogleDrivePdfGenerationService::class);

        // Debug: Log the SOA data before PDF generation
        \Illuminate\Support\Facades\Log::info('SOA PDF generation - SOA data', [
            'soa_id' => $soa->id,
            'account_no' => $soa->account_no,
            'due_date_raw' => $soa->getRawOriginal('due_date'),
            'due_date_cast' => $soa->due_date,
            'balance_from_previous_bill_raw' => $soa->getRawOriginal('balance_from_previous_bill'),
            'balance_from_previous_bill_cast' => $soa->balance_from_previous_bill,
            'statement_date_raw' => $soa->getRawOriginal('statement_date'),
            'monthly_service_fee' => $soa->monthly_service_fee,
            'total_amount_due' => $soa->total_amount_due,
            'amount_due' => $soa->amount_due,
            'vat' => $soa->vat,
            'account_customer' => $account->customer ? $account->customer->full_name : 'NO CUSTOMER',
        ]);

        $result = $pdfService->generateBillingPdf($account, null, $soa);

        if ($result['success']) {
            // Update print_link using direct DB update for reliability
            $updated = \Illuminate\Support\Facades\DB::table('statement_of_accounts')
                ->where('id', $id)
                ->update([
                    'print_link' => $result['url'],
                    'updated_at' => now()
                ]);

            \Illuminate\Support\Facades\Log::info('SOA print_link update result', [
                'soa_id' => $id,
                'print_link' => $result['url'],
                'rows_updated' => $updated
            ]);

            return response()->json([
                'success' => true,
                'message' => 'SOA PDF generated and saved to Google Drive',
                'print_link' => $result['url']
            ]);
        } else {
            return response()->json([
                'success' => false,
                'message' => 'Failed to generate PDF',
                'error' => $result['error'] ?? 'Unknown error'
            ], 500);
        }
    } catch (\Exception $e) {
        \Illuminate\Support\Facades\Log::error('SOA PDF generation failed', [
            'soa_id' => $id,
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Failed to generate SOA PDF',
            'error' => $e->getMessage()
        ], 500);
    }
});

// Inventory Related Data Routes
Route::get('/inventory-logs/by-item/{itemId}', [InventoryRelatedDataController::class , 'getInventoryLogsByItem']);
Route::get('/borrowed-logs/by-item/{itemId}', [InventoryRelatedDataController::class , 'getBorrowedLogsByItem']);
Route::get('/defective-logs/by-item/{itemId}', [InventoryRelatedDataController::class , 'getDefectiveLogsByItem']);
Route::get('/job-orders/by-item/{itemId}', [InventoryRelatedDataController::class , 'getJobOrdersByItem']);
Route::get('/service-orders/by-item/{itemId}', [InventoryRelatedDataController::class , 'getServiceOrdersByItem']);

// Cron Test Routes (for manual testing via URL)
Route::prefix('cron-test')->group(function () {
    Route::get('/process-overdue-notifications', [\App\Http\Controllers\CronTestController::class , 'processOverdueNotifications']);
    Route::get('/process-disconnection-notices', [\App\Http\Controllers\CronTestController::class , 'processDisconnectionNotices']);
    Route::get('/test-logging', [\App\Http\Controllers\CronTestController::class , 'testLogging']);
    Route::get('/clear-cache', function () {
            try {
                \Illuminate\Support\Facades\Artisan::call('config:clear');
                \Illuminate\Support\Facades\Artisan::call('cache:clear');
                \Illuminate\Support\Facades\Artisan::call('route:clear');
                \Illuminate\Support\Facades\Artisan::call('view:clear');
                return response()->json([
                'success' => true,
                'message' => 'All caches cleared successfully'
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Cache clear failed',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );
        Route::get('/run-migrations', function () {
            try {
                \Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
                return response()->json([
                'success' => true,
                'message' => 'Migrations completed successfully',
                'output' => \Illuminate\Support\Facades\Artisan::output()
                ]);
            }
            catch (\Exception $e) {
                return response()->json([
                'success' => false,
                'message' => 'Migration failed',
                'error' => $e->getMessage()
                ], 500);
            }
        }
        );    });

/*
|--------------------------------------------------------------------------
| SmartOLT Tool — reconciliation, optical crawl, alignment and cleanup
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->prefix('smartolt-reconciliation')->group(function () {
    Route::get('/state', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'state']);
    Route::get('/mac-discovery', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'macDiscovery']);
    // Deprecated alias of /mac-discovery, kept so a deployed frontend on the old
    // path keeps working. The crawl no longer reads optical power.
    Route::get('/optical-power', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'opticalPower']);
    Route::get('/alignment-preview', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'alignmentPreview']);
    Route::get('/mac-alignment', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'macAlignment']);
    Route::get('/sn-alignment', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'snAlignment']);
    Route::get('/profile-preview', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'profilePreview']);
    Route::get('/cleanup-preview', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'cleanupPreview']);
    // Progress polling. Jobs are advanced by `cron:tool-jobs-drain`, so these are
    // plain reads — the tool watches a sweep rather than driving it, and a closed
    // tab costs nothing. `active-job` lets the page reattach without a remembered id.
    Route::get('/job-status', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'jobStatus']);
    Route::get('/active-job', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'activeJob']);
    Route::get('/logs', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'logs']);
    Route::get('/export', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'export']);

    Route::post('/start-job', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'startJob']);
    Route::post('/process-job', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'processJob']);
    Route::post('/abort-job', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'abortJob']);
    Route::post('/undo', [\App\Http\Controllers\Api\SmartOltReconciliationController::class, 'undo']);
});


/*
|--------------------------------------------------------------------------
| MikroTik RADIUS Tool — reconciliation between the User Manager and billing
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->prefix('radius-reconciliation')->group(function () {
    Route::get('/servers', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'servers']);
    // The tool opens on /snapshot (cached, no device contact); /data is the
    // explicit "Sync & Reconcile Now" action and is the only read that goes to
    // hardware. Keeping them separate is what stops a page load sweeping the estate.
    Route::get('/snapshot', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'snapshot']);
    Route::get('/data', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'data']);
    Route::get('/logs', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'logs']);
    Route::get('/export', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'export']);

    Route::post('/sync-password', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'syncPassword']);
    Route::post('/sync-group-mikrotik', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'syncGroupMikrotik']);
    Route::post('/sync-group-billing', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'syncGroupBilling']);
    Route::post('/restrict', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'restrict']);
    Route::post('/disconnect', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'disconnect']);
    Route::post('/add-user', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'addUser']);
    Route::post('/delete-user', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'deleteUser']);
    Route::post('/resolve-duplicate', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'resolveDuplicate']);
    Route::post('/bulk', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'bulk']);
    Route::post('/undo', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'undo']);

    // Aliases. Same handlers, alternative names, so an integration written against
    // the generic verbs works without the specific ones being renamed out from
    // under the shipped UI.
    //
    // /update-group maps to the Mikrotik direction deliberately: "update the group
    // to match the DB plan" is the push. The opposite direction — adopting the
    // device's group as the plan — stays on /sync-group-billing, because the two
    // change different systems and must never be reachable through one ambiguous
    // endpoint.
    Route::post('/update-credentials', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'syncPassword']);
    Route::post('/update-group', [\App\Http\Controllers\Api\RadiusReconciliationController::class, 'syncGroupMikrotik']);
});

/*
|--------------------------------------------------------------------------
| Xendit Reconciliation Tool — operator surface over pending payments
|--------------------------------------------------------------------------
|
| These endpoints read and settle real money against real subscriber
| accounts, so every one of them sits behind Sanctum and is scoped to the
| caller's organization unless they are SuperAdmin.
|
| Posting still happens in exactly one place. /force-post hands the row to
| PaymentWorkerService::postPayment(), whose lockForUpdate() claim is what
| prevents a payment being credited twice — there is no second posting path
| here and no transaction wrapped around a gateway call.
|
*/
/*
|--------------------------------------------------------------------------
| Billing Reconcile tool
|--------------------------------------------------------------------------
|
| Why an account that should have been billed this cycle has no invoice, and the
| ability to raise it by hand once the reason is fixed. The audit is read-only;
| generation goes through the same generator the nightly cron uses and is safe to
| repeat, because the per-cycle guards make a second run a skip.
|
*/
Route::middleware('auth:sanctum')->prefix('billing-reconciliation')->group(function () {
    Route::get('/audit', [\App\Http\Controllers\Api\BillingReconciliationController::class, 'audit']);
    Route::get('/reasons', [\App\Http\Controllers\Api\BillingReconciliationController::class, 'reasons']);

    Route::post('/generate', [\App\Http\Controllers\Api\BillingReconciliationController::class, 'generate']);
    Route::post('/dismiss', [\App\Http\Controllers\Api\BillingReconciliationController::class, 'dismiss']);
    Route::post('/restore', [\App\Http\Controllers\Api\BillingReconciliationController::class, 'restore']);
});

Route::middleware('auth:sanctum')->prefix('xendit-reconciliation')->group(function () {
    Route::get('/audit', [\App\Http\Controllers\Api\XenditPaymentController::class, 'reconciliationAudit']);

    Route::post('/verify', [\App\Http\Controllers\Api\XenditPaymentController::class, 'reconciliationVerify']);
    Route::post('/force-post', [\App\Http\Controllers\Api\XenditPaymentController::class, 'reconciliationForcePost']);
    Route::post('/mark-expired', [\App\Http\Controllers\Api\XenditPaymentController::class, 'reconciliationMarkExpired']);
});
