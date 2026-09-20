<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InstallmentSchedule;
use App\Models\Installment;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class InstallmentScheduleApiController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        try {
            $query = InstallmentSchedule::with(['installment.billingAccount', 'invoice']);

            if ($request->has('installment_id')) {
                $query->where('installment_id', $request->installment_id);
            }

            if ($request->has('status')) {
                $query->where('status', $request->status);
            }

            $schedules = $query->orderBy('installment_no', 'asc')->get();

            return response()->json([
                'success' => true,
                'data' => $schedules,
                'count' => $schedules->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching installment schedules: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch installment schedules',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function generateSchedules(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'installment_id' => 'required|exists:installments,id'
            ]);

            $installment = Installment::findOrFail($validated['installment_id']);

            DB::beginTransaction();

            $existingSchedules = InstallmentSchedule::where('installment_id', $installment->id)->count();
            
            if ($existingSchedules > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Schedules already exist for this installment'
                ], 400);
            }

            $startDate = Carbon::parse($installment->start_date);
            $schedules = [];

            for ($i = 1; $i <= $installment->months_to_pay; $i++) {
                $dueDate = $startDate->copy()->addMonths($i - 1);
                
                $schedule = InstallmentSchedule::create([
                    'installment_id' => $installment->id,
                    'installment_no' => $i,
                    'due_date' => $dueDate,
                    'amount' => $installment->monthly_payment,
                    'status' => 'pending',
                    'created_by' => $request->user()->id ?? 1
                ]);

                $schedules[] = $schedule;
            }

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => "Generated {$installment->months_to_pay} payment schedules",
                'data' => $schedules
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error generating installment schedules: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to generate installment schedules',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $schedule = InstallmentSchedule::with(['installment.billingAccount', 'invoice'])->findOrFail($id);

            return response()->json([
                'success' => true,
                'data' => $schedule
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Installment schedule not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $schedule = InstallmentSchedule::findOrFail($id);

            $validated = $request->validate([
                'due_date' => 'sometimes|date',
                'amount' => 'sometimes|numeric|min:0',
                'status' => 'sometimes|in:pending,paid,overdue',
                'invoice_id' => 'sometimes|exists:invoices,id'
            ]);

            $validated['updated_by'] = $request->user()->id ?? 1;

            $schedule->update($validated);

            return response()->json([
                'success' => true,
                'message' => 'Installment schedule updated successfully',
                'data' => $schedule
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating installment schedule: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update installment schedule',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getByAccount($accountId): JsonResponse
    {
        try {
            $schedules = InstallmentSchedule::whereHas('installment', function($query) use ($accountId) {
                $query->where('account_id', $accountId);
            })
            ->with(['installment', 'invoice'])
            ->orderBy('due_date', 'asc')
            ->get();

            return response()->json([
                'success' => true,
                'data' => $schedules,
                'count' => $schedules->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching schedules by account: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch schedules',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
