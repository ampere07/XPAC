<?php

namespace App\Http\Controllers;

use App\Models\PPPoEUsernamePattern;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class PPPoEController extends Controller
{
    public function getPatterns(Request $request): JsonResponse
    {
        try {
            $query = PPPoEUsernamePattern::query();
            
            if ($request->has('pattern_type')) {
                $query->byType($request->pattern_type);
            }
            
            $patterns = $query->orderBy('pattern_type')->get();
            
            return response()->json([
                'success' => true,
                'data' => $patterns
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching PPPoE patterns', [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch PPPoE patterns',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getPattern($id): JsonResponse
    {
        try {
            $pattern = PPPoEUsernamePattern::findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $pattern
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Pattern not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function createPattern(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'pattern_name' => 'required|string|max:255',
                'pattern_type' => 'required|in:username,password',
                'sequence' => 'required|array|min:1',
                'sequence.*.id' => 'required|string',
                'sequence.*.type' => 'required|string',
                'sequence.*.label' => 'required|string',
                'created_by' => 'nullable|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $existingPattern = PPPoEUsernamePattern::where('pattern_type', $request->pattern_type)->first();
            
            if ($existingPattern) {
                $existingPattern->update([
                    'pattern_name' => $request->pattern_name,
                    'sequence' => $request->sequence,
                    'updated_by' => $request->created_by ?? 'system'
                ]);

                Log::info('PPPoE pattern updated (from create endpoint)', [
                    'pattern_id' => $existingPattern->id,
                    'pattern_type' => $existingPattern->pattern_type,
                    'pattern_name' => $existingPattern->pattern_name,
                    'action' => 'update_existing'
                ]);

                return response()->json([
                    'success' => true,
                    'message' => "Existing {$request->pattern_type} pattern updated successfully",
                    'data' => $existingPattern->fresh(),
                    'action' => 'updated'
                ], 200);
            }

            $pattern = PPPoEUsernamePattern::create([
                'pattern_name' => $request->pattern_name,
                'pattern_type' => $request->pattern_type,
                'sequence' => $request->sequence,
                'created_by' => $request->created_by ?? 'system',
                'updated_by' => $request->created_by ?? 'system'
            ]);

            Log::info('PPPoE pattern created', [
                'pattern_id' => $pattern->id,
                'pattern_type' => $pattern->pattern_type,
                'pattern_name' => $pattern->pattern_name,
                'action' => 'created'
            ]);

            return response()->json([
                'success' => true,
                'message' => 'PPPoE pattern created successfully',
                'data' => $pattern,
                'action' => 'created'
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating/updating PPPoE pattern', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create/update PPPoE pattern',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function updatePattern(Request $request, $id): JsonResponse
    {
        try {
            $pattern = PPPoEUsernamePattern::findOrFail($id);

            $validator = Validator::make($request->all(), [
                'pattern_name' => 'sometimes|string|max:255',
                'pattern_type' => 'sometimes|in:username,password',
                'sequence' => 'sometimes|array|min:1',
                'sequence.*.id' => 'required_with:sequence|string',
                'sequence.*.type' => 'required_with:sequence|string',
                'sequence.*.label' => 'required_with:sequence|string',
                'updated_by' => 'nullable|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            if ($request->has('pattern_type') && $request->pattern_type !== $pattern->pattern_type) {
                $existingPattern = PPPoEUsernamePattern::where('pattern_type', $request->pattern_type)
                    ->where('id', '!=', $id)
                    ->first();
                
                if ($existingPattern) {
                    return response()->json([
                        'success' => false,
                        'message' => "A {$request->pattern_type} pattern already exists. Only one pattern per type is allowed.",
                        'existing_pattern' => $existingPattern
                    ], 409);
                }
            }

            $updateData = $request->only(['pattern_name', 'pattern_type', 'sequence']);
            $updateData['updated_by'] = $request->updated_by ?? 'system';

            $pattern->update($updateData);

            Log::info('PPPoE pattern updated', [
                'pattern_id' => $pattern->id,
                'pattern_type' => $pattern->pattern_type,
                'updated_fields' => array_keys($updateData)
            ]);

            return response()->json([
                'success' => true,
                'message' => 'PPPoE pattern updated successfully',
                'data' => $pattern->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating PPPoE pattern', [
                'pattern_id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update PPPoE pattern',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function deletePattern($id): JsonResponse
    {
        try {
            $pattern = PPPoEUsernamePattern::findOrFail($id);
            
            $patternType = $pattern->pattern_type;
            $patternName = $pattern->pattern_name;
            
            $pattern->delete();

            Log::info('PPPoE pattern deleted', [
                'pattern_id' => $id,
                'pattern_type' => $patternType,
                'pattern_name' => $patternName
            ]);

            return response()->json([
                'success' => true,
                'message' => 'PPPoE pattern deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting PPPoE pattern', [
                'pattern_id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete PPPoE pattern',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getAvailableTypes(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [
                'types' => PPPoEUsernamePattern::getAvailableTypes(),
                'pattern_options' => [
                    'username' => [
                        ['type' => 'first_name', 'label' => 'First Name'],
                        ['type' => 'first_name_initial', 'label' => 'First Name Initial'],
                        ['type' => 'middle_name', 'label' => 'Middle Name'],
                        ['type' => 'middle_name_initial', 'label' => 'Middle Name Initial'],
                        ['type' => 'last_name', 'label' => 'Last Name'],
                        ['type' => 'last_name_initial', 'label' => 'Last Name Initial'],
                        ['type' => 'mobile_number', 'label' => 'Mobile Number'],
                        ['type' => 'mobile_number_last_4', 'label' => 'Mobile Number (Last 4)'],
                        ['type' => 'mobile_number_last_6', 'label' => 'Mobile Number (Last 6)'],
                        ['type' => 'tech_input', 'label' => 'Tech Input'],
                    ],
                    'password' => [
                        ['type' => 'first_name', 'label' => 'First Name'],
                        ['type' => 'first_name_initial', 'label' => 'First Name Initial'],
                        ['type' => 'middle_name', 'label' => 'Middle Name'],
                        ['type' => 'middle_name_initial', 'label' => 'Middle Name Initial'],
                        ['type' => 'last_name', 'label' => 'Last Name'],
                        ['type' => 'last_name_initial', 'label' => 'Last Name Initial'],
                        ['type' => 'mobile_number', 'label' => 'Mobile Number'],
                        ['type' => 'mobile_number_last_4', 'label' => 'Mobile Number (Last 4)'],
                        ['type' => 'mobile_number_last_6', 'label' => 'Mobile Number (Last 6)'],
                        ['type' => 'random_4_digits', 'label' => 'Random 4 Digits'],
                        ['type' => 'random_6_digits', 'label' => 'Random 6 Digits'],
                        ['type' => 'random_letters_4', 'label' => 'Random 4 Letters'],
                        ['type' => 'random_letters_6', 'label' => 'Random 6 Letters'],
                        ['type' => 'random_alphanumeric_4', 'label' => 'Random 4 Alphanumeric'],
                        ['type' => 'random_alphanumeric_6', 'label' => 'Random 6 Alphanumeric'],
                        ['type' => 'custom_password', 'label' => 'Custom Password'],
                    ]
                ]
            ]
        ]);
    }

    public function savePattern(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'pattern_name' => 'required|string|max:255',
                'pattern_type' => 'required|in:username,password',
                'sequence' => 'required|array|min:1',
                'sequence.*.id' => 'required|string',
                'sequence.*.type' => 'required|string',
                'sequence.*.label' => 'required|string',
                'created_by' => 'nullable|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $existingPattern = PPPoEUsernamePattern::where('pattern_type', $request->pattern_type)->first();
            
            if ($existingPattern) {
                $existingPattern->update([
                    'pattern_name' => $request->pattern_name,
                    'sequence' => $request->sequence,
                    'updated_by' => $request->created_by ?? 'system'
                ]);

                Log::info('PPPoE pattern updated via save', [
                    'pattern_id' => $existingPattern->id,
                    'pattern_type' => $existingPattern->pattern_type,
                    'pattern_name' => $existingPattern->pattern_name
                ]);

                return response()->json([
                    'success' => true,
                    'message' => "{$request->pattern_type} pattern updated successfully",
                    'data' => $existingPattern->fresh(),
                    'action' => 'updated'
                ], 200);
            }

            $pattern = PPPoEUsernamePattern::create([
                'pattern_name' => $request->pattern_name,
                'pattern_type' => $request->pattern_type,
                'sequence' => $request->sequence,
                'created_by' => $request->created_by ?? 'system',
                'updated_by' => $request->created_by ?? 'system'
            ]);

            Log::info('PPPoE pattern created via save', [
                'pattern_id' => $pattern->id,
                'pattern_type' => $pattern->pattern_type,
                'pattern_name' => $pattern->pattern_name
            ]);

            return response()->json([
                'success' => true,
                'message' => "{$request->pattern_type} pattern created successfully",
                'data' => $pattern,
                'action' => 'created'
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error saving PPPoE pattern', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to save PPPoE pattern',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
