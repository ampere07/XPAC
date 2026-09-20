<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdvancedPayment;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class AdvancedPaymentApiController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        try {
            $query = AdvancedPayment::with(['billingAccount.customer']);

            if ($request->has('account_id')) {
                $query->where('account_id', $request->account_id);
            }

            if ($request->has('status')) {
                $query->where('status', $request->status);
            }

            if ($request->has('payment_month')) {
                $query->where('payment_month', $request->payment_month);
            }

            $payments = $query->orderBy('created_at', 'desc')->get();

            return response()->json([
                'success' => true,
                'data' => $payments,
                'count' => $payments->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching advanced payments: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch advanced payments',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'account_id' => 'required|exists:billing_accounts,id',
                'payment_amount' => 'required|numeric|min:0',
                'payment_month' => 'required|string',
                'payment_date' => 'required|date',
                'remarks' => 'nullable|string'
            ]);

            $validated['status'] = 'Unused';
            $validated['created_by_user_id'] = $request->user()->id ?? 1;
            $validated['updated_by_user_id'] = $request->user()->id ?? 1;

            $payment = AdvancedPayment::create($validated);

            return response()->json([
                'success' => true,
                'message' => 'Advanced payment created successfully',
                'data' => $payment
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating advanced payment: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to create advanced payment',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $payment = AdvancedPayment::with(['billingAccount.customer'])->findOrFail($id);

            return response()->json([
                'success' => true,
                'data' => $payment
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Advanced payment not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $payment = AdvancedPayment::findOrFail($id);

            $validated = $request->validate([
                'payment_amount' => 'sometimes|numeric|min:0',
                'payment_month' => 'sometimes|string',
                'payment_date' => 'sometimes|date',
                'status' => 'sometimes|in:Unused,Used',
                'remarks' => 'nullable|string'
            ]);

            $validated['updated_by_user_id'] = $request->user()->id ?? 1;

            $payment->update($validated);

            return response()->json([
                'success' => true,
                'message' => 'Advanced payment updated successfully',
                'data' => $payment
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating advanced payment: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update advanced payment',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $payment = AdvancedPayment::findOrFail($id);
            $payment->delete();

            return response()->json([
                'success' => true,
                'message' => 'Advanced payment deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting advanced payment: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete advanced payment',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
