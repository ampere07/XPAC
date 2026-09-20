<?php

namespace App\Http\Controllers;

use App\Models\Group;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Services\ActivityLogService;

class GroupController extends Controller
{
    public function index()
    {
        try {
            $groups = Group::with(['users', 'organization'])->get();
            return response()->json([
                'success' => true,
                'data' => $groups
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch groups',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'group_name' => 'required|string|max:255',
            'org_id' => 'nullable|integer|exists:organizations,id',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $group = Group::create([
                'group_name' => $request->group_name,
                'fb_page_link' => $request->fb_page_link,
                'fb_messenger_link' => $request->fb_messenger_link,
                'template' => $request->template,
                'company_name' => $request->company_name,
                'portal_url' => $request->portal_url,
                'hotline' => $request->hotline,
                'email' => $request->email,
                'org_id' => $request->org_id && $request->org_id > 0 ? $request->org_id : null,
            ]);

            // Try to log group creation activity (but don't fail if logging fails)
            try {
                ActivityLogService::groupCreated(
                    null, // For now, no authenticated user
                    $group,
                    ['created_by' => 'system']
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log group creation activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Group created successfully',
                'data' => $group->load('organization')
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to create group',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $group = Group::with(['users', 'organization'])->findOrFail($id);
            return response()->json([
                'success' => true,
                'data' => $group
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Group not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'group_name' => 'sometimes|string|max:255',
            'org_id' => 'sometimes|nullable|integer|exists:organizations,id',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $group = Group::findOrFail($id);
            $oldData = $group->toArray();
            $group->update($request->only([
                'group_name',
                'fb_page_link',
                'fb_messenger_link',
                'template',
                'company_name',
                'portal_url',
                'hotline',
                'email',
                'org_id'
            ]));

            // Try to log group update activity (but don't fail if logging fails)
            try {
                $changes = array_diff_assoc($request->only([
                    'group_name',
                    'fb_page_link',
                    'fb_messenger_link',
                    'template',
                    'company_name',
                    'portal_url',
                    'hotline',
                    'email',
                    'org_id'
                ]), $oldData);
                ActivityLogService::groupUpdated(
                    null, // For now, no authenticated user
                    $group,
                    $changes
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log group update activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Group updated successfully',
                'data' => $group->load('organization')
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update group',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $group = Group::findOrFail($id);
            $groupName = $group->group_name;
            $group->delete();

            // Try to log group deletion activity (but don't fail if logging fails)
            try {
                ActivityLogService::groupDeleted(
                    null, // For now, no authenticated user
                    $id,
                    $groupName
                );
            } catch (\Exception $logError) {
                \Log::warning('Failed to log group deletion activity: ' . $logError->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Group deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete group',
                'error' => $e->getMessage()
            ], 500);
        }
    }


}
