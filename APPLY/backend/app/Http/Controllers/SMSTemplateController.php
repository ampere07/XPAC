<?php

namespace App\Http\Controllers;

use App\Models\SMSTemplate;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class SMSTemplateController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $templates = SMSTemplate::orderBy('created_at', 'desc')->get();
            
            return response()->json([
                'success' => true,
                'data' => $templates,
                'count' => $templates->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching SMS templates: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch SMS templates',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $template = SMSTemplate::findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $template
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'SMS template not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'template_name' => 'required|string|max:255',
                'template_type' => 'required|string|max:255',
                'message_content' => 'required|string',
                'variables' => 'nullable',
                'is_active' => 'boolean'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $template = SMSTemplate::create($request->all());

            Log::info('SMS template created', [
                'id' => $template->id,
                'template_name' => $template->template_name
            ]);

            return response()->json([
                'success' => true,
                'message' => 'SMS template created successfully',
                'data' => $template
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating SMS template: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create SMS template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $template = SMSTemplate::findOrFail($id);

            $validator = Validator::make($request->all(), [
                'template_name' => 'required|string|max:255',
                'template_type' => 'required|string|max:255',
                'message_content' => 'required|string',
                'variables' => 'nullable',
                'is_active' => 'boolean'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $template->update($request->all());

            Log::info('SMS template updated', [
                'id' => $template->id,
                'template_name' => $template->template_name
            ]);

            return response()->json([
                'success' => true,
                'message' => 'SMS template updated successfully',
                'data' => $template
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating SMS template: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update SMS template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $template = SMSTemplate::findOrFail($id);
            $templateName = $template->template_name;
            
            $template->delete();

            Log::info('SMS template deleted', [
                'id' => $id,
                'template_name' => $templateName
            ]);

            return response()->json([
                'success' => true,
                'message' => 'SMS template deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting SMS template: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete SMS template',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
