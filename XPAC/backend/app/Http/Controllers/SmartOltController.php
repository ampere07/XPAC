<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\SmartOlt;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

use App\Models\TechnicalDetail;

class SmartOltController extends Controller
{
    public function index()
    {
        try {
            $configs = SmartOlt::all();
            return response()->json([
                'success' => true,
                'data' => $configs
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching configs: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'sub_domain' => 'required|string',
                'token' => 'required|string'
            ]);

            $config = SmartOlt::create($validated);

            return response()->json([
                'success' => true,
                'message' => 'SmartOLT configuration created successfully',
                'data' => $config
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error creating config: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $config = SmartOlt::findOrFail($id);

            $validated = $request->validate([
                'sub_domain' => 'required|string',
                'token' => 'required|string'
            ]);

            $config->update($validated);

            return response()->json([
                'success' => true,
                'message' => 'SmartOLT configuration updated successfully',
                'data' => $config
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating config: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $config = SmartOlt::findOrFail($id);
            $config->delete();

            return response()->json([
                'success' => true,
                'message' => 'SmartOLT configuration deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting config: ' . $e->getMessage()
            ], 500);
        }
    }

    public function validateOnuSn(Request $request)
    {
        try {
            Log::channel('smartoltrelated')->info('Validating ONU SN Request:', $request->all());

            $sn = $request->input('sn');

            if (!$sn) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router Modem SN is required'
                ], 400);
            }

            // Get SmartOLT configuration from database
            $config = SmartOlt::first();

            if (!$config) {
                Log::channel('smartoltrelated')->error('SmartOLT Validation Failed (Config Missing):', [
                    'jo_id' => $request->input('jo_id'),
                    'so_id' => $request->input('so_id'),
                    'user_email' => $request->input('user_email')
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Cant Connect to SmartOLT. Please contact admin.'
                ], 404);
            }

            $subDomain = $config->sub_domain;
            $token = $config->token;

            // Construct URL
            $url = "https://{$subDomain}.smartolt.com/api/onu/get_onus_details_by_sn/{$sn}";

            Log::channel('smartoltrelated')->info("Calling SmartOLT API: $url");

            // Make request
            $response = Http::withHeaders([
                'X-Token' => $token
            ])->get($url);

            Log::channel('smartoltrelated')->info('SmartOLT API Response Status: ' . $response->status());
            
            if ($response->successful()) {
                $data = $response->json();
                
                // Check if SmartOLT returned an error status
                if (isset($data['status']) && $data['status'] === false) {
                    $errorMsg = $data['error'] ?? 'Unknown error';
                    Log::channel('smartoltrelated')->warning('SmartOLT Validation Failed (API Error):', [
                        'sn' => $sn,
                        'error' => $errorMsg,
                        'jo_id' => $request->input('jo_id'),
                        'so_id' => $request->input('so_id'),
                        'user_email' => $request->input('user_email')
                    ]);
                    return response()->json([
                        'success' => false,
                        'message' => 'SmartOLT API: ' . $errorMsg
                    ], 200);
                }

                if (isset($data['onus']) && is_array($data['onus'])) {
                    if (!empty($data['onus'])) {
                        // With get_onus_details_by_sn, it should return the specific ONU
                        $onuDetails = $data['onus'][0];

                        // Check if SN is already in use in technical_details.
                        //
                        // account_no scopes this to a CONFLICT with someone else. When editing an
                        // account's own technical details the serial is already stored against
                        // that very account, and treating that as a duplicate blocked staff from
                        // re-validating an unchanged modem just to pull its router model. Another
                        // account holding the serial is still rejected.
                        $excludeAccountNo = $request->input('account_no');

                        $duplicateQuery = TechnicalDetail::where('router_modem_sn', $sn);
                        if (!empty($excludeAccountNo)) {
                            $duplicateQuery->where('account_no', '!=', $excludeAccountNo);
                        }
                        $exists = $duplicateQuery->exists();

                        if ($exists) {
                            Log::channel('smartoltrelated')->warning('SmartOLT Validation Failed (Duplicate in DB):', [
                                'sn' => $sn,
                                'jo_id' => $request->input('jo_id'),
                                'so_id' => $request->input('so_id'),
                                'user_email' => $request->input('user_email')
                            ]);
                            return response()->json([
                                'success' => false,
                                'message' => 'Serial Number already exists in our system'
                            ], 200);
                        }

                        return response()->json([
                            'success' => true,
                            'data' => $onuDetails,
                            'message' => 'Valid router model sn'
                        ]);
                    } else {
                        Log::channel('smartoltrelated')->warning('SmartOLT Validation Failed (Not Found):', [
                            'sn' => $sn,
                            'jo_id' => $request->input('jo_id'),
                            'so_id' => $request->input('so_id'),
                            'user_email' => $request->input('user_email')
                        ]);
                        return response()->json([
                            'success' => false,
                            'message' => 'Serial Number not found in SmartOLT system'
                        ], 200);
                    }
                } else {
                    Log::channel('smartoltrelated')->error('SmartOLT Invalid Response Structure:', ['response' => $data]);
                    return response()->json([
                        'success' => false,
                        'message' => 'Invalid response structure from SmartOLT'
                    ], 200);
                }

            } else {
                $errorMessage = 'Error communicating with SmartOLT: ' . $response->status();
                try {
                    $errorData = $response->json();
                    if (isset($errorData['message'])) {
                        $errorMessage = $errorData['message'];
                    } elseif (isset($errorData['error'])) {
                        $errorMessage = $errorData['error'];
                    }
                } catch (\Exception $e) {}

                Log::channel('smartoltrelated')->error('SmartOLT Validation Failed (HTTP Error):', [
                    'sn' => $sn,
                    'status' => $response->status(),
                    'error' => $errorMessage,
                    'jo_id' => $request->input('jo_id'),
                    'so_id' => $request->input('so_id'),
                    'user_email' => $request->input('user_email')
                ]);

                return response()->json([
                    'success' => false,
                    'message' => $errorMessage
                ], 400);
            }

        } catch (\Exception $e) {
            $isConnectionError = str_contains(strtolower($e->getMessage()), 'resolve') || 
                               str_contains(strtolower($e->getMessage()), 'timeout') || 
                               str_contains(strtolower($e->getMessage()), 'connect');

            $logMsg = $isConnectionError ? 'SmartOLT Validation Failed (Connection Error): ' : 'SmartOLT Validation Exception: ';
            
            Log::channel('smartoltrelated')->error($logMsg . $e->getMessage(), [
                'jo_id' => $request->input('jo_id'),
                'so_id' => $request->input('so_id'),
                'user_email' => $request->input('user_email'),
                'trace' => $e->getTraceAsString()
            ]);

            $userMessage = $isConnectionError 
                ? 'Could not connect to SmartOLT API. Please check server internet connection.'
                : 'Error validating router model sn: ' . $e->getMessage();

            return response()->json([
                'success' => false,
                'message' => $userMessage
            ], 500);
        }
    }

    public function updateOnuNameBySn(Request $request)
    {
        try {
            Log::channel('smartoltrelated')->info('Updating ONU Name By SN Request:', $request->all());

            $sn = $request->input('sn');
            $pppoe_username = $request->input('pppoe_username');
            // Optional location details sent alongside the name. 'address' is accepted as an alias
            // so older clients that already post that key keep working.
            $addressOrComment = trim((string) ($request->input('address_or_comment') ?? $request->input('address') ?? ''));
            $contact = trim((string) $request->input('contact', ''));

            if (!$sn) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router Modem SN is required'
                ], 400);
            }

