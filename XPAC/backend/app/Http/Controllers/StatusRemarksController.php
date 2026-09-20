<?php

namespace App\Http\Controllers;

use App\Models\StatusRemarksList;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class StatusRemarksController extends Controller
{
    public function index()
    {
        try {
            $statusRemarks = StatusRemarksList::orderBy('status_remarks', 'asc')->get();
                
            return response()->json([
                'success' => true,
                'data' => $statusRemarks
            ]);
        } catch (\Exception $e) {
            \Log::error('Status Remarks Index Error: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch status remarks',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'status_remarks' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userIdentifier = $request->input('email_address') ?? (\Auth::check() ? \Auth::user()->email_address : null);

            $statusRemark = StatusRemarksList::create([
                'status_remarks' => $request->status_remarks,
                'created_by_user' => $userIdentifier,
                'updated_by_user' => $userIdentifier
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Status remark created successfully',
                'data' => $statusRemark
            ], 201);
        } catch (\Exception $e) {
            \Log::error('Status Remark Store Error: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            \Log::error('Request data: ' . json_encode($request->all()));
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to create status remark',
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $statusRemark = StatusRemarksList::findOrFail($id);
            
            return response()->json([
                'success' => true,
                'data' => $statusRemark
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Status remark not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'status_remarks' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $userIdentifier = $request->input('email_address') ?? (\Auth::check() ? \Auth::user()->email_address : null);

            $statusRemark = StatusRemarksList::findOrFail($id);
            
            $statusRemark->update([
                'status_remarks' => $request->status_remarks,
                'updated_by_user' => $userIdentifier
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Status remark updated successfully',
                'data' => $statusRemark->fresh()
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update status remark',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $statusRemark = StatusRemarksList::findOrFail($id);
            $statusRemark->delete();

            return response()->json([
                'success' => true,
                'message' => 'Status remark deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete status remark',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
