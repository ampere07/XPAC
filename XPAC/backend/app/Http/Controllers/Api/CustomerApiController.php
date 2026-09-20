<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class CustomerApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $query = Customer::with(['group', 'createdBy', 'updatedBy']);

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }
            
            if ($request->has('group_id')) {
                $query->where('group_id', $request->group_id);
            }
            
            if ($request->has('search')) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('first_name', 'like', "%{$search}%")
                      ->orWhere('last_name', 'like', "%{$search}%")
                      ->orWhere('email_address', 'like', "%{$search}%")
                      ->orWhere('contact_number_primary', 'like', "%{$search}%");
                });
            }
            
            $customers = $query->orderBy('created_at', 'desc')->get();
            
            return response()->json([
                'success' => true,
                'data' => $customers,
                'count' => $customers->count()
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching customers: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error fetching customers',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    public function show($id)
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $customer = Customer::with(['group', 'createdBy', 'updatedBy'])->findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $customer->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to customer record'
                ], 403);
            }
            
            return response()->json([
                'success' => true,
                'data' => $customer
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching customer: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Customer not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }
    
    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'first_name' => 'required|string|max:255',
                'middle_initial' => 'nullable|string|max:10',
                'last_name' => 'required|string|max:255',
                'email_address' => 'nullable|email|max:255',
                'contact_number_primary' => 'nullable|string|max:20',
                'contact_number_secondary' => 'nullable|string|max:20',
                'address' => 'nullable|string',
                'location' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string',
                'housing_status' => 'nullable|string|max:255',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'house_front_picture_url' => 'nullable|string',
                'group_id' => 'nullable|exists:groups,id',
                'created_by' => 'nullable|exists:users,id',
                'updated_by' => 'nullable|exists:users,id',
                'organization_id' => 'nullable|integer'
            ]);
            
            $authUser = auth()->user();
            if ($authUser && !isset($validated['organization_id'])) {
                $validated['organization_id'] = $authUser->organization_id;
            }
            
            $customer = Customer::create($validated);
            
            return response()->json([
                'success' => true,
                'message' => 'Customer created successfully',
                'data' => $customer
            ], 201);
        } catch (\Exception $e) {
            Log::error('Error creating customer: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error creating customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    public function update(Request $request, $id)
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $customer = Customer::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $customer->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update customers within your organization.'
                ], 403);
            }
            
            $validated = $request->validate([
                'first_name' => 'sometimes|required|string|max:255',
                'middle_initial' => 'nullable|string|max:10',
                'last_name' => 'sometimes|required|string|max:255',
                'email_address' => 'nullable|email|max:255',
                'contact_number_primary' => 'nullable|string|max:20',
                'contact_number_secondary' => 'nullable|string|max:20',
                'address' => 'nullable|string',
                'location' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string',
                'housing_status' => 'nullable|string|max:255',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'house_front_picture_url' => 'nullable|string',
                'group_id' => 'nullable|exists:groups,id',
                'updated_by' => 'nullable|exists:users,id'
            ]);
            
            $customer->update($validated);

            // The portal password is the primary contact number, so editing the
            // number here has to move the login with it. Without this the mobile
            // API silently locked the customer out of the portal, exactly as the
            // web endpoint used to.
            \App\Support\PortalPassword::sync($customer);

            return response()->json([
                'success' => true,
                'message' => 'Customer updated successfully',
                'data' => $customer
            ]);
        } catch (\Exception $e) {
            Log::error('Error updating customer: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error updating customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    public function destroy($id)
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $customer = Customer::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $customer->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only delete customers within your organization.'
                ], 403);
            }

            $customer->delete();
            
            return response()->json([
                'success' => true,
                'message' => 'Customer deleted successfully'
            ]);
        } catch (\Exception $e) {
            Log::error('Error deleting customer: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Error deleting customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
