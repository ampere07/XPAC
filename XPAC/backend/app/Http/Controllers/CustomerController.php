<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Models\BillingAccount;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;
use App\Events\CustomerViewingUpdate;
use App\Models\ActivityLog;
use App\Models\AuditTrailLog;
class CustomerController extends Controller
{
    public function broadcastViewing(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'customer_id' => 'required|string',
                'action' => 'required|string|in:started_viewing,stopped_viewing'
            ]);

            $username = Auth::user()->username ?? Auth::user()->name ?? 'Unknown User';

            \Log::info('[Presence] Customer broadcast:', [
                'customer_id' => $validated['customer_id'],
                'username' => $username,
                'action' => $validated['action']
            ]);

            event(new CustomerViewingUpdate(
                $validated['customer_id'],
                $username,
                $validated['action']
            ));

            return response()->json([
                'success' => true,
                'message' => 'Viewing status broadcasted successfully'
            ]);
        } catch (\Exception $e) {
            \Log::error('Error broadcasting viewing status: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to broadcast viewing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function index(): JsonResponse
    {
        try {
            // Pre-calculate transactions total for 'done' status
            $transactions = \DB::table('transactions')
                ->where('status', 'done')
                ->select('account_no', \DB::raw('SUM(received_payment) as total'))
                ->groupBy('account_no')
                ->get()
                ->pluck('total', 'account_no');

            // Pre-calculate payment portal logs total for 'success' status
            $portalLogs = \DB::table('payment_portal_logs')
                ->where('status', 'success')
                ->select('account_id', \DB::raw('SUM(total_amount) as total'))
                ->groupBy('account_id')
                ->get()
                ->pluck('total', 'account_id');

            $customers = Customer::with(['group', 'billingAccounts.onlineStatus'])
                ->orderBy('created_at', 'desc')
                ->get()
                ->map(function ($customer) use ($transactions, $portalLogs) {
                    $totalPaid = 0;
                    foreach ($customer->billingAccounts as $account) {
                        $accNo = $account->account_no;
                        $totalPaid += ($transactions[$accNo] ?? 0) + ($portalLogs[$accNo] ?? 0);
                    }

                    return [
                        'id' => $customer->id,
                        'first_name' => $customer->first_name,
                        'middle_initial' => $customer->middle_initial,
                        'last_name' => $customer->last_name,
                        'full_name' => $customer->full_name,
                        'email_address' => $customer->email_address,
                        'contact_number_primary' => $customer->contact_number_primary,
                        'contact_number_secondary' => $customer->contact_number_secondary,
                        'address' => $customer->address,
                        'location' => $customer->location,
                        'barangay' => $customer->barangay,
                        'city' => $customer->city,
                        'region' => $customer->region,
                        'address_coordinates' => $customer->address_coordinates,
                        'housing_status' => $customer->housing_status,
                        // Shown as a name; the id travels beside it so an edit form can
                        // write the same referral back instead of turning it into a name.
                        'referred_by' => \App\Support\AgentReferral::displayName($customer->referred_by),
                        'referred_by_agent_id' => \App\Support\AgentReferral::agentId($customer->referred_by),
                        'desired_plan' => $customer->desired_plan,
                        'house_front_picture_url' => $customer->house_front_picture_url,
                        'group_id' => $customer->group_id,
                        'group_name' => $customer->group_name,
                        'groupName' => $customer->group_name,
                        'total_paid' => $totalPaid,
                        'created_by' => $customer->created_by,
                        'updated_by' => $customer->updated_by,
                        'created_at' => $customer->created_at?->format('Y-m-d H:i:s'),
                        'updated_at' => $customer->updated_at?->format('Y-m-d H:i:s'),
                        'session_group' => $customer->billingAccounts->first()?->onlineStatus?->session_group,
                    ];
                });

            return response()->json([
                'success' => true,
                'data' => $customers,
                'count' => $customers->count()
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching customers: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch customers',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $customer = Customer::with(['group', 'billingAccounts.onlineStatus'])->findOrFail($id);

            $data = [
                'id' => $customer->id,
                'first_name' => $customer->first_name,
                'middle_initial' => $customer->middle_initial,
                'last_name' => $customer->last_name,
                'full_name' => $customer->full_name,
                'email_address' => $customer->email_address,
                'contact_number_primary' => $customer->contact_number_primary,
                'contact_number_secondary' => $customer->contact_number_secondary,
                'address' => $customer->address,
                'location' => $customer->location,
                'barangay' => $customer->barangay,
                'city' => $customer->city,
                'region' => $customer->region,
                'address_coordinates' => $customer->address_coordinates,
                'housing_status' => $customer->housing_status,
                // Shown as a name; the id travels beside it so an edit form can
                // write the same referral back instead of turning it into a name.
                'referred_by' => \App\Support\AgentReferral::displayName($customer->referred_by),
                'referred_by_agent_id' => \App\Support\AgentReferral::agentId($customer->referred_by),
                'desired_plan' => $customer->desired_plan,
                'house_front_picture_url' => $customer->house_front_picture_url,
                'group_id' => $customer->group_id,
                'group_name' => $customer->group_name,
                'groupName' => $customer->group_name,
                'created_by' => $customer->created_by,
                'updated_by' => $customer->updated_by,
                'created_at' => $customer->created_at?->format('Y-m-d H:i:s'),
                'updated_at' => $customer->updated_at?->format('Y-m-d H:i:s'),
                'billing_accounts' => $customer->billingAccounts->map(function ($account) {
                    return [
                        'id' => $account->id,
                        'account_no' => $account->account_no,
                        'billing_status_id' => $account->billing_status_id,
                        'account_balance' => $account->account_balance,
                        'session_group' => $account->onlineStatus?->session_group,
                    ];
                }),
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching customer: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Customer not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'first_name' => 'required|string|max:255',
                'middle_initial' => 'nullable|string|max:10',
                'last_name' => 'required|string|max:255',
                'email_address' => 'nullable|email|max:255',
                'contact_number_primary' => 'required|string|max:20',
                'contact_number_secondary' => 'nullable|string|max:20',
                'address' => 'required|string',
                'location' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string|max:255',
                'housing_status' => 'nullable|string|max:255',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'house_front_picture_url' => 'nullable|string|max:500',
                'group_id' => 'nullable|exists:groups,id',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $customer = Customer::create($request->all());

            return response()->json([
                'success' => true,
                'message' => 'Customer created successfully',
                'data' => $customer
            ], 201);
        } catch (\Exception $e) {
            \Log::error('Error creating customer: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to create customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id): JsonResponse
    {
        try {
            $customer = Customer::findOrFail($id);

            $validator = Validator::make($request->all(), [
                'first_name' => 'sometimes|required|string|max:255',
                'middle_initial' => 'nullable|string|max:10',
                'last_name' => 'sometimes|required|string|max:255',
                'email_address' => 'nullable|email|max:255',
                'contact_number_primary' => 'sometimes|required|string|max:20',
                'contact_number_secondary' => 'nullable|string|max:20',
                'address' => 'sometimes|required|string',
                'location' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string|max:255',
                'housing_status' => 'nullable|string|max:255',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'house_front_picture_url' => 'nullable|string|max:500',
                'group_id' => 'nullable|exists:groups,id',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $customer->update($request->all());

            // Keep the portal login in step with the number.
            //
            // This endpoint used to write contact_number_primary and stop there,
            // while the portal password is that number — so editing a customer
            // here silently locked them out of the portal, with the stored hash
            // still holding the previous number and nothing to indicate it.
            \App\Support\PortalPassword::sync($customer);

            // Broadcast customer-updated event
            $this->broadcastCustomerUpdated($customer);

            return response()->json([
                'success' => true,
                'message' => 'Customer updated successfully',
                'data' => $customer
            ]);
        } catch (\Exception $e) {
            \Log::error('Error updating customer: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to update customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    private function broadcastCustomerUpdated($customer)
    {
        try {
            $billingAccount = BillingAccount::where('customer_id', $customer->id)->first();
            $accountNo = $billingAccount ? $billingAccount->account_no : null;

            event(new \App\Events\CustomerUpdated([
                'account_no' => $accountNo,
                'customer_id' => $customer->id,
                'type' => 'customer_updated',
                'title' => 'Customer Updated',
                'message' => 'Customer data has been updated',
                'timestamp' => now()->timestamp,
                'formatted_date' => now()->format('Y-m-d h:i:s A')
            ]));
        } catch (\Exception $e) {
            Log::warning('Failed to broadcast customer update via Soketi', [
                'customer_id' => $customer->id,
                'error' => $e->getMessage()
            ]);
        }
    }

    public function destroy($id): JsonResponse
    {
        try {
            $customer = Customer::findOrFail($id);
            $customer->delete();

            return response()->json([
                'success' => true,
                'message' => 'Customer deleted successfully'
            ]);
        } catch (\Exception $e) {
            \Log::error('Error deleting customer: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete customer',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function uploadImages(Request $request, $id): JsonResponse
    {
        try {
            $customer = Customer::find($id);

            if (!$customer) {
                $customer = Customer::where('account_no', $id)
                    ->orWhereHas('billingAccounts', function ($q) use ($id) {
                        $q->where('account_no', $id);
                    })
                    ->first();
            }

            if (!$customer) {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to upload images',
                    'error' => "No customer found with ID or account number: {$id}"
                ], 404);
            }

            $driveService = resolve(\App\Services\GoogleDriveService::class);

            $folderName = $request->input('folder_name', "(customer) " . trim($customer->first_name . " " . $customer->last_name));
            $folderId = $driveService->findFolder($folderName) ?? $driveService->createFolder($folderName);

            $imageUrls = [];
            $fields = [
                'proof_of_billing' => 'proof_of_billing_url',
                'government_valid_id' => 'government_valid_id_url',
                'second_government_valid_id' => 'second_government_valid_id_url',
                'house_front_picture' => 'house_front_picture_url',
                'document_attachment' => 'document_attachment_url',
                'other_isp_bill' => 'other_isp_bill_url'
            ];

            foreach ($fields as $requestKey => $dbColumn) {
                if ($request->hasFile($requestKey)) {
                    $file = $request->file($requestKey);
                    $fileName = $requestKey . '_' . time() . '.' . $file->getClientOriginalExtension();
                    $imageUrls[$dbColumn] = $driveService->uploadFile(
                        $file,
                        $folderId,
                        $fileName,
                        $file->getMimeType()
                    );
                }
            }

            if (!empty($imageUrls)) {
                $oldData = [];
                $newData = [];
                foreach ($imageUrls as $dbColumn => $newUrl) {
                    $oldData[$dbColumn] = $customer->$dbColumn;
                    $newData[$dbColumn] = $newUrl;
                }

                \DB::transaction(function () use ($customer, $imageUrls, $oldData, $newData) {
                    $customer->update($imageUrls);

                    // Audit Trail Log
                    $userEmail = auth()->user()?->email ?? 'System';
                    AuditTrailLog::create([
                        'old_details' => [
                            'type' => 'customers',
                            'id' => $customer->id,
                            'data' => $oldData
                        ],
                        'new_details' => [
                            'type' => 'customers',
                            'id' => $customer->id,
                            'data' => $newData
                        ],
                        'created_by_user' => $userEmail,
                        'updated_by_user' => $userEmail
                    ]);

                    // Log Activity
                    ActivityLog::log(
                        'Customer Attachments Uploaded',
                        "Uploaded " . count($imageUrls) . " attachments for Customer #{$customer->id}",
                        'info',
                        [
                            'resource_type' => 'Customer',
                            'resource_id' => $customer->id,
                            'additional_data' => array_keys($imageUrls)
                        ]
                    );
                });
            }

            return response()->json([
                'success' => true,
                'message' => 'Images uploaded successfully',
                'data' => $imageUrls
            ]);

        } catch (\Exception $e) {
            \Log::error('CustomerController uploadImages error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to upload images',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}



