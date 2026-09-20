<?php

namespace App\Http\Controllers;

use App\Models\AgentInvoice;
use App\Models\AgentInvoiceCustomer;
use App\Models\JobOrder;
use App\Models\AgentCommissionHistory;
use App\Models\AgentAchievementClaim;
use App\Models\AgentAchievementPeriod;
use App\Models\AgentBonusHistory;
use App\Models\AgentBalance;
use App\Models\BillingConfig;
use App\Models\User;
use App\Models\AuditTrailLog;
use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Carbon\Carbon;

class CommissionController extends Controller
{
    public function index(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized'
                ], 401);
            }

            $agentId = $request->input('agent_id');
            $userRole = strtolower($user->role->role_name ?? '');

            // Non-admins can only see their own history
            if (!in_array($userRole, self::ADMIN_ROLES, true)) {
                $agentId = $user->id;
            }

            $limit = $request->input('limit', 2000);
            $offset = $request->input('offset', 0);
            $updatedAfter = $request->input('updated_after');

            $query = AgentCommissionHistory::with('agent');

            if ($agentId) {
                $query->where('agent_id', $agentId);
            }

            if ($updatedAfter) {
                $query->where('updated_at', '>=', $updatedAfter);
            }

            $type = $request->input('type');
            if ($type) {
                if ($type === 'commission') {
                    $query->where(function($q) {
                        $q->where('type', 'commission')
                          ->orWhereNull('type');
                    });
                } else {
                    $query->where('type', $type);
                }
            }

            $total = $query->count();

            $history = $query->orderBy('created_at', 'desc')
                ->offset($offset)
                ->limit($limit)
                ->get();

            // Transform data for the frontend
            $data = $history->map(function ($item) {
                return [
                    'id' => 'JO-' . str_pad($item->id, 5, '0', STR_PAD_LEFT),
                    'customer' => $item->agent ? ($item->agent->full_name ?? ($item->agent->first_name . ' ' . $item->agent->last_name)) : 'Unknown',
                    'service' => 'Payout (Ref: ' . $item->ref_number . ')',
                    'date' => $item->created_at ? date('M d, Y', strtotime($item->created_at)) : null,
                    // The record's real approval state. This was hardcoded to
                    // 'Paid', so a Pending payout — one that has moved no money
                    // at all — was reported to the client as settled. Rows
                    // written before approvals existed are already applied,
                    // hence the Approved default, matching getHistory().
                    'status' => $item->status ?? self::STATUS_APPROVED,
                    'amount' => '₱' . number_format($item->total_amount, 2),
                    'commission_id_list' => $item->commission_id_list,
                    'type' => $item->type
                ];
            });

            // Calculate totals.
            //
            // "total" counts only what has actually been approved, and "pending"
            // is the figure still awaiting sign-off. `pending` used to be a
            // hardcoded zero and `total` counted rejected and pending records
            // alike, so the two tiles could not be reconciled with the list
            // beneath them.
            $isApproved = fn ($item) => ($item->status ?? self::STATUS_APPROVED) === self::STATUS_APPROVED;
            $isPending  = fn ($item) => ($item->status ?? self::STATUS_APPROVED) === self::STATUS_PENDING;

            $approved = $history->filter($isApproved);

            $totalCommission = $approved->sum('total_amount');
            $pendingCommission = $history->filter($isPending)->sum('total_amount');
            $thisMonthCommission = $approved
                ->whereBetween('created_at', [now()->startOfMonth(), now()->endOfMonth()])
                ->sum('total_amount');

            return response()->json([
                'success' => true,
                'data' => $data,
                'stats' => [
                    'total' => '₱' . number_format($totalCommission, 2),
                    'pending' => '₱' . number_format($pendingCommission, 2),
                    'thisMonth' => '₱' . number_format($thisMonthCommission, 2),
                    'totalCount' => $total,
                    'user_name' => $user->full_name ?? ($user->first_name . ' ' . $user->last_name),
                    'user_created_at' => $user->created_at ? $user->created_at->format('M d, Y') : null
                ],
                'total' => $total
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch commissions',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getHistory(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $agentId = $request->input('agent_id');
            $userRole = strtolower($user->role->role_name ?? '');

            // Non-admins can only see their own history
            if (!in_array($userRole, self::ADMIN_ROLES, true)) {
                $agentId = $user->id;
            }

            $limit = $request->input('limit', 2000);
            $offset = $request->input('offset', 0);
            $updatedAfter = $request->input('updated_after');

            $query = AgentCommissionHistory::with('agent');

            if ($agentId) {
                $query->where('agent_id', $agentId);
            }

            if ($updatedAfter) {
                $query->where('updated_at', '>=', $updatedAfter);
            }

            $type = $request->input('type');
            if ($type) {
                if ($type === 'commission') {
                    $query->where(function($q) {
                        $q->where('type', 'commission')
                          ->orWhereNull('type');
                    });
                } elseif ($type === 'incentives') {
                    $query->whereIn('type', ['incentives', 'incentives_payout']);
                } else {
                    $query->where('type', $type);
                }
            }
            
            $total = $query->count();

            $history = $query->orderBy('created_at', 'desc')
                ->offset($offset)
                ->limit($limit)
                ->get();

            $data = $history->map(function($item) {
                return [
                    'id' => $item->id,
                    'ref_number' => $item->ref_number,
                    'total_amount' => $item->total_amount,
                    'created_by' => $item->created_by,
                    'created_at' => $item->created_at,
                    'remarks' => $item->remarks,
                    'proof_of_payment' => $item->proof_of_payment,
                    'agent_id' => $item->agent_id,
                    'agent_name' => $item->agent ? ($item->agent->full_name ?? ($item->agent->first_name . ' ' . $item->agent->last_name)) : 'Unknown',
                    'commission_id_list' => $item->commission_id_list,
                    'updated_by' => $item->updated_by,
                    'updated_at' => $item->updated_at,
                    // Response key stays `approved_by` (the frontend type), but the
                    // underlying column is `approve_by`.
                    'approved_by' => $item->approve_by,
                    // Approval state, matching transactions. Rows written before
                    // approvals existed are already applied, hence Approved.
                    'status' => $item->status ?? self::STATUS_APPROVED,
                    'type' => $item->type
                ];
            });

            // Include the agent's current balance totals so the dashboard can display them.
            $agentBalance = $agentId ? AgentBalance::where('agent_id', $agentId)->first() : null;

            return response()->json([
                'success' => true,
                'data' => $data,
                'total' => $total,
                'balance' => $agentBalance ? (float)$agentBalance->balance : 0,
                // What the agent has earned in commission from approved job
                // orders. Its own bucket, so the payout screens can cap a
                // commission cash-out against it.
                'commission_value' => $agentBalance ? (float)($agentBalance->commission_value ?? 0) : 0,
                'incentives' => $agentBalance ? (float)$agentBalance->incentives : 0,
                'bonus' => $agentBalance ? (float)($agentBalance->bonus ?? 0) : 0,
                'achievement' => $agentBalance ? (float)($agentBalance->achievement ?? 0) : 0,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch payout history',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function storeHistory(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            // A payout raised from an agent invoice carries only the agent and
            // the invoice number: the operator is recording that the invoice was
            // settled, not entering a payment by hand. The amount, type, proof
            // and remarks are not asked for and so cannot be required.
            //
            // Everything else still is. agent_id and ref_number identify the
            // record and are what make it traceable back to the invoice, so
            // neither is relaxed.
            $fromInvoice = $request->boolean('from_invoice');

            $optional = $fromInvoice ? 'nullable' : 'required';

            $validated = $request->validate([
                'agent_id'      => 'required|integer',
                'ref_number'    => 'required|string|max:100',
                'total_amount'  => $optional . '|numeric|min:0',
                'remarks'       => $optional . '|string',
                'proof_of_payment' => $optional . '|string',
                'job_order_ids' => 'nullable|array',
                'job_order_ids.*' => 'integer',
                // Refused rather than guessed at. applyCommissionMovement()
                // falls through to a COMMISSION debit for anything it does not
                // recognise, so a typo used to take money out of the wrong
                // bucket silently and irreversibly.
                'type'          => ['nullable', 'string', 'max:50', Rule::in(self::PAYOUT_TYPES)],
                'from_invoice'  => 'nullable|boolean',
            ]);

            $jobOrderIds = $validated['job_order_ids'] ?? [];
            unset($validated['job_order_ids'], $validated['from_invoice']);

            $validated['type'] = $validated['type'] ?? 'commission';

            // The columns are written either way, so an omitted field becomes an
            // explicit zero or empty string rather than a NULL the reports would
            // have to special-case.
            if ($fromInvoice) {
                // An amount that was not given is taken FROM THE INVOICE, not
                // defaulted to zero.
                //
                // Zero was what it used to be, and it made the settlement
                // cosmetic: approving it marked the invoice Paid but moved
                // nothing off the agent's balance, so the very same entitlement
                // was still sitting there and could be — and was — paid a second
                // time through the payout screen. The invoice says what is owed;
                // paying it should draw exactly that.
                $named = AgentInvoice::where('invoice_number', trim((string) $validated['ref_number']))->first();

                $validated['total_amount']     = $validated['total_amount'] ?? ($named->subtotal ?? 0);
                $validated['remarks']          = $validated['remarks'] ?? '';
                $validated['proof_of_payment'] = $validated['proof_of_payment'] ?? '';
            }
            
            $customerNamesStr = null;
            if (!empty($jobOrderIds)) {
                $jobOrdersForNames = JobOrder::whereIn('id', $jobOrderIds)->with('application')->get();
                $names = $jobOrdersForNames->map(function($jo) {
                    return $jo->application ? $jo->application->full_name : 'Unknown Customer';
                })->toArray();
                $customerNamesStr = implode(',', $names);
            }
            
            $validated['commission_id_list'] = $customerNamesStr;
            $validated['created_by'] = $this->creatorIdentity($user);
            $validated['organization_id'] = $user->organization_id ?? null;

            // Recorded as Pending, exactly like a transaction. Nothing is applied
            // to the agent's balance and no job order is marked paid until an
            // approver accepts it — see approveHistory().
            $validated['status'] = self::STATUS_PENDING;

            // The job orders this payout covers are stored so approval can mark
            // them paid later. Re-deriving the set at approval time would risk
            // covering a different set of referrals than the amount was based on.
            $validated['job_order_ids'] = $jobOrderIds ? json_encode(array_values($jobOrderIds)) : null;

            $history = AgentCommissionHistory::create($validated);

            // Audit Trail Log
            $userEmail = $user->email_address ?? $user->email ?? 'System';
            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type' => 'agent_commission_histories',
                    'id' => $history->id,
                    'data' => $history->toArray()
                ],
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            // Nothing else happens yet. The agent's balance is untouched and the
            // job orders stay unpaid until this payout is approved, so a payout
            // that is never approved leaves no trace on the agent's money.

            return response()->json([
                'success' => true,
                'message' => $this->pendingMessageFor($validated['type']),
                'data'    => $history,
                'status'  => self::STATUS_PENDING,
                'requires_approval'  => true,
                'updated_job_orders' => 0,
                'pending_job_orders' => count($jobOrderIds),
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            // ValidationException extends \Exception, so without this it would be
            // swallowed below and reported as a 500 with no field errors.
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors'  => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to record commission payment',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * List bonus payout history from the dedicated agent_bonus_history table.
     */
    public function getBonusHistory(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $agentId = $request->input('agent_id');
            $userRole = strtolower($user->role->role_name ?? '');

            // Non-admins can only see their own history
            if (!in_array($userRole, self::ADMIN_ROLES, true)) {
                $agentId = $user->id;
            }

            $limit = $request->input('limit', 2000);
            $offset = $request->input('offset', 0);
            $updatedAfter = $request->input('updated_after');

            $query = AgentBonusHistory::with('agent');

            if ($agentId) {
                $query->where('agent_id', $agentId);
            }

            if ($updatedAfter) {
                $query->where(function ($q) use ($updatedAfter) {
                    $q->where('updated_at', '>=', $updatedAfter)
                      ->orWhere('created_at', '>=', $updatedAfter);
                });
            }

            $total = $query->count();

            $history = $query->orderBy('created_at', 'desc')
                ->offset($offset)
                ->limit($limit)
                ->get();

            $data = $history->map(function ($item) {
                return [
                    'id' => $item->id,
                    'ref_number' => $item->ref_number,
                    'total_amount' => $item->total_amount,
                    'created_by' => $item->created_by,
                    'created_at' => $item->created_at,
                    'remarks' => $item->remarks,
                    'proof_of_payment' => $item->proof_of_payment,
                    'agent_id' => $item->agent_id,
                    'agent_name' => $item->agent ? ($item->agent->full_name ?? ($item->agent->first_name . ' ' . $item->agent->last_name)) : 'Unknown',
                    'updated_by' => $item->updated_by,
                    'updated_at' => $item->updated_at,
                    'approve_by' => $item->approve_by,
                    // Kept under both spellings so the payout screens can read the
                    // approver the same way for commission and bonus records.
                    'approved_by' => $item->approve_by,
                    'status' => $item->status ?? self::STATUS_APPROVED,
                    'type' => $item->type,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $data,
                'total' => $total
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch bonus history',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Record a bonus transaction (add or payout) in agent_bonus_history and
     * adjust the agent's bonus balance accordingly.
     */
    public function storeBonusHistory(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $validated = $request->validate([
                'agent_id'         => 'required|integer',
                'ref_number'       => 'required|string|max:100',
                'total_amount'     => 'required|numeric|min:0',
                'remarks'          => 'required|string',
                'proof_of_payment' => 'required|string',
                'type'             => 'nullable|string|max:50',
            ]);

            $validated['type'] = $validated['type'] ?? 'Bonus_payout';
            $validated['created_by'] = $this->creatorIdentity($user);
            $validated['organization_id'] = $user->organization_id ?? null;

            // Recorded as Pending, exactly like a transaction. The agent's bonus
            // figure is untouched until an approver accepts it — see approveBonus().
            $validated['status'] = self::STATUS_PENDING;

            $history = AgentBonusHistory::create($validated);

            // Audit Trail Log
            $userEmail = $user->email_address ?? $user->email ?? 'System';
            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type' => 'agent_bonus_histories',
                    'id' => $history->id,
                    'data' => $history->toArray()
                ],
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            // The bonus figure is not moved here. It moves when the record is
            // approved, so an unapproved bonus never affects the agent's money.

            return response()->json([
                'success' => true,
                'message' => $validated['type'] === 'Bonus'
                    ? 'Bonus submitted successfully. It requires approval before the agent\'s bonus is updated.'
                    : 'Bonus payout submitted successfully. It requires approval before the agent\'s bonus is updated.',
                'data'    => $history,
                'status'  => self::STATUS_PENDING,
                'requires_approval' => true,
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors'  => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to record bonus transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getTrend(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $fullName = $user->full_name;
            $filter = $request->input('filter', 'monthly');

            $billingConfig = BillingConfig::first();
            $commissionValue = $billingConfig ? $billingConfig->agent_commission : 0;

            $query = JobOrder::whereHas('application', function($q) use ($user) {
                $fn1 = strtolower(trim($user->first_name . ' ' . $user->last_name));
                $fn2 = strtolower(trim($user->full_name));
                $email = strtolower(trim($user->email_address ?? ''));

                // The id form is an exact value, not a fragment of a name, so it
                // is matched as one — a referral made through the picker holds
                // "agent:37" and contains none of the words the LIKEs look for.
                $tagged = \App\Support\AgentReferral::encode($user->id ?? null);

                $q->where(function($sq) use ($fn1, $fn2, $email, $tagged) {
                    $sq->where(DB::raw('LOWER(referred_by)'), 'LIKE', '%' . $fn1 . '%')
                       ->orWhere(DB::raw('LOWER(referred_by)'), 'LIKE', '%' . $fn2 . '%');

                    if ($tagged !== null) {
                        $sq->orWhere('referred_by', $tagged);
                    }

                    if ($email) {
                        $sq->orWhere(DB::raw('LOWER(referred_by)'), 'LIKE', '%' . $email . '%');
                    }
                });
            })
            ->where(function($q) {
                $q->where(DB::raw('LOWER(onsite_status)'), 'done')
                  ->orWhere(DB::raw('LOWER(onsite_status)'), 'completed');
            });

            $dateExpr = 'COALESCE(job_orders.date_installed, job_orders.timestamp, job_orders.created_at)';

            $now = Carbon::now();
            $data = [];
            $labels = [];

            if ($filter === 'monthly') {
                for ($i = 3; $i >= 0; $i--) {
                    $start = $now->copy()->subWeeks($i)->startOfWeek();
                    $end = $now->copy()->subWeeks($i)->endOfWeek();
                    $count = (clone $query)->whereBetween(DB::raw($dateExpr), [$start, $end])->count();
                    $data[] = (float)($count * $commissionValue);
                    $labels[] = 'Week ' . (4 - $i);
                }
            } else if ($filter === '3months') {
                for ($i = 2; $i >= 0; $i--) {
                    $date = $now->copy()->subMonths($i);
                    $start = $date->copy()->startOfMonth();
                    $end = $date->copy()->endOfMonth();
                    $count = (clone $query)->whereBetween(DB::raw($dateExpr), [$start, $end])->count();
                    $data[] = (float)($count * $commissionValue);
                    $labels[] = $date->format('M');
                }
            } else if ($filter === 'yearly') {
                for ($i = 1; $i <= 12; $i++) {
                    $date = $now->copy()->month($i)->startOfMonth();
                    $count = (clone $query)->whereYear(DB::raw($dateExpr), $now->year)
                        ->whereMonth(DB::raw($dateExpr), $i)
                        ->count();
                    $data[] = (float)($count * $commissionValue);
                    $labels[] = $date->format('M');
                }
            } else if ($filter === '5years') {
                for ($i = 4; $i >= 0; $i--) {
                    $year = $now->year - $i;
                    $count = (clone $query)->whereYear(DB::raw($dateExpr), $year)->count();
                    $data[] = (float)($count * $commissionValue);
                    $labels[] = (string)$year;
                }
            }

            $totalCount = (clone $query)->count();
            $totalCommission = (float)($totalCount * $commissionValue);

            return response()->json([
                'success' => true,
                'data' => [
                    'points' => $data,
                    'labels' => $labels,
                    'summary' => [
                        'total_count' => $totalCount,
                        'total_commission' => $totalCommission,
                        'commission_rate' => $commissionValue
                    ]
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch commission trend',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get job orders referred by a specific agent name, plus the agent's commission rate.
     * Used by the payout modal to auto-populate job order list and total amount.
     */
    public function getJobOrdersByAgent(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $agentId   = $request->input('agent_id');
            $agentName = trim($request->input('agent_name', ''));
            $startDate = $request->input('start_date');
            $endDate   = $request->input('end_date');

            if (!$agentId && !$agentName) {
                return response()->json(['success' => false, 'message' => 'agent_id or agent_name is required'], 422);
            }

            // Resolve commission rate from agent_balance
            $commissionRate = 0;
            if ($agentId) {
                $balance = AgentBalance::where('agent_id', $agentId)->first();
                $commissionRate = $balance ? (float)$balance->commission : 0;
            }

            // Build name variants to match against referred_by
            $nameVariants = [];
            if ($agentName) {
                $nameVariants[] = strtolower($agentName);
            }
            if ($agentId) {
                $agent = User::find($agentId);
                if ($agent) {
                    $nameVariants[] = strtolower(trim($agent->first_name . ' ' . $agent->last_name));
                    if ($agent->full_name) {
                        $nameVariants[] = strtolower(trim($agent->full_name));
                    }
                }
            }
            $nameVariants = array_unique(array_filter($nameVariants));

            // Referrals made through the picker are stored as the agent's user
            // id, so this request can settle them even when it was given only an
            // id and no name at all.
            $tagged = \App\Support\AgentReferral::encode($agentId);

            if (empty($nameVariants) && $tagged === null) {
                return response()->json([
                    'success' => true,
                    'data' => ['job_order_ids' => [], 'commission_rate' => $commissionRate, 'total_amount' => 0]
                ]);
            }

            // Query job orders via application's referred_by
            $query = JobOrder::whereHas('application', function ($q) use ($nameVariants, $tagged) {
                $q->where(function ($sq) use ($nameVariants, $tagged) {
                    if ($tagged !== null) {
                        $sq->orWhere('referred_by', $tagged);
                    }
                    foreach ($nameVariants as $name) {
                        $sq->orWhere(DB::raw('LOWER(referred_by)'), 'LIKE', '%' . $name . '%');
                    }
                });
            })
            ->where(DB::raw('LOWER(onsite_status)'), 'done')
            ->where(function ($q) {
                $q->whereNull('commission_status')
                  ->orWhere(DB::raw('LOWER(commission_status)'), '!=', 'paid');
            });

            if ($startDate) {
                $query->whereDate('date_installed', '>=', $startDate);
            }
            if ($endDate) {
                $query->whereDate('date_installed', '<=', $endDate);
            }

            $query->with('application')
            ->orderBy('id', 'asc');

            $jobOrders = $query->get(['id', 'application_id']);
            $ids = $jobOrders->pluck('id')->toArray();
            $jobOrdersData = $jobOrders->map(function($jo) {
                return [
                    'id' => $jo->id,
                    'customer_name' => $jo->application ? $jo->application->full_name : 'Unknown Customer'
                ];
            });
            $count = count($ids);
            $totalAmount = $count * $commissionRate;

            return response()->json([
                'success' => true,
                'data' => [
                    'job_order_ids'   => $ids,
                    'job_orders_data' => $jobOrdersData,
                    'commission_rate' => $commissionRate,
                    'total_amount'    => $totalAmount,
                    'count'           => $count,
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch agent job orders',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * List the auto-awarded quota incentives from agent_incentive_history.
     *
     * This is the data the AgentIncentiveService cron writes — one row per
     * Job Order that contributed toward a quota incentive award. Used by the
     * "Incentives History" tab on the frontend.
     */
    public function getIncentiveHistory(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized'
                ], 401);
            }

            $agentId   = $request->input('agent_id');
            $userRole  = strtolower($user->role->role_name ?? '');

            // Non-admins can only see their own incentive history.
            if (!in_array($userRole, self::ADMIN_ROLES, true)) {
                $agentId = $user->id;
            }

            $limit        = (int) $request->input('limit', 2000);
            $offset       = (int) $request->input('offset', 0);
            $updatedAfter = $request->input('updated_after');

            $base = DB::table('agent_incentive_history as aih')
                ->leftJoin('users as u', 'aih.agent_id', '=', 'u.id')
                // Left join, because most rows are legitimately unbilled: the
                // quota has been earned and is waiting for the invoice run that
                // covers the week it was awarded in.
                ->leftJoin('agent_invoices as ai', 'aih.agent_invoice_id', '=', 'ai.id');

            if ($agentId) {
                $base->where('aih.agent_id', $agentId);
            }

            if ($updatedAfter) {
                $base->where('aih.updated_at', '>=', $updatedAfter);
            }

            $total = (clone $base)->count();

            $rows = (clone $base)
                ->select(
                    'aih.id',
                    'aih.agent_id',
                    'aih.job_order_id',
                    'aih.quota_reached',
                    'aih.batch_number',
                    'aih.incentive_value',
                    'aih.organization_id',
                    'aih.processed_at',
                    // Whether this completed quota has been paid out on a weekly
                    // invoice yet, and on which one. NULL means earned and still
                    // waiting for the invoice run whose billing week contains
                    // `processed_at` — which is what makes a double payout
                    // visible from this list rather than only from the invoice.
                    'aih.agent_invoice_id',
                    'aih.invoiced_at',
                    'ai.invoice_number',
                    'aih.created_at',
                    'aih.updated_at',
                    DB::raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as agent_name")
                )
                ->orderBy('aih.processed_at', 'desc')
                ->orderBy('aih.id', 'desc')
                ->offset($offset)
                ->limit($limit)
                ->get();

            $data = $rows->map(function ($r) {
                return [
                    'id'              => $r->id,
                    'agent_id'        => $r->agent_id,
                    'agent_name'      => ($r->agent_name !== null && trim($r->agent_name) !== '') ? trim($r->agent_name) : 'Unknown',
                    'job_order_id'    => $r->job_order_id,
                    'quota_reached'   => $r->quota_reached,
                    'batch_number'    => $r->batch_number,
                    'incentive_value' => $r->incentive_value,
                    'organization_id' => $r->organization_id,
                    'processed_at'    => $r->processed_at,
                    'agent_invoice_id' => $r->agent_invoice_id,
                    'invoice_number'   => $r->invoice_number,
                    'invoiced_at'      => $r->invoiced_at,
                    'is_invoiced'      => $r->agent_invoice_id !== null,
                    'created_at'      => $r->created_at,
                    'updated_at'      => $r->updated_at,
                ];
            });

            return response()->json([
                'success' => true,
                'data'    => $data,
                'total'   => $total,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch incentive history',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Onboarded-referral milestone size and the reward paid out for reaching one.
     * Kept server side so the reward can never be dictated by the client.
     */
    /**
     * Retired: the single lifetime "30 onboards" milestone, replaced by the
     * weekly and monthly tiers in config/achievements.php. Kept only so claims
     * already recorded under it remain readable; nothing awards it any more.
     */
    private const ACHIEVEMENT_TARGET = 30;
    private const ACHIEVEMENT_REWARD = 1500.00;

    /**
     * Approval states, matching the vocabulary transactions use.
     *
     * A payout is recorded as Pending and has no effect on the agent's money.
     * Approving it applies the movement; rejecting it closes the record without
     * ever touching a balance. Only a Pending payout can be acted on, so an
     * approval can never be applied twice.
     */
    public const STATUS_PENDING  = 'Pending';
    public const STATUS_APPROVED = 'Approved';
    public const STATUS_REJECTED = 'Rejected';

    /**
     * Every movement `applyCommissionMovement()` knows how to apply.
     *
     * Anything outside this list is refused at validation. The method's final
     * `else` treats an unrecognised type as a commission debit, which is a
     * sensible default for a legacy row but a silent, unrecoverable mistake for
     * a request that simply misspelled one.
     *
     * 'achievement' is written by storeAchievement(), never posted by a client,
     * but is listed so a record of that type can still be re-stated at approval.
     */
    public const PAYOUT_TYPES = [
        'commission',
        'incentives',
        'incentives_payout',
        'Bonus',
        'Bonus_payout',
        'balance',
        'all',
        'achievement',
    ];

    /** Message shown when a payout has been recorded and is awaiting approval. */
    private function pendingMessageFor(?string $type): string
    {
        $subject = match ($type) {
            'incentives'        => 'Incentive',
            'incentives_payout' => 'Incentive payout',
            'Bonus'             => 'Bonus',
            'Bonus_payout'      => 'Bonus payout',
            'all'               => 'Full balance payout',
            default             => 'Commission payment',
        };

        return "{$subject} submitted successfully. It requires approval before the agent's balance is updated.";
    }

    /**
     * May the signed-in user act on this record?
     *
     * Mirrors the transaction rule: a super administrator, or a user without an
     * organisation of their own, may act on anything; everybody else is confined
     * to their own organisation.
     */
    private function canActOnOrganization($user, $recordOrganizationId): bool
    {
        $organizationId = $user->organization_id ?? null;
        $roleId         = $user->role_id ?? null;
        $isSuperAdmin   = !$user || $roleId == 7 || !$organizationId;

        if ($isSuperAdmin) {
            return true;
        }

        return $recordOrganizationId === null || (int) $recordOrganizationId === (int) $organizationId;
    }

    /**
     * Refuse a caller who may not sign payouts off, or null when they may.
     *
     * Defence in depth. ApiAccessControl already demands `agent-payout.approve`
     * for these routes, but the four approve/reject methods carried no role
     * check of their own — only an ORGANISATION check — so the middleware table
     * was the single thing standing between an agent and approving their own
     * payout. A route registered without the middleware, or a rule lost from
     * the map, would have been enough.
     *
     * Asks the permission layer rather than matching a role name, so a custom
     * role holding the key is accepted exactly as the middleware accepts it.
     */
    private function denyUnlessMayApprove($user)
    {
        if (Permissions::allows($user, 'agent-payout.approve')) {
            return null;
        }

        Log::warning('[Agent Payout] Approval refused for a caller without agent-payout.approve', [
            'user_id' => $user->id ?? null,
            'role_id' => $user->role_id ?? null,
        ]);

        return response()->json([
            'success' => false,
            'message' => 'You do not have permission to approve or reject a payout.',
        ], 403);
    }

    /** The identity recorded against an approval or rejection. */
    private function approverIdentity($user): string
    {
        return $user->email_address ?? $user->email ?? 'unknown';
    }

    /**
     * The identity recorded against raising a payout.
     *
     * The email address, not the display name, matching approverIdentity()
     * above: an account's name can be edited afterwards and two people can
     * share one, so a name does not reliably say who raised a record. The
     * address does, and it is what the two columns are read side by side for.
     */
    private function creatorIdentity($user): string
    {
        return $user->email_address ?? $user->email ?? 'System';
    }

    /**
     * Apply a commission-ledger payout to the agent's balances.
     *
     * This is the movement that used to happen the moment a payout was saved. It
     * now runs only when a payout is approved, so an unapproved or rejected
     * payout never affects the agent's money.
     *
     * `balance`, `incentives`, `bonus` and `achievement` are INDEPENDENT columns —
     * the agent dashboard shows them as separate tiles ("Commission" is the
     * `balance` column) and adds them up for Total Balance. So each transaction
     * type only ever moves its own bucket; touching `balance` as well would
     * double-count the money.
     */
    private function applyCommissionMovement(AgentCommissionHistory $history): void
    {
        $agentBalance = AgentBalance::where('agent_id', $history->agent_id)->first();
        if (!$agentBalance) {
            return;
        }

        $amount     = (float) $history->total_amount;
        $balance    = max(0, (float) $agentBalance->balance);
        // What the agent has earned in commission from approved job orders.
        // NOT `commission`, which is the rate one referral pays — a setting.
        $commission = max(0, (float) ($agentBalance->commission_value ?? 0));
        $incentives = max(0, (float) $agentBalance->incentives);
        $bonus      = max(0, (float) ($agentBalance->bonus ?? 0));

        // A payout that names an invoice draws each bucket by what that invoice
        // actually bills, rather than taking the whole subtotal out of commission.
        //
        // An agent invoice is two figures — commission earned per referral, and
        // the incentive claimed from the quota ledger — and the agent's balance
        // holds those in two separate columns. Debiting the lot from
        // `commission_value` would leave the incentive still owed and still
        // payable, which is the double-payment this is here to close.
        //
        // Only the default type takes this path; an operator who deliberately
        // recorded an `incentives_payout` or a `Bonus_payout` against an invoice
        // number meant that type, and gets it.
        $named = $history->type === 'commission'
            ? AgentInvoice::where('invoice_number', trim((string) $history->ref_number))->first()
            : null;

        if ($named) {
            $agentBalance->update([
                'commission_value' => max(0, $commission - (float) $named->commission),
                'incentives'       => max(0, $incentives - (float) $named->total_amount),
            ]);

            return;
        }

        if ($history->type === 'incentives') {
            $agentBalance->update(['incentives' => $incentives + $amount]);
        } elseif ($history->type === 'incentives_payout') {
            $agentBalance->update(['incentives' => max(0, $incentives - $amount)]);
        } elseif ($history->type === 'Bonus') {
            $agentBalance->update(['bonus' => $bonus + $amount]);
        } elseif ($history->type === 'Bonus_payout') {
            $agentBalance->update(['bonus' => max(0, $bonus - $amount)]);
        } elseif ($history->type === 'balance') {
            // The spendable balance, kept separate from commission earnings so
            // each can be paid out on its own.
            $agentBalance->update(['balance' => max(0, $balance - $amount)]);
        } elseif ($history->type === 'all') {
            // Cash out across every bucket: commission first, then balance,
            // then incentives, then bonus. Paying the full total empties them
            // all; a partial amount drains them in order rather than wiping the
            // remainder.
            $fromCommission = min($amount, $commission);
            $fromBalance    = min($amount - $fromCommission, $balance);
            $fromIncentives = min($amount - $fromCommission - $fromBalance, $incentives);
            $fromBonus      = min($amount - $fromCommission - $fromBalance - $fromIncentives, $bonus);

            $agentBalance->update([
                'commission_value' => $commission - $fromCommission,
                'balance'          => $balance - $fromBalance,
                'incentives'       => $incentives - $fromIncentives,
                'bonus'            => $bonus - $fromBonus,
            ]);
        } else {
            // 'commission' and anything unrecognised: the commission earnings,
            // which is where an approved job order credits its payment.
            $agentBalance->update(['commission_value' => max(0, $commission - $amount)]);
        }
    }

    /**
     * Did this payout leave the agent holding nothing?
     *
     * Read AFTER applyCommissionMovement() has run, so it reports what the agent
     * is left with rather than what they had. An "All Balance" payout is only
     * entitled to settle the owner's outstanding invoices when it genuinely
     * cleared every bucket; a partial one has paid some of what is owed and must
     * leave the invoices open for the rest.
     *
     * A rounding tolerance rather than a bare `> 0`, so a residue of a fraction
     * of a centavo does not keep an invoice open forever.
     */
    private function clearedEveryBucket(AgentCommissionHistory $history): bool
    {
        $balance = AgentBalance::where('agent_id', $history->agent_id)->first();

        if (!$balance) {
            return false;
        }

        $remaining = (float) ($balance->commission_value ?? 0)
            + (float) ($balance->balance ?? 0)
            + (float) ($balance->incentives ?? 0)
            + (float) ($balance->bonus ?? 0);

        return $remaining < 0.005;
    }

    /**
     * Settle the one invoice a payout names as its reference.
     *
     * The counterpart of settleAgentInvoicesFor() for the case where the payout
     * knows which invoice it is paying: the invoice is marked Paid and the job
     * orders on its lines follow, read from `agent_invoice_customers` so the
     * invoice itself says what it settled.
     *
     * An invoice already Paid is left alone and reported as 0, so approving twice
     * cannot restate it.
     *
     * @return array{invoices: int, job_orders: int}
     */
    private function settleNamedInvoice(AgentInvoice $invoice, AgentCommissionHistory $history): array
    {
        if ($invoice->status === AgentInvoice::STATUS_PAID) {
            return ['invoices' => 0, 'job_orders' => 0];
        }

        $jobOrderIds = AgentInvoiceCustomer::where('agent_invoice_id', $invoice->id)
            ->whereNotNull('job_order_id')
            ->pluck('job_order_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $invoice->forceFill([
            'status'     => AgentInvoice::STATUS_PAID,
            'updated_by' => 'agent-payout #' . $history->id,
        ])->save();

        $jobOrdersPaid = 0;
        if ($jobOrderIds !== []) {
            $jobOrdersPaid = JobOrder::whereIn('id', $jobOrderIds)
                ->where(function ($q) {
                    $q->whereNull('commission_status')
                      ->orWhere('commission_status', '!=', 'Paid');
                })
                ->update(['commission_status' => 'Paid']);
        }

        return ['invoices' => 1, 'job_orders' => $jobOrdersPaid];
    }

    /**
     * Mark this agent's outstanding referral invoices Paid.
     *
     * An invoice is addressed to an OWNER — a team, or an agent who belongs to
     * none — so the agent is resolved to their owner key first. A team member's
     * payout therefore settles the team's invoices, which is the same document
     * their own referrals were billed on.
     *
     * Only invoices that are not already Paid are touched, so a repeated
     * approval cannot restate one, and `updated_by` names the route that did it
     * rather than leaving it looking like a manual change.
     *
     * The job orders behind those invoices are marked paid with them. Which
     * ones is not guessed at: `agent_invoice_customers` already records the
     * exact job order billed on each invoice line, so the invoice itself says
     * what it settled. The ids are collected BEFORE the status update, while
     * the set of unpaid invoices is still identifiable.
     *
     * @return array{invoices: int, job_orders: int}
     */
    private function settleAgentInvoicesFor(AgentCommissionHistory $history): array
    {
        $none = ['invoices' => 0, 'job_orders' => 0];

        $agent = User::find($history->agent_id);

        if (!$agent) {
            return $none;
        }

        $teamId = $agent->agent_id ?? null;

        $ownerKey = ($teamId !== null && $teamId !== '')
            ? AgentInvoice::ownerKeyForTeam($teamId)
            : AgentInvoice::ownerKeyForAgent($agent->id);

        $invoiceIds = AgentInvoice::where('owner_key', $ownerKey)
            ->where('status', '!=', AgentInvoice::STATUS_PAID)
            ->pluck('id')
            ->all();

        if ($invoiceIds === []) {
            return $none;
        }

        // The job orders those invoices billed, read from the invoice lines.
        $jobOrderIds = AgentInvoiceCustomer::whereIn('agent_invoice_id', $invoiceIds)
            ->whereNotNull('job_order_id')
            ->pluck('job_order_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $invoicesPaid = AgentInvoice::whereIn('id', $invoiceIds)->update([
            'status'     => AgentInvoice::STATUS_PAID,
            'updated_by' => 'agent-payout #' . $history->id,
        ]);

        $jobOrdersPaid = 0;
        if ($jobOrderIds !== []) {
            // Already-paid rows are left alone so the count reports what this
            // approval actually changed rather than what it looked at.
            $jobOrdersPaid = JobOrder::whereIn('id', $jobOrderIds)
                ->where(function ($q) {
                    $q->whereNull('commission_status')
                      ->orWhere('commission_status', '!=', 'Paid');
                })
                ->update(['commission_status' => 'Paid']);
        }

        return ['invoices' => $invoicesPaid, 'job_orders' => $jobOrdersPaid];
    }

    /** The job orders a commission payout settles, as stored when it was raised. */
    private function jobOrderIdsFor(AgentCommissionHistory $history): array
    {
        $stored = $history->job_order_ids;

        if (empty($stored)) {
            return [];
        }

        $ids = is_array($stored) ? $stored : json_decode((string) $stored, true);

        return is_array($ids) ? array_values(array_filter(array_map('intval', $ids))) : [];
    }

    /**
     * Approve a commission-ledger payout: apply it, and record who approved it.
     */
    public function approveHistory(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if ($denied = $this->denyUnlessMayApprove($user)) {
                return $denied;
            }

            DB::beginTransaction();

            $history = AgentCommissionHistory::find($id);
            if (!$history) {
                DB::rollBack();
                return response()->json(['success' => false, 'message' => 'Payout record not found'], 404);
            }

            if (!$this->canActOnOrganization($user, $history->organization_id)) {
                DB::rollBack();
                return response()->json(['success' => false, 'message' => 'Unauthorized access to this payout'], 403);
            }

            // Only a Pending record can be approved. This is what stops the same
            // payout being applied to the agent's balance twice.
            if (($history->status ?? self::STATUS_PENDING) !== self::STATUS_PENDING) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending payouts can be approved. This one is ' . strtolower($history->status) . '.'
                ], 400);
            }

            // Details supplied at approval time.
            //
            // A payout raised from an agent invoice is recorded with only the
            // agent and the invoice number — the amount, type, proof and remarks
            // are asked for here instead, when somebody is actually signing it
            // off. They are written before the movement is applied, so the
            // balance moves by the figure just entered rather than the zero the
            // record was created with.
            $details = $request->validate([
                'total_amount'     => 'nullable|numeric|min:0',
                'type'             => 'nullable|string|max:50',
                'remarks'          => 'nullable|string',
                'proof_of_payment' => 'nullable|string',
            ]);

            $details = array_filter($details, fn ($v) => $v !== null && $v !== '');

            if ($details !== []) {
                $history->forceFill($details)->save();
                $history->refresh();
            }

            $this->applyCommissionMovement($history);

            // The referrals this payout settles are marked paid now, so they can
            // never be included in a second payout.
            $jobOrderIds = $this->jobOrderIdsFor($history);
            if ($jobOrderIds !== []) {
                JobOrder::whereIn('id', $jobOrderIds)->update(['commission_status' => 'Paid']);
            }

            // An "All Balance" payout empties every bucket the agent has, so
            // nothing they have been invoiced for is still outstanding: their
            // referral invoices are settled with it.
            //
            // Done here rather than when the payout is raised, for the same
            // reason the balance is: a pending payout has moved no money, and a
            // rejected one must leave no trace. Marking invoices Paid at that
            // point would settle them against a payment that may never happen.
            $settled = ['invoices' => 0, 'job_orders' => 0];

            // A payout raised from an invoice carries that invoice's number as
            // its reference, so exactly one invoice is settled — the one being
            // paid — rather than every outstanding one the owner has. Checked
            // first, because it is the more specific answer of the two.
            $named = AgentInvoice::where('invoice_number', trim((string) $history->ref_number))->first();

            if ($named) {
                $settled = $this->settleNamedInvoice($named, $history);
            } elseif ($history->type === 'all' && $this->clearedEveryBucket($history)) {
                // Only when the payout ACTUALLY emptied the agent, which is the
                // premise the comment above rests on. applyCommissionMovement()
                // supports a partial 'all' payout - it drains the buckets in order
                // and leaves the remainder - and settling every invoice against
                // one of those wrote off work that had not been paid for. A ₱1
                // payout marked ₱1,200 of invoices Paid while the agent was still
                // owed ₱1,199.
                $settled = $this->settleAgentInvoicesFor($history);
            }

            $approver = $this->approverIdentity($user);

            $history->forceFill([
                'status'     => self::STATUS_APPROVED,
                'approve_by' => $approver,
                'updated_by' => $approver,
                'updated_at' => now(),
            ])->save();

            AuditTrailLog::create([
                'old_details' => ['status' => self::STATUS_PENDING],
                'new_details' => [
                    'type' => 'agent_commission_histories',
                    'id'   => $history->id,
                    'data' => $history->toArray(),
                ],
                'created_by_user' => $approver,
                'updated_by_user' => $approver,
            ]);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Payout approved successfully',
                'data'    => $history,
                'updated_job_orders' => count($jobOrderIds),
                // Both only ever non-zero on an "All Balance" payout.
                'settled_invoices'            => $settled['invoices'],
                'settled_invoice_job_orders'  => $settled['job_orders'],
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to approve payout',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Reject a commission-ledger payout. No balance is ever touched.
     */
    public function rejectHistory(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if ($denied = $this->denyUnlessMayApprove($user)) {
                return $denied;
            }

            $history = AgentCommissionHistory::find($id);
            if (!$history) {
                return response()->json(['success' => false, 'message' => 'Payout record not found'], 404);
            }

            if (!$this->canActOnOrganization($user, $history->organization_id)) {
                return response()->json(['success' => false, 'message' => 'Unauthorized access to this payout'], 403);
            }

            if (($history->status ?? self::STATUS_PENDING) !== self::STATUS_PENDING) {
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending payouts can be rejected. This one is ' . strtolower($history->status) . '.'
                ], 400);
            }

            $approver = $this->approverIdentity($user);
            $reason   = trim((string) $request->input('remarks', ''));

            $history->forceFill([
                'status'     => self::STATUS_REJECTED,
                'approve_by' => $approver,
                'updated_by' => $approver,
                'updated_at' => now(),
                'remarks'    => $reason !== ''
                    ? trim((string) $history->remarks . ' | Rejected: ' . $reason, ' |')
                    : $history->remarks,
            ])->save();

            AuditTrailLog::create([
                'old_details' => ['status' => self::STATUS_PENDING],
                'new_details' => [
                    'type' => 'agent_commission_histories',
                    'id'   => $history->id,
                    'data' => $history->toArray(),
                ],
                'created_by_user' => $approver,
                'updated_by_user' => $approver,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Payout rejected. No balance was changed.',
                'data'    => $history,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to reject payout',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Approve a bonus-ledger record: apply it to the agent's bonus figure.
     */
    public function approveBonus(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if ($denied = $this->denyUnlessMayApprove($user)) {
                return $denied;
            }

            DB::beginTransaction();

            $history = AgentBonusHistory::find($id);
            if (!$history) {
                DB::rollBack();
                return response()->json(['success' => false, 'message' => 'Bonus record not found'], 404);
            }

            if (!$this->canActOnOrganization($user, $history->organization_id)) {
                DB::rollBack();
                return response()->json(['success' => false, 'message' => 'Unauthorized access to this bonus record'], 403);
            }

            if (($history->status ?? self::STATUS_PENDING) !== self::STATUS_PENDING) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending bonus records can be approved. This one is ' . strtolower($history->status) . '.'
                ], 400);
            }

            // The bonus figure is its own column, independent of the commission
            // balance — a bonus movement must not touch the commission balance.
            $agentBalance = AgentBalance::where('agent_id', $history->agent_id)->first();
            if ($agentBalance) {
                $amount = (float) $history->total_amount;
                $bonus  = max(0, (float) ($agentBalance->bonus ?? 0));

                if ($history->type === 'Bonus') {
                    $agentBalance->update(['bonus' => $bonus + $amount]);
                } elseif ($history->type === 'Bonus_payout') {
                    $agentBalance->update(['bonus' => max(0, $bonus - $amount)]);
                }
            }

            $approver = $this->approverIdentity($user);

            $history->forceFill([
                'status'     => self::STATUS_APPROVED,
                'approve_by' => $approver,
                'updated_by' => $approver,
                'updated_at' => now(),
            ])->save();

            AuditTrailLog::create([
                'old_details' => ['status' => self::STATUS_PENDING],
                'new_details' => [
                    'type' => 'agent_bonus_histories',
                    'id'   => $history->id,
                    'data' => $history->toArray(),
                ],
                'created_by_user' => $approver,
                'updated_by_user' => $approver,
            ]);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Bonus approved successfully',
                'data'    => $history,
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to approve bonus',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Reject a bonus-ledger record. No balance is ever touched.
     */
    public function rejectBonus(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if ($denied = $this->denyUnlessMayApprove($user)) {
                return $denied;
            }

            $history = AgentBonusHistory::find($id);
            if (!$history) {
                return response()->json(['success' => false, 'message' => 'Bonus record not found'], 404);
            }

            if (!$this->canActOnOrganization($user, $history->organization_id)) {
                return response()->json(['success' => false, 'message' => 'Unauthorized access to this bonus record'], 403);
            }

            if (($history->status ?? self::STATUS_PENDING) !== self::STATUS_PENDING) {
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending bonus records can be rejected. This one is ' . strtolower($history->status) . '.'
                ], 400);
            }

            $approver = $this->approverIdentity($user);
            $reason   = trim((string) $request->input('remarks', ''));

            $history->forceFill([
                'status'     => self::STATUS_REJECTED,
                'approve_by' => $approver,
                'updated_by' => $approver,
                'updated_at' => now(),
                'remarks'    => $reason !== ''
                    ? trim((string) $history->remarks . ' | Rejected: ' . $reason, ' |')
                    : $history->remarks,
            ])->save();

            AuditTrailLog::create([
                'old_details' => ['status' => self::STATUS_PENDING],
                'new_details' => [
                    'type' => 'agent_bonus_histories',
                    'id'   => $history->id,
                    'data' => $history->toArray(),
                ],
                'created_by_user' => $approver,
                'updated_by_user' => $approver,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Bonus rejected. No balance was changed.',
                'data'    => $history,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to reject bonus',
                'error'   => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Roles that may read or act on another agent's records.
     *
     * 'administrator' is the name the seeded role actually carries
     * (Role::LOCKED_ROLE_NAMES), and it MUST stay in this list: without it an
     * Administrator was silently rescoped to their own rows on every read
     * endpoint here, so Agent Payout and Bonus History came back empty for
     * every role-1 account while working for a SuperAdmin. 'admin' is kept
     * beside it for deployments whose role row is named that way.
     *
     * Matches AgentInvoiceController::ADMIN_ROLES; the two must not drift.
     */
    private const ADMIN_ROLES = ['admin', 'administrator', 'billing', 'superadmin'];

    private function isAdminUser($user): bool
    {
        return in_array(strtolower($user->role->role_name ?? ''), self::ADMIN_ROLES, true);
    }

    /**
     * Fail-safe for deployed servers that predate the achievement migrations.
     *
     * It has to build the table storeAchievement() actually writes, not the one
     * the first migration created. The repeating weekly/monthly tiers added
     * period_type, period_key, cycle_start, cycle_end and job_order_ids
     * (migrations 2026_08_11_000002 and 2026_08_12_000003); a table created
     * without them accepted no claim at all — every Get Reward returned a 500.
     *
     * The columns are also added to a table that already exists but is missing
     * them, which is the state a server left on the original migration is in.
     */
    private function ensureAchievementClaimsTable(): void
    {
        $schema = \Illuminate\Support\Facades\Schema::class;

        if (!$schema::hasTable('agent_achievement_claims')) {
            $schema::create('agent_achievement_claims', function (\Illuminate\Database\Schema\Blueprint $table) {
                $table->id();
                $table->foreignId('agent_id')->constrained('users')->onDelete('cascade');
                $table->integer('milestone');
                $table->decimal('amount', 10, 2)->default(1500.00);
                // The cycle a claim belongs to. Without these a claim cannot be
                // written at all, and the tier could never be claimed twice in
                // two different weeks even if it could.
                $table->string('period_type', 20)->nullable();
                $table->string('period_key', 20)->nullable();
                $table->timestamp('cycle_start')->nullable();
                $table->timestamp('cycle_end')->nullable();
                // Exactly which referrals earned this claim, so none of them can
                // earn the same tier again.
                $table->text('job_order_ids')->nullable();
                $table->timestamps();
            });

            return;
        }

        // Present but built by the older definition: add what is missing.
        $missing = array_filter(
            ['period_type', 'period_key', 'cycle_start', 'cycle_end', 'job_order_ids'],
            fn ($column) => !$schema::hasColumn('agent_achievement_claims', $column)
        );

        if ($missing === []) {
            return;
        }

        $schema::table('agent_achievement_claims', function (\Illuminate\Database\Schema\Blueprint $table) use ($missing) {
            if (in_array('period_type', $missing, true))   $table->string('period_type', 20)->nullable();
            if (in_array('period_key', $missing, true))    $table->string('period_key', 20)->nullable();
            if (in_array('cycle_start', $missing, true))   $table->timestamp('cycle_start')->nullable();
            if (in_array('cycle_end', $missing, true))     $table->timestamp('cycle_end')->nullable();
            if (in_array('job_order_ids', $missing, true)) $table->text('job_order_ids')->nullable();
        });

        Log::warning('[Achievements] Added missing columns to agent_achievement_claims: '
            . implode(', ', $missing));
    }

    /**
     * Same tolerant "Referred By" match the web and mobile clients use: an exact email
     * match, or every word of the agent's name appearing in the referral value.
     */
    private function referralBelongsToAgent(?string $referredBy, string $fullName, string $email, $agentId = null): bool
    {
        // Delegated to the shared rule so incentives, achievements and the
        // weekly invoices can never disagree about whose referral a customer is.
        // $agentId is what lets an id-form referral ("agent:37") match at all.
        return \App\Support\AgentProgramme::referralBelongsToAgent($referredBy, $fullName, $email, $agentId);
    }

    /**
     * Number of job orders referred by this agent that were successfully onboarded.
     * "Referred By" lives on the application, so job orders are joined back to it.
     */
    /**
     * The achievement tiers on offer, from config/achievements.php.
     */
    public static function achievementTiers(): array
    {
        $tiers = config('achievements.tiers', []);

        return is_array($tiers) && $tiers !== [] ? $tiers : [
            'weekly'  => ['label' => 'Weekly Achievement',  'target' => 25,  'reward' => 1000.0,  'period' => 'weekly'],
            'monthly' => ['label' => 'Monthly Achievement', 'target' => 100, 'reward' => 15000.0, 'period' => 'monthly'],
        ];
    }

    /**
     * The identifier for the period a date falls in, e.g. "2026-W33" or "2026-08".
     *
     * This is what makes a repeating reward claimable once per period: the claim
     * records the key, so next week's key differs and the tier opens again.
     */
    public static function periodKeyFor(string $periodType, ?Carbon $at = null): string
    {
        $at = $at ? $at->copy() : Carbon::now();

        return $periodType === 'monthly'
            ? $at->format('Y-m')
            : $at->format('o-\WW');   // ISO year + ISO week, so the turn of the year is handled
    }

    /** The [start, end] dates covered by the period a date falls in. */
    public static function periodBounds(string $periodType, ?Carbon $at = null): array
    {
        $at = $at ? $at->copy() : Carbon::now();

        return $periodType === 'monthly'
            ? [$at->copy()->startOfMonth(), $at->copy()->endOfMonth()]
            : [$at->copy()->startOfWeek(), $at->copy()->endOfWeek()];
    }

    /**
     * The instant a period rolls over — the moment the tier resets to zero.
     *
     * This is the end of the period plus one second: the last second of Sunday
     * (or of the month) still belongs to the period that is ending. The
     * dashboards count down to this instant, so the countdown and the figure it
     * sits beside always change over together.
     */
    public static function periodResetsAt(string $periodType, ?Carbon $at = null): Carbon
    {
        [, $end] = self::periodBounds($periodType, $at);

        return $end->copy()->addSecond();
    }

    /** Step back one period from the given moment. */
    public static function previousPeriodStart(string $periodType, Carbon $at): Carbon
    {
        [$start] = self::periodBounds($periodType, $at);

        return $periodType === 'monthly'
            ? $start->copy()->subMonths(1)
            : $start->copy()->subWeeks(1);
    }

    // ── Cycles ──────────────────────────────────────────────────────────────
    //
    // A tier normally runs on the calendar: Monday to Sunday, or the 1st to the
    // end of the month. Claiming a reward ends that cycle on the spot and
    // starts a fresh one of the same length from the moment of the claim, so an
    // agent who hits the target on Tuesday carries straight on instead of
    // waiting out the rest of the week with a full count and nothing to earn.
    //
    // The moment of a claim is therefore an ANCHOR, and every cycle after it is
    // measured from there in whole steps — seven days for weekly, one month for
    // monthly — until the next claim moves the anchor. An agent who has never
    // claimed has no anchor and stays on the calendar exactly as before.
    //
    // Cycles are identified by where they START, never by where they end. That
    // is what lets a cycle be cut short by a claim without changing its
    // identity: the ledger row written when it closes carries the same key it
    // had while it was running.

    /** Whichever of two moments comes first. */
    private static function earlier(Carbon $a, Carbon $b): Carbon
    {
        return $a->lessThanOrEqualTo($b) ? $a->copy() : $b->copy();
    }

    /** How far apart two cycles of this tier sit. */
    private static function advanceCycle(string $periodType, Carbon $from, int $steps): Carbon
    {
        return $periodType === 'monthly'
            // No overflow: a cycle anchored on the 31st lands on the 28th in
            // February, not on the 3rd of March.
            ? $from->copy()->addMonthsNoOverflow($steps)
            : $from->copy()->addDays(7 * $steps);
    }

    /**
     * The cycle containing a given moment, honouring any claim that reset the
     * schedule at or before it.
     *
     * A cycle counts from where it starts. Nothing is excluded by the clock:
     * a referral already paid for is skipped because its id is recorded on the
     * claim that paid it, which is exact where a time boundary is only a guess.
     *
     * @param  array<int, Carbon>  $anchors  claim moments for this tier, ascending
     * @return array{start: Carbon, end: Carbon, key: string, anchored: bool}
     */
    public static function cycleAt(string $periodType, array $anchors, Carbon $at): array
    {
        // The most recent claim that had already happened by this moment. Later
        // claims are ignored, so looking back at an earlier moment reconstructs
        // the cycle that was actually running then.
        $anchor = null;
        foreach ($anchors as $candidate) {
            if ($candidate->lessThanOrEqualTo($at)) {
                $anchor = $candidate;
            } else {
                break;
            }
        }

        if ($anchor === null) {
            [$start, $end] = self::periodBounds($periodType, $at);

            return [
                'start'    => $start,
                'end'      => $end,
                'key'      => self::periodKeyFor($periodType, $at),
                'anchored' => false,
            ];
        }

        // Step forward from the anchor in whole cycles until one contains $at.
        // Seeded by arithmetic rather than walked from the start, so an anchor
        // set long ago costs the same as one set yesterday.
        if ($periodType === 'monthly') {
            $steps = max(0, $anchor->diffInMonths($at));
            while ($steps > 0 && self::advanceCycle($periodType, $anchor, $steps)->greaterThan($at)) {
                $steps--;
            }
            while (self::advanceCycle($periodType, $anchor, $steps + 1)->lessThanOrEqualTo($at)) {
                $steps++;
            }
        } else {
            $steps = max(0, intdiv($at->getTimestamp() - $anchor->getTimestamp(), 7 * 86400));
        }

        $start = self::advanceCycle($periodType, $anchor, $steps);
        $end   = self::advanceCycle($periodType, $anchor, $steps + 1)->subSecond();

        return [
            'start'    => $start,
            'end'      => $end,
            'key'      => self::cycleKey($periodType, $start),
            'anchored' => true,
        ];
    }

    /**
     * The identifier for a cycle that follows a claim rather than the calendar.
     *
     * Distinct from a calendar key ("2026-W33") so the two can never collide,
     * and built from the cycle's start alone so a cycle cut short by a claim
     * keeps the identity it had while it was open.
     */
    public static function cycleKey(string $periodType, Carbon $start): string
    {
        // To the second. Two claims of the same tier inside one minute would
        // otherwise produce the same key for a cycle and the cycle after it,
        // leaving the tier looking permanently claimed.
        return ($periodType === 'monthly' ? 'm@' : 'w@') . $start->format('Ymd-His');
    }

    /**
     * Every moment this agent has claimed this tier, ascending — the points at
     * which their schedule was reset.
     *
     * Bounded: only the recent ones matter, since nothing reaches further back
     * than the closing lookback.
     *
     * @return array<int, Carbon>
     */
    public function claimAnchors($agent, string $periodType): array
    {
        if (!$agent) {
            return [];
        }

        try {
            $rows = AgentAchievementClaim::where('agent_id', $agent->id)
                ->where('period_type', $periodType)
                ->whereNotNull('cycle_end')
                ->orderByDesc('cycle_end')
                ->limit(self::CLOSE_LOOKBACK_PERIODS * 2)
                ->pluck('cycle_end');
        } catch (\Throwable $e) {
            // A server that predates the cycle columns has no anchors, which
            // simply leaves every tier on the calendar.
            return [];
        }

        $anchors = [];
        foreach ($rows as $value) {
            if (!$value) {
                continue;
            }

            $anchors[] = $value instanceof Carbon ? $value->copy() : Carbon::parse($value);
        }

        // Oldest first, as cycleAt expects.
        usort($anchors, fn (Carbon $a, Carbon $b) => $a->getTimestamp() <=> $b->getTimestamp());

        return $anchors;
    }

    /** The cycle a tier is counting right now. */
    public function currentCycle($agent, string $periodType, ?Carbon $at = null): array
    {
        return self::cycleAt($periodType, $this->claimAnchors($agent, $periodType), $at ? $at->copy() : Carbon::now());
    }

    /**
     * How many elapsed periods to reach back for when closing.
     *
     * An agent who has not been looked at for a while still gets their recent
     * periods recorded, without an unbounded walk back through history the
     * first time the ledger is written.
     */
    private const CLOSE_LOOKBACK_PERIODS = 12;

    /**
     * How many past claims to read when working out which referrals are spent.
     *
     * Deep enough to cover years of weekly claims, so a referral backdated a
     * long way still meets the claim that already paid for it.
     */
    private const CLAIM_HISTORY_LIMIT = 200;

    private function ensureAchievementPeriodsTable(): void
    {
        // Fail-safe for deployed servers that predate the migration.
        if (\Illuminate\Support\Facades\Schema::hasTable('agent_achievement_periods')) {
            return;
        }

        \Illuminate\Support\Facades\Schema::create('agent_achievement_periods', function (\Illuminate\Database\Schema\Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id')->index();
            $table->string('period_type', 20);
            $table->string('period_key', 20);
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->integer('target')->default(0);
            $table->integer('onboarded')->default(0);
            $table->boolean('reached')->default(false);
            $table->boolean('claimed')->default(false);
            $table->unsignedBigInteger('claim_id')->nullable();
            $table->decimal('reward_paid', 12, 2)->default(0);
            $table->integer('carried_over')->default(0);
            $table->timestamp('closed_at')->nullable();
            $table->string('closed_by')->nullable();
            $table->string('closed_reason', 20)->nullable();
            $table->unsignedBigInteger('organization_id')->nullable()->index();
            $table->timestamps();
            $table->unique(['agent_id', 'period_type', 'period_key'], 'agent_period_unique');
        });
    }

    /**
     * Record every achievement period that has ended and is not yet on file.
     *
     * A reset is not an event the application performs — the count is derived
     * from the referrals inside the current period, so it returns to zero on its
     * own when the period turns. That leaves nothing to audit afterwards, which
     * is what this closes: as each period ends, its final count is written down
     * alongside the fact that nothing was carried forward.
     *
     * Called whenever an agent's achievements are read, and by the scheduled
     * command for agents nobody has looked at. Attempting a closure that is
     * already recorded is normal and does nothing — the unique key decides who
     * wrote it, so two callers racing cannot produce two audit entries.
     *
     * Never allowed to break the caller: a dashboard must still load if the
     * ledger cannot be written.
     *
     * @return array<int, AgentAchievementPeriod> the closures written by this call
     */
    public function closeElapsedPeriods($agent, ?Carbon $at = null, string $closedBy = 'System'): array
    {
        if (!$agent) {
            return [];
        }

        try {
            $this->ensureAchievementPeriodsTable();
        } catch (\Throwable $e) {
            Log::warning('[Achievements] Could not prepare the period ledger: ' . $e->getMessage());
            return [];
        }

        $now    = $at ? $at->copy() : Carbon::now();
        $closed = [];

        foreach (self::achievementTiers() as $key => $tier) {
            $periodType = $tier['period'] ?? $key;
            $target     = (int) ($tier['target'] ?? 0);
            $anchors    = $this->claimAnchors($agent, $periodType);

            // Walk back one cycle at a time from the one currently running. The
            // current cycle is still open, so it is never closed here.
            //
            // Reconstructed through cycleAt rather than by stepping a fixed
            // period, because a claim may have moved the schedule partway
            // through: the cycles behind an anchor are calendar cycles and the
            // ones after it are not.
            $cursor = $this->currentCycle($agent, $periodType, $now)['start']->copy()->subSecond();

            for ($i = 0; $i < self::CLOSE_LOOKBACK_PERIODS; $i++) {
                $cycle = self::cycleAt($periodType, $anchors, $cursor);

                // Already recorded — and so is everything before it, since
                // closures are written newest-first as each cycle ends.
                $exists = AgentAchievementPeriod::where('agent_id', $agent->id)
                    ->where('period_type', $periodType)
                    ->where('period_key', $cycle['key'])
                    ->exists();

                if ($exists) {
                    break;
                }

                $record = $this->closeOnePeriod(
                    $agent, $periodType, $cycle['key'], $cycle['start'], $cycle['end'],
                    $target, $closedBy, 'period_ended'
                );

                if ($record) {
                    $closed[] = $record;
                }

                $cursor = $cycle['start']->copy()->subSecond();
            }
        }

        return $closed;
    }

    /**
     * Write one period's closing record, and the audit entry that goes with it.
     *
     * The audit entry is a before-and-after pair: what the period finished on,
     * and what the period after it opened on. The second is always zero, which
     * is the point — it shows the count did not follow the agent forward.
     */
    /**
     * Record the closure of a cycle that a claim has just ended.
     *
     * Kept apart from the claim's own transaction: the reward is already paid
     * and the balance already moved, so a ledger or audit failure must not undo
     * any of that. If this does fail, the next dashboard load closes the cycle
     * anyway — by then its end has passed, so the ordinary elapsed-period walk
     * picks it up.
     */
    private function closeClaimedCycle($agent, string $periodType, string $periodKey, Carbon $from, Carbon $claimedAt, int $target, string $closedBy, bool $endedEarly): void
    {
        try {
            $this->ensureAchievementPeriodsTable();

            $this->closeOnePeriod(
                $agent, $periodType, $periodKey, $from, $claimedAt->copy(),
                $target, $closedBy, $endedEarly ? 'claimed_early' : 'period_ended'
            );
        } catch (\Throwable $e) {
            Log::warning("[Achievements] Claimed {$periodType} {$periodKey} for agent {$agent->id} but could not record the closure: " . $e->getMessage());
        }
    }

    private function closeOnePeriod(
        $agent,
        string $periodType,
        string $periodKey,
        Carbon $from,
        Carbon $to,
        int $target,
        string $closedBy,
        string $reason = 'period_ended'
    ): ?AgentAchievementPeriod {
        try {
            // Referrals spent on OTHER cycles are skipped; this cycle's own
            // claim is not, or recounting it would report zero instead of the
            // figure it was claimed on.
            $onboarded = $this->countOnboardedReferrals(
                $agent,
                $from,
                $to,
                $this->claimedJobOrderIds($agent, $periodType, $periodKey)
            );

            $claim = AgentAchievementClaim::where('agent_id', $agent->id)
                ->where('period_type', $periodType)
                ->where('period_key', $periodKey)
                ->first();

            $record = AgentAchievementPeriod::create([
                'agent_id'     => $agent->id,
                'period_type'  => $periodType,
                'period_key'   => $periodKey,
                'period_start' => $from->format('Y-m-d'),
                'period_end'   => $to->format('Y-m-d'),
                'target'       => $target,
                'onboarded'    => $onboarded,
                'reached'      => $target > 0 && $onboarded >= $target,
                'claimed'      => $claim !== null,
                'claim_id'     => $claim->id ?? null,
                'reward_paid'  => $claim ? (float) $claim->amount : 0,
                // Stated, not implied.
                'carried_over' => 0,
                'closed_at'    => Carbon::now(),
                'closed_by'    => $closedBy,
                'closed_reason'=> $reason,
                'organization_id' => $agent->organization_id ?? null,
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            // Another request closed this period first. That is the expected
            // outcome of a race, not a failure — the period is on file either way.
            return null;
        } catch (\Throwable $e) {
            Log::warning("[Achievements] Could not close {$periodType} {$periodKey} for agent {$agent->id}: " . $e->getMessage());
            return null;
        }

        // The cycle that takes over, resolved the same way the dashboard will
        // resolve it — so the audit names the period the agent actually sees
        // next, whether the schedule stayed on the calendar or a claim moved it.
        $opensAt = $to->copy()->addSecond();
        $next    = self::cycleAt($periodType, $this->claimAnchors($agent, $periodType), $opensAt);

        $earlyClaim = $reason === 'claimed_early';
        $note = $earlyClaim
            ? "{$periodType} reward claimed early on {$to->format('Y-m-d H:i')}, ending {$periodKey} "
              . "at {$onboarded} onboard(s). A fresh cycle {$next['key']} starts immediately at 0 — "
              . "nothing was carried over, and the reward just claimed does not apply to it."
            : "{$periodType} progress reset to 0 for {$next['key']}; "
              . "{$onboarded} onboard(s) from {$periodKey} were not carried over"
              . ($record->claimed ? ' and its claimed reward does not carry over either' : '');

        try {
            AuditTrailLog::create([
                'old_details' => [
                    'type'        => 'agent_achievement_periods',
                    'event'       => 'period_closed',
                    'reason'      => $reason,
                    'agent_id'    => $agent->id,
                    'period_type' => $periodType,
                    'period_key'  => $periodKey,
                    'period_start'=> $from->format('Y-m-d H:i:s'),
                    'period_end'  => $to->format('Y-m-d H:i:s'),
                    'ended_early' => $earlyClaim,
                    'target'      => $target,
                    'onboarded'   => $onboarded,
                    'reached'     => $record->reached,
                    'claimed'     => $record->claimed,
                    'claim_id'    => $record->claim_id,
                    'reward_paid' => (float) $record->reward_paid,
                ],
                'new_details' => [
                    'type'        => 'agent_achievement_periods',
                    'event'       => 'period_opened',
                    'reason'      => $reason,
                    'agent_id'    => $agent->id,
                    'period_type' => $periodType,
                    'period_key'  => $next['key'],
                    'period_start'=> $next['start']->format('Y-m-d H:i:s'),
                    'period_end'  => $next['end']->format('Y-m-d H:i:s'),
                    // Set by a claim rather than by the calendar, which is why
                    // the new cycle does not begin on a Monday or the 1st.
                    'anchored'    => $next['anchored'],
                    // The whole purpose of the record: the new cycle starts from
                    // nothing, and neither the count nor the claim came with it.
                    'onboarded'    => 0,
                    'carried_over' => 0,
                    'claimed'      => false,
                    'target'       => $target,
                    'note'         => $note,
                ],
                'created_by_user' => $closedBy,
                'updated_by_user' => $closedBy,
            ]);
        } catch (\Throwable $e) {
            Log::warning("[Achievements] Closed {$periodType} {$periodKey} for agent {$agent->id} but could not write the audit entry: " . $e->getMessage());
        }

        return $record;
    }

    private function countOnboardedReferrals($agent, ?Carbon $from = null, ?Carbon $to = null, array $exclude = []): int
    {
        return count($this->onboardedReferralIds($agent, $from, $to, $exclude));
    }

    /**
     * The job orders this agent onboarded within a span, as their ids.
     *
     * Ids rather than a bare total because a reward has to record exactly which
     * referrals earned it. Progress is worked out from when a referral was
     * onboarded, so without that record a job order whose installation date is
     * later edited backwards would drop into a cycle it has already been paid
     * for and earn its reward a second time. `$exclude` carries the ids that
     * have already been claimed, and they are skipped whatever their date says.
     *
     * @param  array<int, int|string>  $exclude  job order ids already claimed
     * @return array<int, int>
     */
    private function onboardedReferralIds($agent, ?Carbon $from = null, ?Carbon $to = null, array $exclude = []): array
    {
        $first = trim((string) ($agent->first_name ?? ''));
        $last  = trim((string) ($agent->last_name ?? ''));
        $email = trim((string) ($agent->email_address ?? ''));
        $fullName = trim($first . ' ' . $last);

        // Referrals made through the picker are stored as the agent's user id,
        // which is how they are found and matched — an account with neither a
        // name nor an email on file can still be paid for them.
        $agentId = $agent->id ?? null;

        if ($fullName === '' && $email === '' && $agentId === null) {
            return [];
        }

        // Keyed for a straight lookup rather than a scan per candidate row.
        $skip = [];
        foreach ($exclude as $id) {
            $skip[(int) $id] = true;
        }

        // Narrow the candidate set in SQL, then apply the exact tolerant match in PHP.
        $query = DB::table('job_orders as jo')
            ->join('applications as a', 'jo.application_id', '=', 'a.id')
            ->whereIn(DB::raw('LOWER(TRIM(jo.onsite_status))'), ['done', 'completed'])
            ->whereNotNull('a.referred_by');

        // Referrals onboarded before the programme began are history: they add
        // nothing to weekly or monthly progress, however recent the cycle being
        // counted. Applied unconditionally, so a count with no date bounds is
        // scoped too — the same date the incentive cron uses, so an agent's
        // achievement progress and their incentive always agree about which of
        // their referrals count.
        $completedAt = \App\Support\AgentProgramme::onboardedAtSql('jo');
        $startDate   = \App\Support\AgentProgramme::startDate();
        if ($startDate !== null) {
            $query->whereRaw("{$completedAt} >= ?", [$startDate->format('Y-m-d H:i:s')]);
        }

        // Weekly and monthly tiers count only what was onboarded inside the
        // period. The installation date is the moment the referral counts —
        // falling back to when the job order was raised where it is not set, so
        // a completed referral is never silently uncounted.
        if ($from !== null && $to !== null) {
            // The lower bound is taken at DAY resolution, the upper bound to the
            // second.
            //
            // A cycle that begins when a reward is claimed starts partway
            // through a day — say 10:25 — but `job_orders.date_installed` is a
            // DATE, so every referral installed that day carries 00:00:00.
            // Bounding the start to the second therefore excluded every
            // same-day referral from the new cycle, and since each later cycle
            // starts later still, nothing could ever count them again: an agent
            // who claimed early silently lost that day's remaining work.
            //
            // Counting the claim's own referrals twice is prevented by
            // claimedJobOrderIds(), which is passed in as $exclude and skips
            // them whatever their date says — so the date no longer has to do
            // that job as well. Calendar cycles are unaffected: they already
            // begin at 00:00:00.
            $query->whereRaw("{$completedAt} >= ?", [$from->copy()->startOfDay()->format('Y-m-d H:i:s')])
                  ->whereRaw("{$completedAt} <= ?", [$to->format('Y-m-d H:i:s')]);
        }

        // Narrowed with the shared clause, which adds the id form to the name
        // and email ones — a referral stored as "agent:37" carries none of the
        // agent's name, so the LIKE clauses alone would never return it.
        \App\Support\AgentReferral::narrow($query, 'a.referred_by', $agentId, $first, $last, $email);

        $rows = $query
            ->select('jo.id as job_order_id', 'a.referred_by as referred_by')
            ->get();

        $ids = [];
        foreach ($rows as $row) {
            $jobOrderId = (int) (is_array($row) ? ($row['job_order_id'] ?? 0) : ($row->job_order_id ?? 0));

            // Already earned its reward for this tier — its date is irrelevant.
            if ($jobOrderId > 0 && isset($skip[$jobOrderId])) {
                continue;
            }

            $referredBy = is_array($row) ? ($row['referred_by'] ?? null) : ($row->referred_by ?? null);
            if ($this->referralBelongsToAgent($referredBy, $fullName, $email, $agentId)) {
                $ids[] = $jobOrderId;
            }
        }

        return $ids;
    }

    /**
     * Job orders that have already earned this tier's reward for this agent.
     *
     * Scoped to one tier: a referral that earned a weekly reward can still earn
     * a monthly one, because those are separate achievements. Scoped to one
     * agent for the same reason a claim is.
     *
     * `$exceptPeriodKey` leaves out one cycle's own claim, so recounting the
     * cycle a reward was taken in still reports the figure it was taken on
     * rather than zero.
     *
     * @return array<int, int>
     */
    private function claimedJobOrderIds($agent, string $periodType, ?string $exceptPeriodKey = null): array
    {
        if (!$agent) {
            return [];
        }

        try {
            $claims = AgentAchievementClaim::where('agent_id', $agent->id)
                ->where('period_type', $periodType)
                ->whereNotNull('job_order_ids')
                ->orderByDesc('id')
                ->limit(self::CLAIM_HISTORY_LIMIT)
                ->get(['period_key', 'job_order_ids']);
        } catch (\Throwable $e) {
            // A server that predates the column simply has nothing recorded,
            // which leaves counting exactly as it was before.
            return [];
        }

        $ids = [];
        foreach ($claims as $claim) {
            if ($exceptPeriodKey !== null && ($claim->period_key ?? null) === $exceptPeriodKey) {
                continue;
            }

            $stored = $claim->job_order_ids;
            if (is_string($stored)) {
                $stored = json_decode($stored, true);
            }

            if (is_array($stored)) {
                foreach ($stored as $id) {
                    $ids[] = (int) $id;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    public function getAchievements(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $this->ensureAchievementClaimsTable();

            // Non-admins can only read their own claims.
            $agentId = $this->isAdminUser($user) ? $request->input('agent_id') : $user->id;
            if (!$agentId) {
                return response()->json(['success' => false, 'message' => 'Agent ID required'], 400);
            }

            $claims = AgentAchievementClaim::where('agent_id', $agentId)->get();

            // The dashboards render the tiers from this response rather than
            // hardcoding targets and rewards of their own, so web and mobile can
            // never drift from the configured figures.
            $agent  = \App\Models\User::find($agentId);
            $tiers  = [];

            // One reading of the clock for every tier, so the countdowns the
            // dashboards render are all measured from the same instant.
            $now = Carbon::now();

            // Any period that has ended since this agent was last looked at is
            // written to the ledger now, with the audit entry showing what it
            // finished on and that the next period opened at zero. Reading the
            // dashboard is what most often notices a rollover first; the
            // scheduled command covers agents nobody opens.
            $this->closeElapsedPeriods($agent, $now);

            foreach (self::achievementTiers() as $key => $tier) {
                $periodType = $tier['period'] ?? $key;

                // The cycle now running. Normally the calendar week or month;
                // after an early claim, a fresh cycle of the same length
                // measured from the moment that reward was taken.
                $cycle     = $this->currentCycle($agent, $periodType, $now);
                $periodKey = $cycle['key'];
                $from      = $cycle['start'];
                $to        = $cycle['end'];
                $resetsAt  = $to->copy()->addSecond();

                // Counted only up to now, never to the end of a cycle that is
                // still running. A referral dated ahead of today would otherwise
                // be credited before it happened — and, once the reward was
                // claimed on the strength of it, credited a second time in the
                // cycle it actually falls in.
                // Referrals that already earned this tier's reward are skipped,
                // so one cannot be counted again by being backdated into the
                // cycle now running.
                $onboarded = $agent
                    ? $this->countOnboardedReferrals(
                        $agent,
                        $cycle['start'],
                        self::earlier($to, $now),
                        $this->claimedJobOrderIds($agent, $periodType, $periodKey)
                    )
                    : 0;
                $target    = (int) ($tier['target'] ?? 0);

                $claimed = $claims->first(fn ($c) =>
                    ($c->period_type ?? null) === $periodType && ($c->period_key ?? null) === $periodKey
                );

                $tiers[$key] = [
                    'key'            => $key,
                    'label'          => $tier['label'] ?? ucfirst($key) . ' Achievement',
                    'target'         => $target,
                    'reward'         => (float) ($tier['reward'] ?? 0),
                    'period_type'    => $periodType,
                    'period_key'     => $periodKey,
                    'period_start'   => $from->format('Y-m-d'),
                    'period_end'     => $to->format('Y-m-d'),
                    // True when a claim set this cycle going rather than the
                    // calendar, so the dashboards can say "this cycle" instead
                    // of "this week" when the two are no longer the same thing.
                    'anchored'       => $cycle['anchored'],
                    // The instant this tier rolls over, as an absolute time with
                    // an offset, so a device in another timezone still counts
                    // down to the same moment the server resets on.
                    'resets_at'      => $resetsAt->toIso8601String(),
                    'resets_in'      => max(0, $resetsAt->getTimestamp() - $now->getTimestamp()),
                    'onboarded'      => $onboarded,
                    'remaining'      => max(0, $target - $onboarded),
                    'progress'       => $target > 0 ? min(1, $onboarded / $target) : 0,
                    'reached'        => $target > 0 && $onboarded >= $target,
                    'claimed'        => $claimed !== null,
                    'claimable'      => $target > 0 && $onboarded >= $target && $claimed === null,
                ];
            }

            return response()->json([
                'success'     => true,
                'data'        => $claims,
                'tiers'       => $tiers,
                // Lets the dashboards correct for a device clock that is wrong,
                // so a mis-set phone does not count down to the wrong minute.
                'server_time' => $now->toIso8601String(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch achievements',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function storeAchievement(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $this->ensureAchievementClaimsTable();

            $validated = $request->validate([
                'agent_id' => 'nullable|integer',
                // Which tier is being claimed. `milestone` is still accepted so an
                // older client keeps working; it is only used to infer the tier.
                'type'      => 'nullable|string|max:20',
                'milestone' => 'nullable|integer|min:1',
            ]);

            // Non-admins can only claim for themselves, whatever agent_id they send.
            $isAdmin = $this->isAdminUser($user);
            $agentId = $isAdmin ? ($validated['agent_id'] ?? $user->id) : $user->id;

            $agent = \App\Models\User::find($agentId);
            if (!$agent) {
                return response()->json(['success' => false, 'message' => 'Agent not found'], 404);
            }

            $tiers    = self::achievementTiers();
            $tierKey  = strtolower(trim((string) ($validated['type'] ?? '')));

            // An older client sends only a milestone number; match it to the tier
            // with that target so it still claims the right reward.
            if (!isset($tiers[$tierKey]) && !empty($validated['milestone'])) {
                foreach ($tiers as $key => $tier) {
                    if ((int) ($tier['target'] ?? 0) === (int) $validated['milestone']) {
                        $tierKey = $key;
                        break;
                    }
                }
            }

            if (!isset($tiers[$tierKey])) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unknown achievement. Available: ' . implode(', ', array_keys($tiers)) . '.'
                ], 422);
            }

            $tier       = $tiers[$tierKey];
            $target     = (int) ($tier['target'] ?? 0);
            $reward     = (float) ($tier['reward'] ?? 0);
            $periodType = $tier['period'] ?? $tierKey;

            // The cycle now running for this agent, which is the calendar week
            // or month unless an earlier claim moved their schedule.
            $claimedAt  = Carbon::now();
            $cycle      = $this->currentCycle($agent, $periodType, $claimedAt);
            $periodKey  = $cycle['key'];
            $from       = $cycle['start'];
            $to         = $cycle['end'];

            // Only what was onboarded inside this cycle, and only up to now —
            // a referral dated later in the cycle has not happened yet and must
            // not earn a reward before it does.
            $countTo = self::earlier($to, $claimedAt);

            // The exact job orders this claim would be paid for — recorded on
            // the claim below so none of them can earn this tier again.
            $earnedBy  = $this->onboardedReferralIds(
                $agent,
                $cycle['start'],
                $countTo,
                $this->claimedJobOrderIds($agent, $periodType, $periodKey)
            );
            $onboarded = count($earnedBy);
            if ($onboarded < $target) {
                return response()->json([
                    'success' => false,
                    'message' => "{$tier['label']} not reached yet ({$onboarded} of {$target} onboarded "
                        . "between {$from->format('M j')} and {$to->format('M j')})."
                ], 422);
            }

            // The reward is fixed server side — never taken from the request.
            //
            // The claim also carries the span it was earned over. `cycle_end` is
            // this moment: claiming ends the cycle here rather than at the end
            // of the calendar week, and it is the anchor the next cycle — and
            // every cycle after it — is measured from.
            $validated = [
                'agent_id'    => $agentId,
                'milestone'   => $target,
                'amount'      => $reward,
                'period_type' => $periodType,
                'period_key'  => $periodKey,
                'cycle_start' => $from,
                'cycle_end'   => $claimedAt,
                // Stored the same way a commission payout stores the job orders
                // it covered, so a referral can never earn this tier twice.
                'job_order_ids' => json_encode(array_values($earnedBy)),
            ];

            // Claimed once per period, not once ever: the same tier opens again
            // when the week or month rolls over and the period key changes.
            $exists = AgentAchievementClaim::where('agent_id', $validated['agent_id'])
                ->where('period_type', $periodType)
                ->where('period_key', $periodKey)
                ->exists();

            if ($exists) {
                return response()->json([
                    'success' => false,
                    'message' => "{$tier['label']} has already been claimed for this period."
                ], 400);
            }

            // Start transaction
            DB::beginTransaction();

            // 1. Record the achievement claim
            $claim = AgentAchievementClaim::create($validated);

            // 2. Add to agent balance via AgentCommissionHistory logic
            $historyPayload = [
                'agent_id'      => $validated['agent_id'],
                'ref_number'    => 'ACHIEVEMENT-' . strtoupper($periodType) . '-' . $periodKey,
                'total_amount'  => $validated['amount'],
                'remarks'       => "{$tier['label']} reward for {$target} onboards ({$periodKey})",
                'proof_of_payment' => 'System Auto Reward',
                'type'          => 'achievement',
                'created_by'    => $user->full_name ?? $user->email_address ?? 'System',
                // Credit the record to the agent's organization, not the actor's.
                'organization_id' => $agent->organization_id ?? null,
                // A milestone reward is granted by the system the moment the
                // agent claims it — the entitlement is re-checked server side
                // just above. It is therefore recorded as already approved, so
                // it is never queued for an approval that would double-credit it.
                'status'        => self::STATUS_APPROVED,
                'approve_by'    => 'System',
            ];

            $history = AgentCommissionHistory::create($historyPayload);

            // Pay the reward straight into `balance` — the spendable commission bucket —
            // so a claimed milestone can actually be cashed out through the payout modal.
            // `achievement` is ALSO credited, but purely as a lifetime "rewards earned"
            // figure behind the dashboard tile; it is deliberately NOT part of the
            // agent's Total Balance, otherwise this reward would be counted twice.
            $agentBalance = AgentBalance::where('agent_id', $validated['agent_id'])->first();
            if ($agentBalance) {
                $agentBalance->update([
                    'balance'     => max(0, (float)$agentBalance->balance) + (float)$validated['amount'],
                    'achievement' => max(0, (float)($agentBalance->achievement ?? 0)) + (float)$validated['amount'],
                ]);
            } else {
                AgentBalance::create([
                    'agent_id' => $validated['agent_id'],
                    'balance' => (float)$validated['amount'],
                    'commission' => 0,
                    'achievement' => (float)$validated['amount'],
                ]);
            }

            // Audit Trail.
            //
            // A repeating reward is claimable once per period, so the entry has
            // to say which period was claimed, not just that a claim happened.
            // Without the period on the record, two claims of the same tier are
            // indistinguishable from a double payment. `next_period_claimable`
            // states the other half: taking this reward does not consume the
            // next period's, and does not carry into it either.
            $userEmail = $user->email_address ?? $user->email ?? 'System';

            // The cycle that starts the moment this claim lands. Resolved from
            // the claim just written, so it is the same cycle the dashboard will
            // show when it reloads a second from now.
            $nextCycle     = self::cycleAt($periodType, [$claimedAt->copy()], $claimedAt->copy()->addSecond());
            $nextPeriodKey = $nextCycle['key'];
            $endedEarly    = $claimedAt->lessThan($to);

            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type' => 'agent_achievement_claims',
                    'id' => $claim->id,
                    'data' => $claim->toArray(),
                    'event'        => 'achievement_claimed',
                    'agent_id'     => $validated['agent_id'],
                    'period_type'  => $periodType,
                    'period_key'   => $periodKey,
                    'period_start' => $from->format('Y-m-d H:i:s'),
                    'period_end'   => $to->format('Y-m-d H:i:s'),
                    'claimed_at'   => $claimedAt->format('Y-m-d H:i:s'),
                    // Claimed before the cycle was due to end, which cuts the
                    // cycle short and starts the next one immediately.
                    'claimed_early'=> $endedEarly,
                    'target'       => $target,
                    'onboarded'    => $onboarded,
                    'reward_paid'  => (float) $validated['amount'],
                    // Exactly which referrals earned this reward. They are
                    // spent for this tier from here on, so the same onboards
                    // cannot be presented again — by a backdated installation
                    // date or otherwise.
                    'job_order_ids'         => array_values($earnedBy),
                    'commission_history_id' => $history->id,
                    'next_period_key'       => $nextPeriodKey,
                    'next_period_start'     => $nextCycle['start']->format('Y-m-d H:i:s'),
                    'next_period_end'       => $nextCycle['end']->format('Y-m-d H:i:s'),
                    'next_period_claimable' => true,
                    'note' => "{$tier['label']} claimed for {$periodKey} ({$onboarded} of {$target} onboarded). "
                        . ($endedEarly
                            ? "Claimed early, so {$periodKey} ends now and {$nextPeriodKey} starts immediately at 0 "
                              . "instead of the agent waiting for the calendar to turn. "
                            : '')
                        . "This claim applies to {$periodKey} only and does not carry into {$nextPeriodKey}.",
                ],
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            DB::commit();

            // The claim has ended this cycle, so record its closure — the same
            // ledger row and before/after audit pair a cycle gets when its time
            // simply runs out, marked as ended by a claim rather than by the
            // clock. Deliberately outside the transaction: the reward is already
            // paid and must not be rolled back if the bookkeeping fails.
            $this->closeClaimedCycle(
                $agent, $periodType, $periodKey, $from, $claimedAt,
                $target, $userEmail, $endedEarly
            );

            return response()->json([
                'success' => true,
                'message' => 'Achievement claimed successfully',
                'data' => $claim
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors'  => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to store achievement',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


