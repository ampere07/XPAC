<?php

namespace App\Http\Controllers;

use App\Services\DirectCustomerService;
use App\Support\AgentAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * SuperAdmin "+ Add Customer" on the Customers page: create a complete customer and its RADIUS
 * account without an application or job order. See DirectCustomerService.
 */
class DirectCustomerController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        // The route carries role:superadmin too. This check is the stricter of the two: a custom
        // role built on SuperAdmin passes the middleware, but only the SuperAdmin role passes here.
        if (!AgentAccess::isSuperAdmin(auth()->user())) {
            return response()->json([
                'success' => false,
                'message' => 'Only a SuperAdmin can add customers directly.',
            ], 403);
        }

        try {
            $validated = $request->validate([
                // Customer information
                'first_name' => 'required|string|max:255',
                'middle_initial' => 'nullable|string|max:10',
                'last_name' => 'required|string|max:255',
                'email_address' => 'required|email|max:255',
                'contact_number_primary' => 'required|string|max:50',
                'contact_number_secondary' => 'nullable|string|max:50',
                'address' => 'required|string',
                'region' => 'required|string|max:255',
                'city' => 'required|string|max:255',
                'barangay' => 'required|string|max:255',
                'location' => 'nullable|string|max:255',
                'address_coordinates' => 'nullable|string|max:255',
                'housing_status' => 'nullable|string|max:255',
                'referred_by' => 'nullable|string|max:255',
                'plan_id' => 'required|integer|exists:plan_list,id',

                // Billing account
                'generation_type' => 'required|string|in:Prepaid,Postpaid',
                // 0 = the last day of the month. Prepaid has no billing day.
                'billing_day' => 'nullable|required_if:generation_type,Postpaid|integer|min:0|max:31',
                'date_installed' => 'required|date',
                'installation_fee' => 'nullable|numeric|min:0',
                'vat_enabled' => 'nullable|boolean',
                'withholding_enabled' => 'nullable|boolean',
                'withholding_percentage' => 'nullable|required_if:withholding_enabled,true|numeric|gt:0|max:100',

                // Technical details
                'connection_type' => 'nullable|string|in:Fiber,Antenna,Local',
                'router_model' => 'required|string|max:255',
                'router_modem_sn' => 'nullable|string|max:255',
                'ip_address' => 'nullable|required_if:connection_type,Antenna,Local|string|max:45',
                'lcpnap' => 'nullable|string|max:255',
                'port' => 'nullable|string|max:255',
                'vlan' => 'nullable|string|max:255',
                'usage_type' => 'nullable|string|max:255',

                // RADIUS / internet account — blank = generated from the PPPoE patterns
                'pppoe_username' => ['nullable', 'string', 'max:64', 'regex:/^\S+$/'],
                'pppoe_password' => 'nullable|string|max:64',
            ], [
                'pppoe_username.regex' => 'The PPPoE username cannot contain spaces.',
            ], [
                'plan_id' => 'plan',
                'generation_type' => 'billing type',
                'contact_number_primary' => 'contact number',
                'contact_number_secondary' => 'second contact number',
                'router_modem_sn' => 'router serial number',
                'ip_address' => 'IP address',
                'lcpnap' => 'LCP-NAP',
                'vlan' => 'VLAN',
                'pppoe_username' => 'PPPoE username',
                'pppoe_password' => 'PPPoE password',
            ]);

            $result = app(DirectCustomerService::class)->create($validated, auth()->user());

            return response()->json([
                'success' => true,
                'message' => "Customer {$result['account_no']} created.",
                'data' => $result,
            ], 201);
        } catch (ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors(),
            ], 422);
        } catch (\Throwable $e) {
            Log::error('[DIRECT ADD] Customer was not created', [
                'error' => $e->getMessage(),
                'user_id' => auth()->id(),
            ]);

            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}
