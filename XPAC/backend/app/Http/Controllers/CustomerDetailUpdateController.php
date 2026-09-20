<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Models\BillingAccount;
use App\Models\TechnicalDetail;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Http;
use App\Models\ActivityLog;

class CustomerDetailUpdateController extends Controller
{
    /**
     * Unified update method dispatches based on editType
     */
    public function update(Request $request, $accountNo): JsonResponse
    {
        $editType = $request->input('editType');

        if ($editType === 'customer_details') {
            return $this->updateCustomerDetails($request, $accountNo);
        } elseif ($editType === 'billing_details') {
            return $this->updateBillingDetails($request, $accountNo);
        } elseif ($editType === 'technical_details') {
            return $this->updateTechnicalDetails($request, $accountNo);
        }

        return response()->json([
            'success' => false,
            'message' => 'Invalid or missing edit type'
        ], 400);
    }

    /**
     * Update customer details
     */
    public function updateCustomerDetails(Request $request, $accountNo): JsonResponse
    {
        try {
            $validated = $request->validate([
                'firstName' => 'required|string|max:255',
                'middleInitial' => 'nullable|string|max:10',
                'lastName' => 'required|string|max:255',
                'emailAddress' => 'nullable|string|max:255',
                'contactNumberPrimary' => 'required|string|max:50',
                'contactNumberSecondary' => 'nullable|string|max:50',
                'address' => 'required|string',
                'region' => 'required|string|max:255',
                'city' => 'required|string|max:255',
                'barangay' => 'required|string|max:255',
                'location' => 'nullable|string|max:255',
                'addressCoordinates' => 'nullable|string|max:255',
                'housingStatus' => 'nullable|string|max:255',
                'referredBy' => 'nullable|string|max:255',
                'groupName' => 'nullable|string|max:255',
                'houseFrontPicture' => 'nullable'
            ]);

            DB::beginTransaction();

            $billingAccount = BillingAccount::where('account_no', $accountNo)->firstOrFail();
            $customer = Customer::findOrFail($billingAccount->customer_id);

            // Capture old details before update
            $oldDetails = [
                'first_name' => $customer->first_name,
                'middle_initial' => $customer->middle_initial,
                'last_name' => $customer->last_name,
                'email_address' => $customer->email_address,
                'contact_number_primary' => $customer->contact_number_primary,
                'contact_number_secondary' => $customer->contact_number_secondary,
                'address' => $customer->address,
                'region' => $customer->region,
                'city' => $customer->city,
                'barangay' => $customer->barangay,
                'location' => $customer->location,
                'address_coordinates' => $customer->address_coordinates,
                'housing_status' => $customer->housing_status,
                'referred_by' => \App\Support\AgentReferral::displayName($customer->referred_by),
                'group_name' => $customer->group_name,
                'house_front_picture_url' => $customer->house_front_picture_url,
            ];

            $houseFrontPictureUrl = $customer->house_front_picture_url;

            // Handle house front picture upload if provided
            if ($request->hasFile('houseFrontPicture')) {
                $file = $request->file('houseFrontPicture');
                $houseFrontPictureUrl = $this->uploadToGoogleDrive($file, $accountNo);
            }

            $oldContact = $customer->contact_number_primary;
            $oldEmail = $customer->email_address;

            // Update customer record
            $customer->update([
                'first_name' => $validated['firstName'],
                'middle_initial' => $validated['middleInitial'] ?? $customer->middle_initial,
                'last_name' => $validated['lastName'],
                'email_address' => $validated['emailAddress'],
                // Trimmed: a stray space around the number is invisible in the UI
                // but was hashed verbatim into the portal password, locking the
                // customer out with a number that looked exactly right.
                'contact_number_primary' => trim($validated['contactNumberPrimary']),
                'contact_number_secondary' => isset($validated['contactNumberSecondary'])
                    ? trim($validated['contactNumberSecondary'])
                    : $customer->contact_number_secondary,
                'address' => $validated['address'],
                'region' => $validated['region'],
                'city' => $validated['city'],
                'barangay' => $validated['barangay'],
                'location' => $validated['location'] ?? $customer->location,
                'address_coordinates' => $validated['addressCoordinates'] ?? $customer->address_coordinates,
                'housing_status' => $validated['housingStatus'] ?? $customer->housing_status,
                'referred_by' => $validated['referredBy'] ?? $customer->referred_by,
                'group_name' => $validated['groupName'] ?? $customer->group_name,
                'house_front_picture_url' => $houseFrontPictureUrl,
            ]);

            if ($request->has('updatedBy')) {
                $customer->update(['updated_by' => $request->input('updatedBy')]);
            }

            // Sync with users table if found
            $user = User::where('username', $accountNo)->first();
            if ($user) {
                $userUpdate = [];

                // Keep contact_number and password_hash on the user in step with
                // the customer's primary number. The portal password convention is
                // that number, so the password follows it. contactNumberPrimary is
                // required, so it is never null.
                //
                // The condition is deliberately not "did the number change". An
                // account whose hash had already drifted from its number — written
                // by a path that did not sync, or hashed in a spelling nobody types
                // — could only be repaired by editing the contact number to
                // something different, which is why operators had taken to adding a
                // leading '0' and saving just to force a rehash. Rehashing whenever
                // the stored hash does not already verify the number repairs those
                // accounts on any save, with no edit to invent.
                $newContact = trim($validated['contactNumberPrimary']);
                $hashDrifted = \App\Support\PortalPassword::isCustomer($user)
                    && !\App\Support\PortalPassword::hashIsCurrent($newContact, $user->password_hash);

                if ($oldContact !== $newContact || $hashDrifted) {
                    $userUpdate['contact_number'] = $newContact;
                    // The mutator hashes this; store the canonical spelling so the
                    // same number written any other way still verifies.
                    $userUpdate['password_hash'] = \App\Support\PortalPassword::normalize($newContact);
                }

                // If email address changed, update email_address only. The email is never
                // the password - assigning it here locked customers out of the portal.
                if ($oldEmail !== ($validated['emailAddress'] ?? null)) {
                    $userUpdate['email_address'] = $validated['emailAddress'] ?? null;
                }

                if (!empty($userUpdate)) {
                    // A password_hash value here triggers the setPasswordHashAttribute mutator
                    $user->update($userUpdate);

                    Log::info('User account synced with updated customer details', [
                        'username' => $accountNo,
                        'updated_fields' => array_keys($userUpdate)
                    ]);
                }
            }

            // Capture new details after update
            $customer->refresh();
            $newDetails = [
                'first_name' => $customer->first_name,
                'middle_initial' => $customer->middle_initial,
                'last_name' => $customer->last_name,
                'email_address' => $customer->email_address,
                'contact_number_primary' => $customer->contact_number_primary,
                'contact_number_secondary' => $customer->contact_number_secondary,
                'address' => $customer->address,
                'region' => $customer->region,
                'city' => $customer->city,
                'barangay' => $customer->barangay,
                'location' => $customer->location,
                'address_coordinates' => $customer->address_coordinates,
                'housing_status' => $customer->housing_status,
                'referred_by' => \App\Support\AgentReferral::displayName($customer->referred_by),
                'group_name' => $customer->group_name,
                'house_front_picture_url' => $customer->house_front_picture_url,
            ];

            $changedOldDetails = [];
            $changedNewDetails = [];

            foreach ($oldDetails as $key => $oldValue) {
                $newValue = $newDetails[$key] ?? null;
                if ($oldValue !== $newValue) {
                    $changedOldDetails[$key] = $oldValue;
                    $changedNewDetails[$key] = $newValue;
                }
            }

            // details_update_logs is written by App\Observers\AccountDetailsObserver
            // when the model saves, so no entry is made here: doing both would
            // record every edit twice. The observer sees every changed column
            // rather than the hand-picked list above, and covers the paths that
            // update a customer without passing through this controller.

            // Log Activity
            ActivityLog::log(
                'Customer Details Updated',
                "Customer details updated for Account: {$accountNo}",
                'info',
                [
                    'resource_type' => 'Customer',
                    'resource_id' => $customer->id,
                    'additional_data' => [
                        'account_no' => $accountNo,
                        'updated_fields' => $validated
                    ]
                ]
            );

            DB::commit();

            Log::info('Customer details updated', [
                'account_no' => $accountNo,
                'customer_id' => $customer->id
            ]);

            $this->broadcastCustomerUpdated($accountNo, 'customer_details');

            return response()->json([
                'success' => true,
                'message' => 'Customer details updated successfully',
                'data' => $customer->fresh()
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Failed to update customer details', [
                'account_no' => $accountNo,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update customer details',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update billing details
     */
    public function updateBillingDetails(Request $request, $accountNo): JsonResponse
    {
        try {
            $validated = $request->validate([
                'billing_status_id' => 'nullable',
                'billing_day' => 'nullable|integer|min:0|max:31',
                'date_installed' => 'nullable|date',
                'vip_expiration' => 'nullable|date',
                'vip_remarks' => 'nullable|string'
            ]);

            DB::beginTransaction();

            $billingAccount = BillingAccount::where('account_no', $accountNo)->firstOrFail();

            // Capture old billing details before update
            $oldBillingDetails = [
                'billing_status_id' => $billingAccount->billing_status_id,
                'billing_day' => $billingAccount->billing_day,
                'date_installed' => $billingAccount->date_installed,
                'vip_expiration' => $billingAccount->vip_expiration,
                'vip_remarks' => $billingAccount->vip_remarks,
            ];

            // Resolve billing_status_id
            $billingStatusId = $billingAccount->billing_status_id;
            if ($request->has('billing_status_id') && !empty($validated['billing_status_id'])) {
                if (is_numeric($validated['billing_status_id'])) {
                    $billingStatusId = (int) $validated['billing_status_id'];
                } else {
                    // Attempt to find by name in the database
                    $dbStatus = DB::table('billing_status')->where('status_name', $validated['billing_status_id'])->first();
                    if ($dbStatus) {
                        $billingStatusId = $dbStatus->id;
                    } else {
                        // Fallback mapping
                        $statusMap = [
                            'Active' => 1,
                            'Disconnected' => 2,
                            'Pending' => 3,
                            'Terminated' => 4,
                            'Suspended' => 5
                        ];
                        $billingStatusId = $statusMap[$validated['billing_status_id']] ?? $billingStatusId;
                    }
                }
            }

            $updateData = [
                'billing_status_id' => $billingStatusId,
            ];

            if ($request->has('updatedBy')) {
                $updateData['updated_by'] = $request->input('updatedBy');
            }

            if ($request->has('billing_day')) {
                $updateData['billing_day'] = $validated['billing_day'];
            }

            if ($request->has('date_installed')) {
                $updateData['date_installed'] = $validated['date_installed'];
            }

            if ($request->has('vip_expiration')) {
                $updateData['vip_expiration'] = $validated['vip_expiration'];
            }

            if ($request->has('vip_remarks')) {
                $updateData['vip_remarks'] = $validated['vip_remarks'];
            }

            $billingAccount->update($updateData);

            // Capture new billing details after update
            $billingAccount->refresh();
            $newBillingDetails = [
                'billing_status_id' => $billingAccount->billing_status_id,
                'billing_day' => $billingAccount->billing_day,
                'date_installed' => $billingAccount->date_installed,
                'vip_expiration' => $billingAccount->vip_expiration,
                'vip_remarks' => $billingAccount->vip_remarks,
            ];

            $changedOldBillingDetails = [];
            $changedNewBillingDetails = [];

            foreach ($oldBillingDetails as $key => $oldValue) {
                $newValue = $newBillingDetails[$key] ?? null;
                if ($oldValue !== $newValue) {
                    $changedOldBillingDetails[$key] = $oldValue;
                    $changedNewBillingDetails[$key] = $newValue;
                }
            }

            // details_update_logs is written by App\Observers\AccountDetailsObserver
            // when the model saves — see the note in updateCustomerDetails().

            // Log Activity
            ActivityLog::log(
                'Billing Details Updated',
                "Billing details updated for Account: {$accountNo}",
                'info',
                [
                    'resource_type' => 'BillingAccount',
                    'resource_id' => $billingAccount->id,
                    'additional_data' => [
                        'account_no' => $accountNo,
                        'updated_fields' => $updateData
                    ]
                ]
            );

            DB::commit();

            Log::info('Billing details updated', [
                'account_no' => $accountNo,
                'billing_account_id' => $billingAccount->id
            ]);

            $this->broadcastCustomerUpdated($accountNo, 'billing_details');

            return response()->json([
                'success' => true,
                'message' => 'Billing status updated successfully',
                'data' => $billingAccount->fresh()
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Failed to update billing details', [
                'account_no' => $accountNo,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update billing details',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update technical details
     */
    public function updateTechnicalDetails(Request $request, $accountNo): JsonResponse
    {
        try {
            $validated = $request->validate([
                'username' => 'nullable|string|max:255',
                'connection_type' => 'nullable|string|max:100',
                'router_model' => 'nullable|string|max:255',
                'router_modem_sn' => 'nullable|string|max:255',
                'ip_address' => 'nullable|string|max:45',
                'lcp' => 'nullable|string|max:255',
                'nap' => 'nullable|string|max:255',
                'lcpnap' => 'nullable|string|max:255',
                'port' => 'nullable|string|max:255',
                'vlan' => 'nullable|string|max:255',
                'usage_type' => 'nullable|string|max:255'
            ]);

            DB::beginTransaction();

            $billingAccount = BillingAccount::where('account_no', $accountNo)->firstOrFail();

            // Get or create technical details
            $technicalDetail = TechnicalDetail::where('account_id', $billingAccount->id)->first();

            $isNewTechnicalDetail = false;
            if (!$technicalDetail) {
                $isNewTechnicalDetail = true;
                $technicalDetail = new TechnicalDetail();
                $technicalDetail->account_id = $billingAccount->id;
                $technicalDetail->account_no = $billingAccount->account_no;
                $technicalDetail->created_by = $request->user()->id ?? 1;
            }

            // Capture old technical details before update
            $oldTechnicalDetails = $isNewTechnicalDetail ? [] : [
                'username' => $technicalDetail->username,
                'connection_type' => $technicalDetail->connection_type,
                'router_model' => $technicalDetail->router_model,
                'router_modem_sn' => $technicalDetail->router_modem_sn,
                'ip_address' => $technicalDetail->ip_address,
                'lcp' => $technicalDetail->lcp,
                'nap' => $technicalDetail->nap,
                'lcpnap' => $technicalDetail->lcpnap,
                'port' => $technicalDetail->port,
                'vlan' => $technicalDetail->vlan,
                'usage_type' => $technicalDetail->usage_type,
            ];

            // Generate LCPNAP if LCP and NAP are provided, or use direct lcpnap
            $lcpnap = $technicalDetail->lcpnap;
            $newLcp = $validated['lcp'] ?? null;
            $newNap = $validated['nap'] ?? null;
            $newLcpNapInput = $validated['lcpnap'] ?? null;

            if ($newLcp && $newNap) {
                $lcpnap = trim($newLcp . ' - ' . $newNap);
            } elseif ($newLcpNapInput) {
                $lcpnap = $newLcpNapInput;
                // If lcp/nap are missing but lcpnap is present, try to split them
                if (!$newLcp || !$newNap) {
                    $parts = preg_split('/[-\s]+/', $newLcpNapInput);
                    if (count($parts) >= 2) {
                        $newLcp = $parts[0];
                        $newNap = $parts[1];
                    }
                }
            }

            $oldUsername = $oldTechnicalDetails['username'] ?? null;
            $newUsernameInput = $validated['username'] ?? $technicalDetail->username;
            $usernameChanged = ($oldUsername && $newUsernameInput && $oldUsername !== $newUsernameInput);

            // Defer the username update to the RADIUS service if it has changed
            // This allows the service to handle the Database-First sequence correctly
            if (!$usernameChanged) {
                $technicalDetail->username = $newUsernameInput;
            } else {
                // Keep the old username for now so the RADIUS service can find the user to rename them
                $technicalDetail->username = $oldUsername;
            }

            $technicalDetail->connection_type = (!empty($validated['connection_type'])) ? $validated['connection_type'] : $technicalDetail->connection_type;
            $technicalDetail->router_model = (!empty($validated['router_model'])) ? $validated['router_model'] : $technicalDetail->router_model;
            $technicalDetail->router_modem_sn = $validated['router_modem_sn'] ?? $technicalDetail->router_modem_sn;
            $technicalDetail->ip_address = $validated['ip_address'] ?? $technicalDetail->ip_address;
            $technicalDetail->lcp = $newLcp ?? $technicalDetail->lcp;
            $technicalDetail->nap = $newNap ?? $technicalDetail->nap;
            $technicalDetail->port = $validated['port'] ?? $technicalDetail->port;
            $technicalDetail->vlan = $validated['vlan'] ?? $technicalDetail->vlan;
            $technicalDetail->lcpnap = $lcpnap;
            $technicalDetail->usage_type = $validated['usage_type'] ?? $technicalDetail->usage_type;

            if ($request->has('updatedBy')) {
                $technicalDetail->updated_by = $request->input('updatedBy');
            }

            $technicalDetail->save();

            // Sync username to online_status table if it changed
            if ($technicalDetail->username && $technicalDetail->username !== $oldUsername) {
                $updatedRows = DB::table('online_status')
                    ->where('account_id', $billingAccount->id)
                    ->update([
                        'username' => $newUsername,
                        'updated_at' => now(),
                    ]);

                Log::info('Online status username synced', [
                    'account_no' => $accountNo,
                    'account_id' => $billingAccount->id,
                    'old_username' => $oldUsername,
                    'new_username' => $newUsername,
                    'rows_updated' => $updatedRows,
                ]);
            }

            // Capture new technical details after save
            $newTechnicalDetails = [
                'username' => $technicalDetail->username,
                'connection_type' => $technicalDetail->connection_type,
                'router_model' => $technicalDetail->router_model,
                'router_modem_sn' => $technicalDetail->router_modem_sn,
                'ip_address' => $technicalDetail->ip_address,
                'lcp' => $technicalDetail->lcp,
                'nap' => $technicalDetail->nap,
                'lcpnap' => $technicalDetail->lcpnap,
                'port' => $technicalDetail->port,
                'vlan' => $technicalDetail->vlan,
                'usage_type' => $technicalDetail->usage_type,
            ];

            $changedOldTechnicalDetails = [];
            $changedNewTechnicalDetails = [];

            if (!empty($oldTechnicalDetails)) {
                foreach ($oldTechnicalDetails as $key => $oldValue) {
                    $newValue = $newTechnicalDetails[$key] ?? null;
                    if ($oldValue !== $newValue) {
                        $changedOldTechnicalDetails[$key] = $oldValue;
                        $changedNewTechnicalDetails[$key] = $newValue;
                    }
                }
            } else {
                foreach ($newTechnicalDetails as $key => $newValue) {
                    if ($newValue !== null && $newValue !== '') {
                        $changedOldTechnicalDetails[$key] = null;
                        $changedNewTechnicalDetails[$key] = $newValue;
                    }
                }
            }

            // details_update_logs is written by App\Observers\AccountDetailsObserver
            // when the model saves — see the note in updateCustomerDetails(). A
            // technical row created here for the first time is an insert, not an
            // update, and is recorded by the creation trail rather than as an edit.

            // Log Activity
            ActivityLog::log(
                'Technical Details Updated',
                "Technical details updated for Account: {$accountNo}",
                'info',
                [
                    'resource_type' => 'TechnicalDetail',
                    'resource_id' => $technicalDetail->id,
                    'additional_data' => [
                        'account_no' => $accountNo,
                        'updated_fields' => $validated
                    ]
                ]
            );

            DB::commit();

            Log::info('Technical details updated', [
                'account_no' => $accountNo,
                'technical_detail_id' => $technicalDetail->id
            ]);

            $this->broadcastCustomerUpdated($accountNo, 'technical_details');

            // Execute RADIUS update as the absolute last step after database saving is complete
            $radiusMessage = null;
            $radiusQueued = false;
            $radiusQueueFailed = false;
            $oldUsername = $oldTechnicalDetails['username'] ?? null;
            $newUsername = $technicalDetail->username;

            if ($usernameChanged) {
                // Snapshot of everything the RADIUS rename needs. This is also what gets
                // persisted to the queue so the cron can replay the exact same operation.
                $credParams = [
                    'accountNumber' => $accountNo,
                    'username' => $oldUsername,       // RADIUS still has the OLD name
                    'newUsername' => $newUsernameInput,  // the target name
                    'newPassword' => null,               // username-only change, keep password
                    'updatedBy' => $request->input('updatedBy') ?: 'System',
                ];

                $radiusFailedError = null;
                try {
                    $radiusService = app(\App\Services\ManualRadiusOperationsService::class);
                    $radiusResult = $radiusService->updateCredentials($credParams);

                    if (($radiusResult['status'] ?? '') === 'success') {
                        $radiusMessage = $radiusResult['message'] ?? 'Radius and Database updated successfully';
                    } else {
                        $radiusFailedError = $radiusResult['message'] ?? 'RADIUS update returned failure';
                    }
                } catch (\Exception $e) {
                    // updateCredentials normally returns a status, but stay defensive.
                    $radiusFailedError = $e->getMessage();
                    Log::error('Radius username update failed', ['error' => $e->getMessage()]);
                }

                // RADIUS could not be reached/applied (server offline/timeout/etc.). The DB
                // rename is already committed, so queue the RADIUS rename for automatic retry
                // instead of losing it. The Service Order / customer save is NOT rolled back.
                if ($radiusFailedError !== null) {
                    $queuedId = \App\Services\RadiusQueueService::queue([
                        'organization_id' => $billingAccount->organization_id ?? null,
                        'source_type' => 'customer_detail_update',
                        'source_id' => $billingAccount->id,
                        'account_no' => $accountNo,
                        'operation' => 'update_credentials',
                        'params' => $credParams,
                        'last_error' => $radiusFailedError,
                        'created_by' => $credParams['updatedBy'],
                    ]);

                    \Log::channel('radiusrelated')->error('[CUSTOMER DETAIL RADIUS UPDATE FAILED - QUEUED] Account: ' . $accountNo . ' - Old User: ' . $oldUsername . ' - New User: ' . $newUsernameInput . ' - Error: ' . $radiusFailedError);

                    if ($queuedId) {
                        $radiusQueued = true;
                        $radiusMessage = 'RADIUS username update has been queued and will be processed automatically.';
                    } else {
                        $radiusQueueFailed = true;
                        $radiusMessage = 'RADIUS update failed and could not be queued. Please notify an administrator to retry it manually.';
                    }
                }
            }

            // Keep SmartOLT's ONU label in step with the technical record.
            //
            // Runs last, after the commit AND after the RADIUS block, for two
            // reasons. The commit means a SmartOLT timeout can never roll back a
            // saved technical record. Waiting for RADIUS means the username this
            // reads is the one that actually landed: on a rename the model still
            // holds the OLD name at this point by design (it is kept so the RADIUS
            // service can find the account), and it is ManualRadiusOperationsService
            // that writes the new one. Re-reading from the database is therefore the
            // only way to learn the true current name — and if the RADIUS call failed
            // and was queued, the name is still the old one and SmartOLT correctly
            // stays on it until the queue catches up.
            $this->syncSmartOltForTechnicalDetail($accountNo, $billingAccount, $technicalDetail, $oldTechnicalDetails);

            return response()->json([
                'success' => true,
                'message' => 'Technical details updated successfully',
                'data' => $technicalDetail->fresh(),
                'radius_message' => $radiusMessage,
                'radius_queued' => $radiusQueued,
                'radius_queue_failed' => $radiusQueueFailed
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Failed to update technical details', [
                'account_no' => $accountNo,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update technical details',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Push a technical-details change out to SmartOLT, best-effort.
     *
     * Two distinct cases, and they are not interchangeable:
     *
     *  - The router serial changed. The ONU behind the old serial is a different
     *    physical device, so its label has to be released before the new one takes
     *    the subscriber's name. syncOnuForRouterReplacement() does both halves in
     *    that order; calling setOnuNameBySn() alone would leave the old ONU still
     *    labelled for a subscriber who is no longer behind it.
     *  - The serial is unchanged but the username moved. Only the label needs
     *    rewriting, on the same ONU.
     *
     * Deliberately best-effort and non-fatal. The database change is already
     * committed and correct; SmartOLT is a downstream label. An unreachable OLT must
     * not turn a successful save into a 500 for the operator, so every failure is
     * logged to the SmartOLT channel and swallowed. The nightly
     * `cron:smartolt-daily-automation` pass re-aligns anything missed here.
     *
     * @param array<string, mixed> $oldTechnicalDetails
     */
    private function syncSmartOltForTechnicalDetail(
        string $accountNo,
        $billingAccount,
        $technicalDetail,
        array $oldTechnicalDetails
    ): void {
        try {
            // The model may still hold the pre-rename username by design, so the
            // committed row is the only trustworthy source for what the name is now.
            $current = $technicalDetail->fresh();

            if ($current === null) {
                return;
            }

            $oldSn   = trim((string) ($oldTechnicalDetails['router_modem_sn'] ?? ''));
            $newSn   = trim((string) ($current->router_modem_sn ?? ''));
            $oldUser = trim((string) ($oldTechnicalDetails['username'] ?? ''));
            $newUser = trim((string) ($current->username ?? ''));

            if ($newSn === '') {
                // No serial means no ONU to address.
                return;
            }

            $smartOlt = app(\App\Services\SmartOltService::class);

            if ($oldSn !== $newSn) {
                $smartOlt->syncOnuForRouterReplacement(
                    $accountNo,
                    $oldSn ?: null,
                    $newSn,
                    '[SMARTOLT CUSTOMER EDIT SWAP]'
                );

                // The replacement helper clears the old ONU and assigns the new one
                // by account; the label still has to carry the PPPoE username, which
                // is what the SmartOLT tool and the field technicians match on.
                if ($newUser !== '') {
                    $smartOlt->setOnuNameBySn(
                        $newSn,
                        $newUser,
                        $this->smartOltAddressFor($billingAccount),
                        $this->smartOltContactFor($billingAccount)
                    );
                }

                return;
            }

            if ($newUser !== '' && $oldUser !== $newUser) {
                $smartOlt->setOnuNameBySn(
                    $newSn,
                    $newUser,
                    $this->smartOltAddressFor($billingAccount),
                    $this->smartOltContactFor($billingAccount)
                );
            }
        } catch (\Exception $e) {
            Log::channel('smartoltrelated')->error('[SMARTOLT CUSTOMER EDIT] Sync failed', [
                'account_no' => $accountNo,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /**
     * The customer's address as one line, for the ONU's address_or_comment field.
     *
     * Memoized per request so the two call sites above do not read the same customer
     * row twice.
     */
    private function smartOltAddressFor($billingAccount): ?string
    {
        $customer = $this->smartOltCustomer($billingAccount);

        if ($customer === null) {
            return null;
        }

        $address = implode(', ', array_filter([
            trim((string) ($customer->address ?? '')),
            trim((string) ($customer->barangay ?? '')),
            trim((string) ($customer->city ?? '')),
        ], static fn (string $part): bool => $part !== ''));

        return $address !== '' ? $address : null;
    }

    private function smartOltContactFor($billingAccount): ?string
    {
        $customer = $this->smartOltCustomer($billingAccount);

        return $customer->contact_number_primary ?? null;
    }

    /** @var object|null|false false means "looked up and not found" */
    private $smartOltCustomerCache = false;

    private function smartOltCustomer($billingAccount)
    {
        if ($this->smartOltCustomerCache !== false) {
            return $this->smartOltCustomerCache;
        }

        $this->smartOltCustomerCache = DB::table('customers')
            ->where('id', $billingAccount->customer_id ?? 0)
            ->select(['address', 'barangay', 'city', 'contact_number_primary'])
            ->first();

        return $this->smartOltCustomerCache;
    }

    /**
     * Broadcast customer-updated event via Soketi
     */
    private function broadcastCustomerUpdated($accountNo, $editType = 'customer_details')
    {
        try {
            event(new \App\Events\CustomerUpdated([
                'account_no' => $accountNo,
                'type' => 'customer_updated',
                'edit_type' => $editType,
                'title' => 'Customer Updated',
                'message' => "Customer data updated for account {$accountNo}",
                'timestamp' => now()->timestamp,
                'formatted_date' => now()->format('Y-m-d h:i:s A')
            ]));
        } catch (\Exception $e) {
            Log::warning('Failed to broadcast customer update via Soketi', [
                'account_no' => $accountNo,
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * Upload file to Google Drive (placeholder - implement based on your setup)
     */
    private function uploadToGoogleDrive($file, $accountNo)
    {
        // TODO: Implement Google Drive upload
        // For now, return a placeholder URL or use existing logic if any
        return 'https://drive.google.com/file/d/placeholder';
    }
}




