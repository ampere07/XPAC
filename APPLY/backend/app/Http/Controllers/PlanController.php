<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class PlanController extends Controller
{
    private function getCurrentUserId()
    {
        $user = DB::table('users')->first();
        return $user ? $user->id : null;
    }

    public function index()
    {
        try {
            Log::info('=== PlanController index START ===');
            
            Log::info('Querying plan_list table');
            // This is the application form's plan list, so hidden plans are filtered out at the
            // source. The form filters again on its side, but that is a convenience — a plan the
            // applicant must not be able to pick never leaves the server in the first place.
            $plans = Plan::visibleInApplication()->orderBy('plan_name', 'asc')->get();
            Log::info('Plans fetched', ['count' => $plans->count()]);

            Log::info('=== PlanController index SUCCESS ===');
            return response()->json([
                'success' => true,
                'data' => $plans
            ]);

        } catch (\Exception $e) {
            Log::error('=== PlanController index ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Failed to retrieve plans',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            Log::info('=== PlanController show START ===', ['id' => $id]);
            
            $plan = Plan::findOrFail($id);
            Log::info('Plan found', ['plan' => $plan]);

            Log::info('=== PlanController show SUCCESS ===');
            return response()->json([
                'success' => true,
                'data' => $plan
            ]);

        } catch (\Exception $e) {
            Log::error('=== PlanController show ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());

            return response()->json([
                'success' => false,
                'message' => 'Plan not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request)
    {
        try {
            Log::info('=== PlanController store START ===', ['data' => $request->all()]);
            
            $validator = Validator::make($request->all(), [
                'plan_name' => 'required|string|max:255|unique:plan_list,plan_name',
                'description' => 'nullable|string',
                'price' => 'required|numeric|min:0',
                'show_in_application' => 'nullable|boolean',
            ]);

            if ($validator->fails()) {
                Log::warning('Validation failed', ['errors' => $validator->errors()]);
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $currentUserId = $this->getCurrentUserId();
            Log::info('Current user ID', ['user_id' => $currentUserId]);

            $plan = Plan::create([
                'plan_name' => $request->plan_name,
                'description' => $request->description,
                'price' => $request->price,
                // Visible unless explicitly hidden, matching the checkbox's default state.
                'show_in_application' => $request->boolean('show_in_application', true),
                'modified_by_user_id' => $currentUserId,
                'modified_date' => now(),
            ]);

            Log::info('Plan created', ['plan' => $plan]);
            Log::info('=== PlanController store SUCCESS ===');

            return response()->json([
                'success' => true,
                'message' => 'Plan created successfully',
                'data' => $plan
            ], 201);

        } catch (\Exception $e) {
            Log::error('=== PlanController store ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Failed to create plan',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            Log::info('=== PlanController update START ===', ['id' => $id, 'data' => $request->all()]);
            
            $plan = Plan::findOrFail($id);

            $validator = Validator::make($request->all(), [
                'plan_name' => 'sometimes|required|string|max:255',
                'description' => 'nullable|string',
                'price' => 'sometimes|required|numeric|min:0',
                'show_in_application' => 'sometimes|boolean',
            ]);

            if ($validator->fails()) {
                Log::warning('Validation failed', ['errors' => $validator->errors()]);
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $currentUserId = $this->getCurrentUserId();

            $plan->update(array_merge(
                $request->only(['plan_name', 'description', 'price']),
                // Only when sent, so an update that never mentions it leaves a hidden plan hidden.
                $request->has('show_in_application')
                    ? ['show_in_application' => $request->boolean('show_in_application')]
                    : [],
                [
                    'modified_by_user_id' => $currentUserId,
                    'modified_date' => now()
                ]
            ));

            Log::info('Plan updated', ['plan' => $plan]);
            Log::info('=== PlanController update SUCCESS ===');

            return response()->json([
                'success' => true,
                'message' => 'Plan updated successfully',
                'data' => $plan
            ]);

        } catch (\Exception $e) {
            Log::error('=== PlanController update ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Failed to update plan',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            Log::info('=== PlanController destroy START ===', ['id' => $id]);
            
            $plan = Plan::findOrFail($id);
            $plan->delete();

            Log::info('Plan deleted successfully');
            Log::info('=== PlanController destroy SUCCESS ===');

            return response()->json([
                'success' => true,
                'message' => 'Plan deleted successfully'
            ]);

        } catch (\Exception $e) {
            Log::error('=== PlanController destroy ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete plan',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
