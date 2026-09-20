<?php

namespace App\Http\Controllers;

use App\Models\EmailTemplate;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class EmailTemplateController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $templates = EmailTemplate::orderBy('Template_Code')->get();
            
            return response()->json([
                'success' => true,
                'data' => $templates,
                'count' => $templates->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching email templates', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch email templates',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'Template_Code' => 'nullable|string|max:50|unique:email_templates,Template_Code',
                'Subject_Line' => 'nullable|string|max:150',
                'cc' => 'nullable|string|max:255',
                'bcc' => 'nullable|string|max:255',
                'email_sender' => 'nullable|string|max:255',
                'sender_name' => 'nullable|string|max:255',
                'reply_to' => 'nullable|string|max:255',
                'Body_HTML' => 'nullable|string',
                'Description' => 'nullable|string|max:255',
                'Is_Active' => 'nullable|boolean',
                'email_body' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            Log::info('Creating email template', [
                'data' => $request->except(['Body_HTML'])
            ]);

            $templateCode = $request->input('Template_Code');
            if (empty($templateCode)) {
                $templateCode = uniqid('TPL_');
            }

            $template = EmailTemplate::create([
                'Template_Code' => $templateCode,
                'Subject_Line' => $request->input('Subject_Line'),
                'cc' => $request->input('cc'),
                'bcc' => $request->input('bcc'),
                'email_sender' => $request->input('email_sender'),
                'sender_name' => $request->input('sender_name'),
                'reply_to' => $request->input('reply_to'),
                'Body_HTML' => $request->input('Body_HTML'),
                'Description' => $request->input('Description'),
                'Is_Active' => $request->input('Is_Active', 1),
                'email_body' => $request->input('email_body')
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Email template created successfully',
                'data' => $template
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating email template', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create email template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($templateCode): JsonResponse
    {
        try {
            $template = EmailTemplate::where('Template_Code', $templateCode)->first();
            
            if (!$template) {
                return response()->json([
                    'success' => false,
                    'message' => 'Email template not found'
                ], 404);
            }

            return response()->json([
                'success' => true,
                'data' => $template
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching email template', [
                'template_code' => $templateCode,
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch email template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $templateCode): JsonResponse
    {
        try {
            $template = EmailTemplate::where('Template_Code', $templateCode)->first();
            
            if (!$template) {
                return response()->json([
                    'success' => false,
                    'message' => 'Email template not found'
                ], 404);
            }

            $validator = Validator::make($request->all(), [
                'Subject_Line' => 'nullable|string|max:150',
                'cc' => 'nullable|string|max:255',
                'bcc' => 'nullable|string|max:255',
                'email_sender' => 'nullable|string|max:255',
                'sender_name' => 'nullable|string|max:255',
                'reply_to' => 'nullable|string|max:255',
                'Body_HTML' => 'nullable|string',
                'Description' => 'nullable|string|max:255',
                'Is_Active' => 'nullable|boolean',
                'email_body' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            Log::info('Updating email template', [
                'template_code' => $templateCode,
                'data' => $request->except(['Body_HTML'])
            ]);

            $updateData = [];

            if ($request->has('Subject_Line')) {
                $updateData['Subject_Line'] = $request->input('Subject_Line');
            }
            if ($request->has('cc')) {
                $updateData['cc'] = $request->input('cc');
            }
            if ($request->has('bcc')) {
                $updateData['bcc'] = $request->input('bcc');
            }
            if ($request->has('email_sender')) {
                $updateData['email_sender'] = $request->input('email_sender');
            }
            if ($request->has('sender_name')) {
                $updateData['sender_name'] = $request->input('sender_name');
            }
            if ($request->has('reply_to')) {
                $updateData['reply_to'] = $request->input('reply_to');
            }
            if ($request->has('Body_HTML')) {
                $updateData['Body_HTML'] = $request->input('Body_HTML');
            }
            if ($request->has('Description')) {
                $updateData['Description'] = $request->input('Description');
            }
            if ($request->has('Is_Active')) {
                $updateData['Is_Active'] = $request->input('Is_Active');
            }
            if ($request->has('email_body')) {
                $updateData['email_body'] = $request->input('email_body');
            }

            $template->update($updateData);

            return response()->json([
                'success' => true,
                'message' => 'Email template updated successfully',
                'data' => $template->fresh()
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating email template', [
                'template_code' => $templateCode,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update email template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($templateCode): JsonResponse
    {
        try {
            $template = EmailTemplate::where('Template_Code', $templateCode)->first();
            
            if (!$template) {
                return response()->json([
                    'success' => false,
                    'message' => 'Email template not found'
                ], 404);
            }

            Log::info('Deleting email template', [
                'template_code' => $template->Template_Code
            ]);

            $template->delete();

            return response()->json([
                'success' => true,
                'message' => 'Email template deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting email template', [
                'template_code' => $templateCode,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete email template',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function toggleActive(Request $request, $templateCode): JsonResponse
    {
        try {
            $template = EmailTemplate::where('Template_Code', $templateCode)->first();
            
            if (!$template) {
                return response()->json([
                    'success' => false,
                    'message' => 'Email template not found'
                ], 404);
            }

            $template->Is_Active = !$template->Is_Active;
            $template->save();

            Log::info('Toggled email template active status', [
                'template_code' => $templateCode,
                'new_status' => $template->Is_Active
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Template status updated successfully',
                'data' => $template
            ]);
        } catch (\Exception $e) {
            Log::error('Error toggling template status', [
                'template_code' => $templateCode,
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to update template status',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

