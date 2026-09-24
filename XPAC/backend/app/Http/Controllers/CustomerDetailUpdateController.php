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
     * Fallback VIP billing status id.
     *
     * Matches the hard-coded value in the vip:check-expiration command and in
     * {@see \App\Services\EnhancedBillingGenerationServiceWithNotifications}. Only used when the
     * billing_status table cannot be read or has no row named 'VIP'.
     */
    private const BILLING_STATUS_VIP_FALLBACK = 7;

    /** Resolved VIP billing status id, looked up once per request. */
    private ?int $resolvedVipStatusId = null;

    /**
     * The billing_status id that means "VIP".
     *
     * Resolved by name so a reordered status table cannot silently break VIP detection, with the
     * historical id as the fallback.
     */
    private function getVipBillingStatusId(): int
    {
        if ($this->resolvedVipStatusId !== null) {
            return $this->resolvedVipStatusId;
        }

        try {
            $configured = DB::table('billing_status')->where('status_name', 'VIP')->value('id');
        } catch (\Throwable $e) {
            $configured = null;
        }

        $this->resolvedVipStatusId = (int) ($configured ?: self::BILLING_STATUS_VIP_FALLBACK);

        return $this->resolvedVipStatusId;
    }

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
                'referred_by' => $customer->referred_by,
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
                'contact_number_primary' => $validated['contactNumberPrimary'],
                'contact_number_secondary' => $validated['contactNumberSecondary'] ?? $customer->contact_number_secondary,
                'address' => $validated['address'],
                'region' => $validated['region'],
                'city' => $validated['city'],
                'barangay' => $validated['barangay'],
                'location' => $validated['location'] ?? $customer->location,
                'address_coordinates' => $validated['addressCoordinates'] ?? $customer->address_coordinates,
                'housing_status' => $validated['housingStatus'] ?? $customer->housing_status,
                // A form echoing the displayed agent name back keeps the stored id.
                'referred_by' => \App\Support\AgentReferral::preserveOnWrite(
                    $validated['referredBy'] ?? null,
                    $customer->referred_by
                ) ?? $customer->referred_by,
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
                
                // If contact number changed, update contact_number and password_hash.
                // The portal password convention is the primary contact number, so it
                // follows the number. contactNumberPrimary is required, so never null.
                if ($oldContact !== $validated['contactNumberPrimary']) {
                    $userUpdate['contact_number'] = $validated['contactNumberPrimary'];
                    $userUpdate['password_hash'] = $validated['contactNumberPrimary'];
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
                'referred_by' => $customer->referred_by,
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

            // Compared on the STORED value above (an id rewritten to the same
            // agent's name is a real change), and recorded readably here.
            if (array_key_exists('referred_by', $changedOldDetails)) {
                $changedOldDetails['referred_by'] = \App\Support\AgentReferral::displayName($changedOldDetails['referred_by']);
            }
            if (array_key_exists('referred_by', $changedNewDetails)) {
                $changedNewDetails['referred_by'] = \App\Support\AgentReferral::displayName($changedNewDetails['referred_by']);
            }

            if (!empty($changedOldDetails) || !empty($changedNewDetails)) {
                // Log to details_update_logs
                $logUserId = $request->input('updatedBy') ?: ($request->user() ? $request->user()->id : null);
                DB::table('details_update_logs')->insert([
                    'account_id' => $billingAccount->id,
                    'old_details' => json_encode(['type' => 'customer_details', 'data' => $changedOldDetails]),
                    'new_details' => json_encode(['type' => 'customer_details', 'data' => $changedNewDetails]),
                    'created_at' => now(),
                    'created_by_user_id' => $logUserId,
                    'updated_at' => now(),
                    'updated_by_user_id' => $logUserId,
                ]);
            }

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
                'vip_remarks' => 'nullable|string',
                // Billing Type. Both spellings accepted while older clients are still in the wild;
                // 'Prepaid'/'Postpaid' are canonical. Changing this switches the account between
                // the fixed-billing-day flow and the rolling prepaid-period flow.
                // Canonical plus legacy spellings — `in` is case- and whitespace-sensitive, and the
                // value is normalised to canonical on write below regardless of what arrives.
                'generation_type' => 'nullable|string|in:Prepaid,Postpaid,PrePaid,PostPaid,Pre Paid,Post Paid',
                // Legacy free-text VAT mode. Still editable, but billing generation reads the
                // boolean vat_enabled, which is kept in sync on write below.
                'vat_type' => 'nullable|string|in:Vat Included,Excluded Vat,No Vat',
                'vat_enabled' => 'nullable|boolean',
                'withholding_enabled' => 'nullable|boolean',
                // Percentage of the VAT-inclusive subtotal, e.g. 5 / 10 / 15.
                'withholding_percentage' => 'nullable|numeric|min:0|max:100',
                // ACCEPTED BUT IGNORED — see the write block below. Kept in the validator so a
                // stale client posting the field gets the same 422 for a malformed date as it
                // always did, rather than having its whole submission behave differently
                // depending on which build it is running.
                'prepaid_expires_at' => 'nullable|date',
            ]);

            DB::beginTransaction();

            $billingAccount = BillingAccount::where('account_no', $accountNo)->firstOrFail();

            // Held apart from the audit diff below because the VIP reconnect decision after the
            // commit needs the pre-update status, and $oldBillingDetails only survives as far as
            // the changed-fields comparison.
            $oldBillingStatusId = (int) $billingAccount->billing_status_id;

            // Capture old billing details before update
            $oldBillingDetails = [
                'billing_status_id' => $billingAccount->billing_status_id,
                'billing_day' => $billingAccount->billing_day,
                'date_installed' => $billingAccount->date_installed,
                'vip_expiration' => $billingAccount->vip_expiration,
                'vip_remarks' => $billingAccount->vip_remarks,
                'generation_type' => $billingAccount->generation_type,
                'vat_type' => $billingAccount->vat_type,
                // vat_enabled is what billing generation reads and it moves whenever vat_type
                // does, so the audit diff has to carry it too.
                'vat_enabled' => $billingAccount->vat_enabled,
                'withholding_enabled' => $billingAccount->withholding_enabled,
                'withholding_percentage' => $billingAccount->withholding_percentage,
                'prepaid_expires_at' => $billingAccount->prepaid_expires_at,
            ];

            // Resolve billing_status_id
            $billingStatusId = $billingAccount->billing_status_id;
            if ($request->has('billing_status_id') && !empty($validated['billing_status_id'])) {
                if (is_numeric($validated['billing_status_id'])) {
                    $billingStatusId = (int)$validated['billing_status_id'];
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
                            'Suspended' => 5,
                            // Without this, a client posting the NAME 'VIP' while the
                            // billing_status lookup above came back empty would fall through and
                            // silently keep the account on its old status — comping a customer
                            // would appear to succeed and change nothing.
                            'VIP' => self::BILLING_STATUS_VIP_FALLBACK,
                        ];
                        $billingStatusId = $statusMap[$validated['billing_status_id']] ?? $billingStatusId;
                    }
                }
            }

            // A fresh non-VIP -> VIP transition. Comping a customer exempts them from prepaid
            // expiration entirely (billing_status_id alone already does that everywhere prepaid
            // expiry is evaluated — AutoDisconnectService filters to Active accounts, VIP is a
            // separate status), so the stale expiry date is cleared too rather than left to
            // silently linger and confuse anyone reading the account.
            $willBecomeVip = ((int) $billingStatusId === $this->getVipBillingStatusId())
                && $oldBillingStatusId !== $this->getVipBillingStatusId();

            $updateData = [
                'billing_status_id' => $billingStatusId,
            ];

            if ($willBecomeVip) {
                $updateData['prepaid_expires_at'] = null;
            }

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

            // Normalise on write so the database converges on the canonical spellings even when an
            // older client posts 'Pre Paid'.
            if ($request->has('generation_type')) {
                $generationType = $validated['generation_type'] ?? null;
                if ($generationType !== null && $generationType !== '') {
                    $generationType = \App\Models\BillingAccount::isPrepaidType($generationType)
                        ? \App\Models\BillingAccount::GENERATION_PREPAID
                        : \App\Models\BillingAccount::GENERATION_POSTPAID;
                }
                $updateData['generation_type'] = $generationType;
            }

            // Keep vat_type and vat_enabled in lockstep. Billing generation reads vat_enabled, so
            // editing only the legacy text here would otherwise silently change nothing.
            // 'Excluded Vat' is the only LEGACY value that still adds VAT — old vocabulary, not the
            // current label (the UI says "VAT Included"). The old 'Vat Included' mode is gone; both
            // it and 'No Vat' billed exactly the plan price, i.e. vat_enabled = false.
            if ($request->has('vat_type')) {
                $vatType = $validated['vat_type'] ?? null;
                $updateData['vat_type'] = $vatType;
                $updateData['vat_enabled'] = str_contains(
                    preg_replace('/[^a-z]/', '', strtolower((string) $vatType)),
                    'exclu'
                );
            }

            // An explicit boolean from a newer client wins, and drags the legacy text along.
            if ($request->has('vat_enabled')) {
                $vatEnabled = (bool) ($validated['vat_enabled'] ?? false);
                $updateData['vat_enabled'] = $vatEnabled;
                $updateData['vat_type'] = $vatEnabled ? 'Excluded Vat' : 'No Vat';
            }

            // Withholding is stored as a pair; clearing the flag clears the percentage with it so a
            // disabled account can never keep a stale rate that a later re-enable would apply.
            if ($request->has('withholding_enabled')) {
                $withholdingEnabled = (bool) ($validated['withholding_enabled'] ?? false);
                $updateData['withholding_enabled'] = $withholdingEnabled;
                $updateData['withholding_percentage'] = $withholdingEnabled
                    ? ($validated['withholding_percentage'] ?? null)
                    : null;
            } elseif ($request->has('withholding_percentage')) {
                $updateData['withholding_percentage'] = $validated['withholding_percentage'] ?? null;
            }

            /*
             * prepaid_expires_at is NOT writable here, for any role.
             *
             * A single mistyped date on this form could hand out — or take away — months of service
             * with no record of who did it or why. Adjustments now go through the Prepaid Override
             * approval queue instead (Billing -> Prepaid Override), where they are reviewed by a
             * second person, applied under a lock, and audited on both sides of the move. See
             * {@see \App\Services\PrepaidOverrideService}.
             *
             * The field is read-only in the UI too, so anything arriving here is either a stale
             * client or a direct API call. Both are dropped rather than rejected: the rest of the
             * billing details in the same submission are legitimate and must still save, and
             * failing the whole request would block ordinary edits on every prepaid account. The
             * warning is what makes the drop visible instead of silent.
             */
            if ($request->has('prepaid_expires_at')) {
                \Log::warning('Ignored prepaid_expires_at on billing details update — use the Prepaid Override workflow', [
                    'account_no'       => $accountNo,
                    'submitted_value'  => $request->input('prepaid_expires_at'),
                    'current_value'    => optional($billingAccount->prepaid_expires_at)->toDateTimeString(),
                    'user_id'          => $request->user() ? $request->user()->id : null,
                    'updated_by_input' => $request->input('updatedBy'),
                ]);
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
                'generation_type' => $billingAccount->generation_type,
                'vat_type' => $billingAccount->vat_type,
                // vat_enabled is what billing generation reads and it moves whenever vat_type
                // does, so the audit diff has to carry it too.
                'vat_enabled' => $billingAccount->vat_enabled,
                'withholding_enabled' => $billingAccount->withholding_enabled,
                'withholding_percentage' => $billingAccount->withholding_percentage,
                'prepaid_expires_at' => $billingAccount->prepaid_expires_at,
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

            if (!empty($changedOldBillingDetails) || !empty($changedNewBillingDetails)) {
                // Log to details_update_logs
                $logUserId = $request->input('updatedBy') ?: ($request->user() ? $request->user()->id : null);
                DB::table('details_update_logs')->insert([
                    'account_id' => $billingAccount->id,
                    'old_details' => json_encode(['type' => 'billing_details', 'data' => $changedOldBillingDetails]),
                    'new_details' => json_encode(['type' => 'billing_details', 'data' => $changedNewBillingDetails]),
                    'created_at' => now(),
                    'created_by_user_id' => $logUserId,
                    'updated_at' => now(),
                    'updated_by_user_id' => $logUserId,
                ]);
            }

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

            /*
             * Comping a customer has to actually restore their service.
             *
             * Setting the billing status to VIP is how an account is comped, but on its own it
             * only stops future billing — it does nothing to RADIUS. An account that reached VIP
             * from Inactive/Disconnected (the usual reason to comp someone) is still sitting in
             * the Restricted RADIUS group with no session, so the customer stays offline while
             * the record claims they are a VIP. This closes that gap by moving them back onto
             * their plan group as soon as the status change commits.
             *
             * Strictly a non-VIP -> VIP transition: re-saving the billing form on an account that
             * is already VIP must not fire a fresh RADIUS round-trip (and a fresh
             * reconnection_logs row) every time an unrelated field is edited.
             *
             * Deliberately after DB::commit(): the billing update is the customer's record of
             * being comped and must survive a RADIUS server that is down, so nothing below can
             * roll it back.
             */
            $newBillingStatusId = (int) $billingAccount->billing_status_id;
            $vipStatusId = $this->getVipBillingStatusId();
            $becameVip = ($newBillingStatusId === $vipStatusId && $oldBillingStatusId !== $vipStatusId);

            $radiusMessage = null;
            $radiusQueued = false;

            if ($becameVip) {
                Log::info('Billing status changed to VIP — restoring RADIUS service', [
                    'account_no' => $accountNo,
                    'billing_account_id' => $billingAccount->id,
                    'old_status' => $oldBillingStatusId,
                    'new_status' => $newBillingStatusId,
                    'vip_expiration' => $billingAccount->vip_expiration,
                    'updated_by' => $request->input('updatedBy'),
                ]);

                $reconnectOutcome = $this->reconnectAccountForVip(
                    $billingAccount,
                    $oldBillingStatusId,
                    $newBillingStatusId,
                    $request->input('updatedBy') ?: 'System'
                );

                $radiusMessage = $reconnectOutcome['message'];
                $radiusQueued = $reconnectOutcome['queued'];
            }

            return response()->json([
                'success' => true,
                'message' => 'Billing status updated successfully',
                'data' => $billingAccount->fresh(),
                // Null on every non-VIP edit, so existing clients see the response they always
                // did. Mirrors the shape updateTechnicalDetails() already returns.
                'radius_message' => $radiusMessage,
                'radius_queued' => $radiusQueued
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

            if (!empty($changedNewTechnicalDetails) || !empty($changedOldTechnicalDetails)) {
                // Log to details_update_logs
                $logUserId = $request->input('updatedBy') ?: ($request->user() ? $request->user()->id : null);
                DB::table('details_update_logs')->insert([
                    'account_id' => $billingAccount->id,
                    'old_details' => json_encode(['type' => 'technical_details', 'data' => $changedOldTechnicalDetails]),
                    'new_details' => json_encode(['type' => 'technical_details', 'data' => $changedNewTechnicalDetails]),
                    'created_at' => now(),
                    'created_by_user_id' => $logUserId,
                    'updated_at' => now(),
                    'updated_by_user_id' => $logUserId,
                ]);
            }

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
                    'username'      => $oldUsername,       // RADIUS still has the OLD name
                    'newUsername'   => $newUsernameInput,  // the target name
                    'newPassword'   => null,               // username-only change, keep password
                    'updatedBy'     => $request->input('updatedBy') ?: 'System',
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
                        'source_type'     => 'customer_detail_update',
                        'source_id'       => $billingAccount->id,
                        'account_no'      => $accountNo,
                        'operation'       => 'update_credentials',
                        'params'          => $credParams,
                        'last_error'      => $radiusFailedError,
                        'created_by'      => $credParams['updatedBy'],
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
     * Restore RADIUS service for an account that was just moved onto the VIP billing status.
     *
     * Moves the RADIUS user back into its plan group and kills any stale session so the new
     * profile takes effect immediately — the same mechanism the payment pipelines use to
     * reactivate a customer who has paid, minus the billing status write.
     *
     * Best-effort by contract. The caller has already committed the billing change, so every
     * failure path here reports back rather than throwing: a RADIUS server that is down must
     * never undo a record of the customer being comped. Failures are queued for the
     * ProcessRadiusQueue cron to retry, matching how the rest of this controller handles RADIUS.
     *
     * @return array{message: string, queued: bool} Human-readable outcome for the API response.
     */
    private function reconnectAccountForVip(
        BillingAccount $billingAccount,
        int $oldStatusId,
        int $newStatusId,
        string $updatedBy
    ): array {
        $accountNo = $billingAccount->account_no;

        $logContext = [
            'account_no' => $accountNo,
            'billing_account_id' => $billingAccount->id,
            'old_status' => $oldStatusId,
            'new_status' => $newStatusId,
            'updated_by' => $updatedBy,
        ];

        // Resolve the PPPoE username and the plan to reconnect onto. plan_list is the plan the
        // account is actually on; customers.desired_plan is the fallback, and is what the
        // payment-driven reconnect paths (PaymentWorkerService, ServiceOrderController) read.
        try {
            $details = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->leftJoin('plan_list', 'billing_accounts.plan_id', '=', 'plan_list.id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select(
                    'technical_details.username as username',
                    'plan_list.plan_name as plan_title',
                    'customers.desired_plan as desired_plan'
                )
                ->first();
        } catch (\Throwable $e) {
            Log::error('VIP reconnect aborted — failed to load technical/plan details', array_merge($logContext, [
                'error' => $e->getMessage(),
            ]));

            return [
                'message' => 'Account set to VIP, but its technical details could not be read so no RADIUS reconnect was attempted.',
                'queued' => false,
            ];
        }

        $username = $details->username ?? null;
        $planTitle = ($details->plan_title ?? null) ?: ($details->desired_plan ?? null);

        // Not error cases: the billing status is committed and correct either way. An account
        // with no RADIUS user (or no plan to put it in) simply has nothing to reconnect, and
        // gets provisioned onto its plan group by the normal install flow.
        if (empty($username)) {
            Log::warning('VIP reconnect skipped — no PPPoE username on technical_details', $logContext);

            return [
                'message' => 'Account set to VIP. No PPPoE username on file, so no RADIUS reconnect was attempted.',
                'queued' => false,
            ];
        }

        if (empty($planTitle)) {
            Log::warning('VIP reconnect skipped — no plan on the account or customer', array_merge($logContext, [
                'username' => $username,
            ]));

            return [
                'message' => 'Account set to VIP. No plan on file, so no RADIUS reconnect was attempted.',
                'queued' => false,
            ];
        }

        $params = [
            'accountNumber' => $accountNo,
            'username' => $username,
            'plan' => $planTitle,
            'updatedBy' => $updatedBy,
            'remarks' => 'VIP Status Applied - Auto Reconnect',
            // This controller committed the VIP status a moment ago; without this the reconnect
            // would write Active straight over it, un-comping the customer it was called to comp.
            // See ManualRadiusOperationsService::reconnectUser().
            'preserveBillingStatus' => true,
        ];

        $error = null;

        try {
            $result = app(\App\Services\ManualRadiusOperationsService::class)->reconnectUser($params);

            if (($result['status'] ?? '') === 'success') {
                Log::info('VIP reconnect succeeded', array_merge($logContext, [
                    'username' => $username,
                    'plan' => $planTitle,
                ]));

                return [
                    'message' => 'Account set to VIP and RADIUS service restored.',
                    'queued' => false,
                ];
            }

            $error = $result['message'] ?? 'RADIUS reconnect returned failure';
        } catch (\Throwable $e) {
            // reconnectUser() normally returns a status rather than throwing, but stay defensive
            // so a RADIUS glitch can never surface as a 500 on an already-committed update.
            $error = $e->getMessage();
        }

        Log::error('VIP reconnect failed — queueing for retry', array_merge($logContext, [
            'username' => $username,
            'plan' => $planTitle,
            'error' => $error,
        ]));

        \Log::channel('radiusrelated')->error('[VIP RECONNECT FAILED - QUEUED] Account: ' . $accountNo . ' - User: ' . $username . ' - Error: ' . $error);

        $queuedId = \App\Services\RadiusQueueService::queue([
            'organization_id' => $billingAccount->organization_id ?? null,
            'source_type'     => 'vip_billing_update',
            'source_id'       => $billingAccount->id,
            'account_no'      => $accountNo,
            'operation'       => 'reconnect_user',
            'params'          => $params,
            'last_error'      => $error,
            'created_by'      => $updatedBy,
        ]);

        if ($queuedId) {
            return [
                'message' => 'Account set to VIP. RADIUS reconnect has been queued and will be processed automatically.',
                'queued' => true,
            ];
        }

        return [
            'message' => 'Account set to VIP, but the RADIUS reconnect failed and could not be queued. Please notify an administrator to reconnect this account manually.',
            'queued' => false,
        ];
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




