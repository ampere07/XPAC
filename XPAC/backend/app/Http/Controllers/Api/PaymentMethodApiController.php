<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use App\Models\ActivityLog;

class PaymentMethodApiController extends Controller
{
    private function resolveUserId(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->id;
            }
        }

        if (\Auth::check()) {
            return \Auth::id();
        }

        return null;
    }

    private function resolveUserOrgId(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->organization_id;
            }
        }

        if (\Auth::check()) {
            return \Auth::user()->organization_id;
        }

        return null;
    }

    private function isGlobalAdmin(Request $request)
    {
        $email = $request->input('email_address') ?? $request->input('created_by') ?? $request->input('updated_by') ?? $request->input('modified_by');
        
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->role_id == 7 && $user->organization_id === null;
            }
        }

        if (\Auth::check()) {
            $user = \Auth::user();
            return $user->role_id == 7 && $user->organization_id === null;
        }

        return false;
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = (int) $request->get('limit', 100);
            $search = $request->get('search', '');
            
            $query = PaymentMethod::query();

            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $query->where('organization_id', $orgId);
                } else {
                    $query->whereNull('organization_id');
                }
            } else {
                $query->whereNull('organization_id');
            }
            
            if (!empty($search)) {
                $query->where('payment_method', 'like', '%' . $search . '%');
            }
            
            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);
            
            $paymentMethods = $query->orderBy('payment_method')
                             ->skip(($page - 1) * $limit)
                             ->take($limit)
                             ->get();
            
            return response()->json([
                'success' => true,
                'data' => $paymentMethods,
                'pagination' => [
                    'current_page' => $page,
                    'total_pages' => $totalPages,
                    'total_items' => $totalItems,
                    'items_per_page' => $limit,
                    'has_next' => $page < $totalPages,
                    'has_prev' => $page > 1
                ]
            ]);
            
        } catch (\Exception $e) {
            Log::error('PaymentMethod API Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching payment methods: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'payment_method' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($orgId, $isGlobalAdmin) {
                        $existsQuery = PaymentMethod::where('payment_method', $value);
                        if (!$isGlobalAdmin) {
                            if ($orgId) {
                                $existsQuery->where('organization_id', $orgId);
                            } else {
                                $existsQuery->whereNull('organization_id');
                            }
                        } else {
                            $existsQuery->whereNull('organization_id');
                        }
                        
                        if ($existsQuery->exists()) {
                            $fail('The payment method has already been taken.');
                        }
                    },
                ],
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }
            
            $paymentMethod = new PaymentMethod();
            $paymentMethod->payment_method = $request->input('payment_method');
            $paymentMethod->organization_id = $orgId;
            $userId = $this->resolveUserId($request);
            $paymentMethod->created_by_user_id = $userId;
            $paymentMethod->updated_by_user_id = $userId;
            $paymentMethod->save();
            
            // Log Activity
            ActivityLog::log(
                'Payment Method Created',
                "New Payment Method created: {$paymentMethod->payment_method} by " . (auth()->user()->email ?? 'System'),
                'info',
                [
                    'resource_type' => 'PaymentMethod',
                    'resource_id' => $paymentMethod->id,
                    'additional_data' => $paymentMethod->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Payment method added successfully',
                'data' => $paymentMethod
            ], 201);
            
        } catch (\Exception $e) {
            Log::error('PaymentMethod Store Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding payment method: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $paymentMethod = PaymentMethod::find($id);
            
            if (!$paymentMethod) {
                return response()->json([
                    'success' => false,
                    'message' => 'Payment method not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($paymentMethod->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to payment method'
                    ], 403);
                }
            } else {
                if ($paymentMethod->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized access to payment method'
                    ], 403);
                }
            }
            
            return response()->json([
                'success' => true,
                'data' => $paymentMethod
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching payment method: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            $validator = Validator::make($request->all(), [
                'payment_method' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($id, $orgId, $isGlobalAdmin) {
                        $existsQuery = PaymentMethod::where('payment_method', $value)->where('id', '!=', $id);
                        if (!$isGlobalAdmin) {
                            if ($orgId) {
                                $existsQuery->where('organization_id', $orgId);
                            } else {
                                $existsQuery->whereNull('organization_id');
                            }
                        } else {
                            $existsQuery->whereNull('organization_id');
                        }
                        
                        if ($existsQuery->exists()) {
                            $fail('The payment method has already been taken.');
                        }
                    },
                ],
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $paymentMethod = PaymentMethod::find($id);
            if (!$paymentMethod) {
                return response()->json([
                    'success' => false,
                    'message' => 'Payment method not found'
                ], 404);
            }

            // Authorization check
            if (!$isGlobalAdmin) {
                if ($paymentMethod->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this payment method'
                    ], 403);
                }
            } else {
                if ($paymentMethod->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to update this payment method'
                    ], 403);
                }
            }
            
            $paymentMethod->payment_method = $request->input('payment_method');
            $paymentMethod->updated_by_user_id = $this->resolveUserId($request);
            $paymentMethod->save();
            
            // Log Activity
            ActivityLog::log(
                'Payment Method Updated',
                "Payment Method updated: {$paymentMethod->payment_method} (ID: {$id}) by " . (auth()->user()->email ?? 'System'),
                'info',
                [
                    'resource_type' => 'PaymentMethod',
                    'resource_id' => $id,
                    'additional_data' => $paymentMethod->toArray()
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Payment method updated successfully',
                'data' => $paymentMethod
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating payment method: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $paymentMethod = PaymentMethod::find($id);
            if (!$paymentMethod) {
                return response()->json([
                    'success' => false,
                    'message' => 'Payment method not found'
                ], 404);
            }

            // Authorization check
            $orgId = $this->resolveUserOrgId(request());
            $isGlobalAdmin = $this->isGlobalAdmin(request());
            if (!$isGlobalAdmin) {
                if ($paymentMethod->organization_id != $orgId) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this payment method'
                    ], 403);
                }
            } else {
                if ($paymentMethod->organization_id !== null) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unauthorized to delete this payment method'
                    ], 403);
                }
            }
            
            $paymentMethodData = $paymentMethod->toArray();
            $paymentMethod->delete();
            
            // Log Activity
            ActivityLog::log(
                'Payment Method Deleted',
                "Payment Method deleted: {$paymentMethodData['payment_method']} (ID: {$id}) by " . (auth()->user()->email ?? 'System'),
                'warning',
                [
                    'resource_type' => 'PaymentMethod',
                    'resource_id' => $id,
                    'additional_data' => $paymentMethodData
                ]
            );
            
            return response()->json([
                'success' => true,
                'message' => 'Payment method permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting payment method: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics(Request $request)
    {
        try {
            $query = PaymentMethod::query();
            
            $orgId = $this->resolveUserOrgId($request);
            $isGlobalAdmin = $this->isGlobalAdmin($request);

            if (!$isGlobalAdmin) {
                if ($orgId) {
                    $query->where('organization_id', $orgId);
                } else {
                    $query->whereNull('organization_id');
                }
            } else {
                $query->whereNull('organization_id');
            }

            $totalPaymentMethods = $query->count();
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_payment_methods' => $totalPaymentMethods
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }
}