            if (!$pppoe_username) {
                return response()->json([
                    'success' => false,
                    'message' => 'PPPoE Username is required'
                ], 400);
            }

            // Get SmartOLT configuration from database
            $config = SmartOlt::first();

            if (!$config) {
                Log::channel('smartoltrelated')->error('SmartOLT Name Update Failed (Config Missing)');
                return response()->json([
                    'success' => false,
                    'message' => 'Cant Connect to SmartOLT. Please contact admin.'
                ], 404);
            }

            $subDomain = $config->sub_domain;
            $token = $config->token;

            // Step 1: Retrieve ONU details using Serial Number
            $getOnuUrl = "https://{$subDomain}.smartolt.com/api/onu/get_onus_details_by_sn/{$sn}";
            Log::channel('smartoltrelated')->info("Calling SmartOLT API to get ONU details: $getOnuUrl");

            $getOnuResponse = Http::withHeaders([
                'X-Token' => $token
            ])->get($getOnuUrl);

            Log::channel('smartoltrelated')->info('SmartOLT Get ONU Details API Response Status: ' . $getOnuResponse->status());

            if (!$getOnuResponse->successful()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to fetch ONU details from SmartOLT: ' . $getOnuResponse->status()
                ], 400);
            }

            $getOnuData = $getOnuResponse->json();

            // Check if SmartOLT returned an error status in get_onus_details_by_sn
            if (isset($getOnuData['status']) && $getOnuData['status'] === false) {
                $errorMsg = $getOnuData['error'] ?? 'Unknown error';
                Log::channel('smartoltrelated')->warning('SmartOLT Get ONU Details Failed (API Error):', [
                    'sn' => $sn,
                    'error' => $errorMsg
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'SmartOLT API error: ' . $errorMsg
                ], 200);
            }

            if (!isset($getOnuData['onus']) || !is_array($getOnuData['onus']) || empty($getOnuData['onus'])) {
                Log::channel('smartoltrelated')->warning('SmartOLT Get ONU Details Failed (Not Found):', [
                    'sn' => $sn
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Serial Number not found in SmartOLT system'
                ], 404);
            }

            $onuDetails = $getOnuData['onus'][0];
            $onuExternalId = $onuDetails['unique_external_id'] ?? $onuDetails['onu_external_id'] ?? $onuDetails['id'] ?? null;

            if (!$onuExternalId) {
                Log::channel('smartoltrelated')->error('SmartOLT Get ONU Details Failed (No External ID):', [
                    'sn' => $sn,
                    'onu_details' => $onuDetails
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Could not determine the unique external ID for the ONU.'
                ], 400);
            }

            // Step 2: Call update_location_details to update the name
            $updateUrl = "https://{$subDomain}.smartolt.com/api/onu/update_location_details/{$onuExternalId}";
            Log::channel('smartoltrelated')->info("Calling SmartOLT API to update ONU name: $updateUrl for external ID: $onuExternalId");

            // update_location_details carries the ONU's whole location block, so the address and
            // contact go in the same POST as the name — the parameter names mirror the fields shown
            // in the SmartOLT UI ("Name", "Address or comment", "Contact").
            //
            // Only non-empty values are sent: posting a blank would overwrite whatever an
            // installer had already typed into SmartOLT with nothing.
            $updatePayload = ['name' => $pppoe_username];
            if ($addressOrComment !== '') {
                $updatePayload['address_or_comment'] = $addressOrComment;
            }
            if ($contact !== '') {
                $updatePayload['contact'] = $contact;
            }

            // Logged so a rejected/ignored parameter name is diagnosable from this channel alone.
            Log::channel('smartoltrelated')->info('SmartOLT Update ONU location payload:', [
                'sn' => $sn,
                'onu_external_id' => $onuExternalId,
                'fields' => array_keys($updatePayload),
                'payload' => $updatePayload,
            ]);

            $updateResponse = Http::withHeaders([
                'X-Token' => $token
            ])->asForm()->post($updateUrl, $updatePayload);

            Log::channel('smartoltrelated')->info('SmartOLT Update ONU Name API Response Status: ' . $updateResponse->status());

            if ($updateResponse->successful()) {
                $updateData = $updateResponse->json();
                
                if (isset($updateData['status']) && $updateData['status'] === false) {
                    $errorMsg = $updateData['error'] ?? 'Failed to update name';
                    Log::channel('smartoltrelated')->warning('SmartOLT Update ONU Name Failed (API Error):', [
                        'sn' => $sn,
                        'onu_external_id' => $onuExternalId,
                        'name' => $pppoe_username,
                        'error' => $errorMsg
                    ]);
                    return response()->json([
                        'success' => false,
                        'message' => 'SmartOLT API: ' . $errorMsg
                    ], 200);
                }

                Log::channel('smartoltrelated')->info('SmartOLT Update ONU Name Successful:', [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                    'name' => $pppoe_username,
                    'address_or_comment' => $addressOrComment ?: null,
                    'contact' => $contact ?: null,
                ]);

                // Name it explicitly so the caller can see whether the extra location fields were
                // actually included, rather than assuming they were.
                $updatedFields = ['name' => $pppoe_username];
                if ($addressOrComment !== '') $updatedFields['address'] = $addressOrComment;
                if ($contact !== '') $updatedFields['contact'] = $contact;

                return response()->json([
                    'success' => true,
                    'message' => 'ONU updated successfully (' . implode(', ', array_keys($updatedFields)) . ') — name: ' . $pppoe_username,
                    'updated' => $updatedFields,
                ]);
            } else {
                $errorMessage = 'Error updating ONU name in SmartOLT: ' . $updateResponse->status();
                try {
                    $errorData = $updateResponse->json();
                    if (isset($errorData['message'])) {
                        $errorMessage = $errorData['message'];
                    } elseif (isset($errorData['error'])) {
                        $errorMessage = $errorData['error'];
                    }
                } catch (\Exception $e) {}

                Log::channel('smartoltrelated')->error('SmartOLT Update ONU Name Failed (HTTP Error):', [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                    'name' => $pppoe_username,
                    'status' => $updateResponse->status(),
                    'error' => $errorMessage
                ]);

                return response()->json([
                    'success' => false,
                    'message' => $errorMessage
                ], 400);
            }

        } catch (\Exception $e) {
            $isConnectionError = str_contains(strtolower($e->getMessage()), 'resolve') || 
                               str_contains(strtolower($e->getMessage()), 'timeout') || 
                               str_contains(strtolower($e->getMessage()), 'connect');

            $logMsg = $isConnectionError ? 'SmartOLT Update ONU Name Failed (Connection Error): ' : 'SmartOLT Update ONU Name Exception: ';
            
            Log::channel('smartoltrelated')->error($logMsg . $e->getMessage(), [
                'sn' => $request->input('sn'),
                'pppoe_username' => $request->input('pppoe_username'),
                'address_or_comment' => $request->input('address_or_comment') ?? $request->input('address'),
                'contact' => $request->input('contact'),
                'trace' => $e->getTraceAsString()
            ]);

            $userMessage = $isConnectionError 
                ? 'Could not connect to SmartOLT API. Please check server internet connection.'
                : 'Error updating ONU name: ' . $e->getMessage();

            return response()->json([
                'success' => false,
                'message' => $userMessage
            ], 500);
        }
    }

    public function deleteOnuNameBySn(Request $request)
    {
        try {
            Log::channel('smartoltrelated')->info('Deleting ONU Name By SN Request:', $request->all());

            $sn = $request->input('sn');

            if (!$sn) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router Modem SN is required'
                ], 400);
            }

            // Get SmartOLT configuration from database
            $config = SmartOlt::first();

            if (!$config) {
                Log::channel('smartoltrelated')->error('SmartOLT Name Delete Failed (Config Missing)');
                return response()->json([
                    'success' => false,
                    'message' => 'Cant Connect to SmartOLT. Please contact admin.'
                ], 404);
            }

            $subDomain = $config->sub_domain;
            $token = $config->token;

            // Step 1: Retrieve ONU details using Serial Number
            $getOnuUrl = "https://{$subDomain}.smartolt.com/api/onu/get_onus_details_by_sn/{$sn}";
            Log::channel('smartoltrelated')->info("Calling SmartOLT API to get ONU details: $getOnuUrl");

            $getOnuResponse = Http::withHeaders([
                'X-Token' => $token
            ])->get($getOnuUrl);

            Log::channel('smartoltrelated')->info('SmartOLT Get ONU Details API Response Status: ' . $getOnuResponse->status());

            if (!$getOnuResponse->successful()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to fetch ONU details from SmartOLT: ' . $getOnuResponse->status()
                ], 400);
            }

            $getOnuData = $getOnuResponse->json();

            // Check if SmartOLT returned an error status in get_onus_details_by_sn
            if (isset($getOnuData['status']) && $getOnuData['status'] === false) {
                $errorMsg = $getOnuData['error'] ?? 'Unknown error';
                Log::channel('smartoltrelated')->warning('SmartOLT Get ONU Details Failed (API Error):', [
                    'sn' => $sn,
                    'error' => $errorMsg
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'SmartOLT API error: ' . $errorMsg
                ], 200);
            }

            if (!isset($getOnuData['onus']) || !is_array($getOnuData['onus']) || empty($getOnuData['onus'])) {
                Log::channel('smartoltrelated')->warning('SmartOLT Get ONU Details Failed (Not Found):', [
                    'sn' => $sn
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Serial Number not found in SmartOLT system'
                ], 404);
            }

            $onuDetails = $getOnuData['onus'][0];
            $onuExternalId = $onuDetails['unique_external_id'] ?? $onuDetails['onu_external_id'] ?? $onuDetails['id'] ?? null;

            if (!$onuExternalId) {
                Log::channel('smartoltrelated')->error('SmartOLT Get ONU Details Failed (No External ID):', [
                    'sn' => $sn,
                    'onu_details' => $onuDetails
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'Could not determine the unique external ID for the ONU.'
                ], 400);
            }

            // Step 2: Call update_location_details to update the name to empty
            $updateUrl = "https://{$subDomain}.smartolt.com/api/onu/update_location_details/{$onuExternalId}";
            Log::channel('smartoltrelated')->info("Calling SmartOLT API to delete ONU name: $updateUrl for external ID: $onuExternalId");

            $updateResponse = Http::withHeaders([
                'X-Token' => $token
            ])->asForm()->post($updateUrl, [
                'name' => ''
            ]);

            Log::channel('smartoltrelated')->info('SmartOLT Delete ONU Name API Response Status: ' . $updateResponse->status());

            if ($updateResponse->successful()) {
                $updateData = $updateResponse->json();
                
                if (isset($updateData['status']) && $updateData['status'] === false) {
                    $errorMsg = $updateData['error'] ?? 'Failed to delete name';
                    Log::channel('smartoltrelated')->warning('SmartOLT Delete ONU Name Failed (API Error):', [
                        'sn' => $sn,
                        'onu_external_id' => $onuExternalId,
                        'error' => $errorMsg
                    ]);
                    return response()->json([
                        'success' => false,
                        'message' => 'SmartOLT API: ' . $errorMsg
                    ], 200);
                }

                Log::channel('smartoltrelated')->info('SmartOLT Delete ONU Name Successful:', [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId
                ]);

                return response()->json([
                    'success' => true,
                    'message' => 'ONU name cleared successfully'
                ]);
            } else {
                $errorMessage = 'Error clearing ONU name in SmartOLT: ' . $updateResponse->status();
                try {
                    $errorData = $updateResponse->json();
                    if (isset($errorData['message'])) {
                        $errorMessage = $errorData['message'];
                    } elseif (isset($errorData['error'])) {
                        $errorMessage = $errorData['error'];
                    }
                } catch (\Exception $e) {}

                Log::channel('smartoltrelated')->error('SmartOLT Delete ONU Name Failed (HTTP Error):', [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                    'status' => $updateResponse->status(),
                    'error' => $errorMessage
                ]);

                return response()->json([
                    'success' => false,
                    'message' => $errorMessage
                ], 400);
            }

        } catch (\Exception $e) {
            $isConnectionError = str_contains(strtolower($e->getMessage()), 'resolve') || 
                               str_contains(strtolower($e->getMessage()), 'timeout') || 
                               str_contains(strtolower($e->getMessage()), 'connect');

            $logMsg = $isConnectionError ? 'SmartOLT Delete ONU Name Failed (Connection Error): ' : 'SmartOLT Delete ONU Name Exception: ';
            
            Log::channel('smartoltrelated')->error($logMsg . $e->getMessage(), [
                'sn' => $request->input('sn'),
                'trace' => $e->getTraceAsString()
            ]);

            $userMessage = $isConnectionError 
                ? 'Could not connect to SmartOLT API. Please check server internet connection.'
                : 'Error clearing ONU name: ' . $e->getMessage();

            return response()->json([
                'success' => false,
                'message' => $userMessage
            ], 500);
        }
    }
}