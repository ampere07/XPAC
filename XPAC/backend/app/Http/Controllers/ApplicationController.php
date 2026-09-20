<?php

namespace App\Http\Controllers;

use App\Models\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use App\Models\AuditTrailLog;
use App\Models\ActivityLog;
use App\Models\User;
use App\Events\ApplicationViewingUpdate;

class ApplicationController extends Controller
{
    /**
     * How many applications the signed-in user has submitted.
     *
     * Counted on created_by_user_id, which store() stamps with the submitting
     * account on every application. That answers "how many did I send" exactly,
     * where the referred_by free text this used to match on answers a different
     * question — who the customer was referred by, which someone else may have
     * typed and which the agent's referral counts already report.
     *
     * Its own endpoint because index() is scoped to an organisation rather than
     * to a caller, so an agent is refused it and could not count their own rows
     * from the list.
     *
     * No organisation filter: the column already names the caller, and adding
     * one would drop the applications of anyone since moved between them.
     */
    public function myCount(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $count = Application::where('created_by_user_id', $user->id)->count();

            return response()->json(['success' => true, 'count' => $count]);
        } catch (\Exception $e) {
            Log::error('ApplicationController::myCount failed: ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Failed to count applications'], 500);
        }
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->input('page', 1);
            $limit = (int) $request->input('limit', 50); 
            $search = $request->input('search', '');
            $fastMode = $request->boolean('fast', false); 
            $since = $request->input('since'); 

            Log::info('ApplicationController: Fetching applications', [
                'page' => $page,
                'limit' => $limit,
                'fast_mode' => $fastMode,
                'since' => $since
            ]);

            // Define columns to select to reduce memory/bandwidth
            $columns = [
                'id', 'first_name', 'middle_initial', 'last_name', 
                'timestamp', 'status', 'city', 'installation_address', 
                'organization_id', 'created_at', 'updated_at'
            ];

            if (!$fastMode) {
                $columns = ['*'];
            }

            $query = Application::select($columns)->orderBy('id', 'desc');

            // Apply organization filter
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            // Apply 'since' filter if provided
            if ($since) {
                $query->where('updated_at', '>', $since);
            }

            // Apply search filter
            if ($search) {
                $query->where(function ($q) use ($search) {
                    $q->where('first_name', 'LIKE', "%{$search}%")
                      ->orWhere('last_name', 'LIKE', "%{$search}%")
                      ->orWhere('email_address', 'LIKE', "%{$search}%")
                      ->orWhere('mobile_number', 'LIKE', "%{$search}%")
                      ->orWhere('installation_address', 'LIKE', "%{$search}%")
                      ->orWhere('city', 'LIKE', "%{$search}%");
                });
            }

            // Fetch total count for pagination
            $totalCount = $query->count();

            // Fetch records for the current page
            $applications = $query->skip(($page - 1) * $limit)
                ->take($limit + 1)
                ->get();

            $hasMore = $applications->count() > $limit;

            if ($hasMore) {
                $applications = $applications->slice(0, $limit);
            }

            $formattedApplications = $applications->map(function ($app) use ($fastMode) {
                $data = [
                    'id' => (string)$app->id,
                    'customer_name' => $this->getFullName($app),
                    'timestamp' => $app->timestamp ? $app->timestamp->format('Y-m-d H:i:s') : null,
                    'status' => $app->status ?? 'pending',
                    'first_name' => $app->first_name,
                    'last_name' => $app->last_name,
                    'city' => $app->city,
                    'installation_address' => $app->installation_address ?? '',
                    'address' => $app->installation_address ?? '',
                    'create_date' => $app->timestamp ? $app->timestamp->format('Y-m-d') : null,
                    'create_time' => $app->timestamp ? $app->timestamp->format('H:i:s') : null,
                    'organization_id' => $app->organization_id,
                    'updated_at' => $app->updated_at ? $app->updated_at->format('Y-m-d H:i:s') : null,
                ];

                if (!$fastMode) {
                    $data = array_merge($data, [
                        'email_address' => $app->email_address,
                        'middle_initial' => $app->middle_initial,
                        'mobile_number' => $app->mobile_number,
                        'secondary_mobile_number' => $app->secondary_mobile_number,
                        'landmark' => $app->landmark,
                        'region' => $app->region,
                        'barangay' => $app->barangay,
                        'location' => $app->location,
                        'desired_plan' => $app->desired_plan,
                        'promo' => $app->promo,
                        'referrer_account_id' => $app->referrer_account_id,
                        // Shown as a name; the id travels beside it so an edit form can
                        // write the same referral back instead of turning it into a name.
                        'referred_by' => \App\Support\AgentReferral::displayName($app->referred_by),
                        'referred_by_agent_id' => \App\Support\AgentReferral::agentId($app->referred_by),
                        'proof_of_billing_url' => $app->proof_of_billing_url,
                        'government_valid_id_url' => $app->government_valid_id_url,
                        'secondary_government_valid_id_url' => $app->secondary_government_valid_id_url,
                        'house_front_picture_url' => $app->house_front_picture_url,
                        'promo_url' => $app->promo_url,
                        'nearest_landmark1_url' => $app->nearest_landmark1_url,
                        'nearest_landmark2_url' => $app->nearest_landmark2_url,
                        'document_attachment_url' => $app->document_attachment_url,
                        'other_isp_bill_url' => $app->other_isp_bill_url,
                        'terms_agreed' => $app->terms_agreed,
                        'created_at' => $app->created_at ? $app->created_at->format('Y-m-d H:i:s') : null,
                        'created_by_user_id' => $app->created_by_user_id,
                        'updated_by' => $app->updated_by,
                        'long_lat' => $app->long_lat,
                    ]);
                }

                return $data;
            });

            return response()->json([
                'success' => true,
                'applications' => $formattedApplications->values(),
                'pagination' => [
                    'current_page' => (int) $page,
                    'per_page' => (int) $limit,
                    'total_count' => (int) $totalCount,
                    'has_more' => $hasMore
                ]
            ]);
        } catch (\Exception $e) {
            Log::error('ApplicationController index error: ' . $e->getMessage());
            Log::error('ApplicationController trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'error' => $e->getMessage(),
                'message' => 'Failed to fetch applications',
                'success' => false
            ], 500);
        }
    }
    
    private function getFullName($app)
    {
        $parts = array_filter([
            $app->first_name ?? '',
            $app->middle_initial ?? '',
            $app->last_name ?? ''
        ]);
        
        return implode(' ', $parts) ?: 'Unknown';
    }
    
    private function getLocationName($region, $city)
    {
        try {
            $locationParts = array_filter([$region, $city]);
            return implode(', ', $locationParts) ?: 'Unknown Location';
        } catch (\Exception $e) {
            Log::error('Failed to get location name: ' . $e->getMessage());
            return 'Unknown Location';
        }
    }
    
    private function broadcastNewApplication($application)
    {
        try {
            $data = [
                'id' => $application->id,
                'type' => 'application',
                'customer_name' => $this->getFullName($application),
                'plan_name' => $application->desired_plan ?? 'Unknown',
                'status' => $application->status ?? 'pending',
                'title' => 'New Application',
                'message' => 'A new customer application has been received',
                'timestamp' => now()->timestamp,
                'organization_id' => $application->organization_id
            ];

            event(new \App\Events\NewApplicationCreated($data));
        } catch (\Exception $e) {
            Log::warning('Failed to broadcast new application via Soketi', [
                'error' => $e->getMessage()
            ]);
        }
    }

    public function store(Request $request)
    {
        try {
            $validatedData = $request->validate([
                'email_address' => 'required|email',
                'first_name' => 'required|string|max:255',
                'middle_initial' => 'nullable|string|max:1',
                'last_name' => 'required|string|max:255',
                'mobile_number' => 'required|string|max:50',
                'secondary_mobile_number' => 'nullable|string|max:50',
                'region' => 'required|string|max:255',
                'city' => 'required|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'installation_address' => 'required',
                'landmark' => 'nullable',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'promo' => 'nullable|string|max:255',
                'proof_of_billing_url' => 'nullable|string|max:255',
                'government_valid_id_url' => 'nullable|string|max:255',
                'secondary_government_valid_id_url' => 'nullable|string|max:255',
                'house_front_picture_url' => 'nullable|string|max:255',
                'promo_url' => 'nullable|string|max:255',
                'nearest_landmark1_url' => 'nullable|string|max:255',
                'nearest_landmark2_url' => 'nullable|string|max:255',
                'document_attachment_url' => 'nullable|string|max:255',
                'other_isp_bill_url' => 'nullable|string|max:255',
                'terms_agreed' => 'nullable|boolean',
                'status' => 'nullable|string|max:100',
                'long_lat' => 'nullable|string|max:255',
                'organization_id' => 'nullable|integer'
            ]);

            $validatedData['timestamp'] = now();
            $validatedData['created_by_user_id'] = auth()->id();
            
            // If not provided, default to current user's organization
            if (!isset($validatedData['organization_id']) && auth()->user()?->organization_id) {
                $validatedData['organization_id'] = auth()->user()->organization_id;
            }

            $application = Application::create($validatedData);

            $userEmail = $request->input('updated_by') ?? auth()->user()?->email;
            if (!$userEmail) {
                throw new \Exception("Logged in user email is required for auditing.");
            }

            // Audit Trail Log
            AuditTrailLog::create([
                'old_details' => null,
                'new_details' => [
                    'type' => 'applications',
                    'id' => $application->id,
                    'data' => $application->fresh()->toArray()
                ],
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            $this->broadcastNewApplication($application);

            // Create Activity Log
            ActivityLog::log(
                'Application Created',
                "New Application received for {$application->first_name} {$application->last_name} ({$application->desired_plan})",
                'info',
                [
                    'resource_type' => 'Application',
                    'resource_id' => $application->id,
                    'additional_data' => [
                        'email' => $application->email_address,
                        'plan' => $application->desired_plan,
                        'city' => $application->city
                    ]
                ]
            );

            $formattedApplication = [
                'id' => (string)$application->id,
                'customer_name' => $this->getFullName($application),
                'timestamp' => $application->timestamp ? $application->timestamp->format('Y-m-d H:i:s') : null,
                'address' => $application->installation_address ?? '',
                'status' => $application->status ?? 'pending',
                'location' => $this->getLocationName($application->region ?? '', $application->city ?? ''),
                'email_address' => $application->email_address,
                'first_name' => $application->first_name,
                'middle_initial' => $application->middle_initial,
                'last_name' => $application->last_name,
                'mobile_number' => $application->mobile_number,
                'secondary_mobile_number' => $application->secondary_mobile_number,
                'installation_address' => $application->installation_address,
                'landmark' => $application->landmark,
                'region' => $application->region,
                'city' => $application->city,
                'barangay' => $application->barangay,
                'desired_plan' => $application->desired_plan,
                'promo' => $application->promo,
                // Shown as a name; the id travels beside it so an edit form can
                // write the same referral back instead of turning it into a name.
                'referred_by' => \App\Support\AgentReferral::displayName($application->referred_by),
                'referred_by_agent_id' => \App\Support\AgentReferral::agentId($application->referred_by),
                'proof_of_billing_url' => $application->proof_of_billing_url,
                'government_valid_id_url' => $application->government_valid_id_url,
                'secondary_government_valid_id_url' => $application->secondary_government_valid_id_url,
                'house_front_picture_url' => $application->house_front_picture_url,
                'promo_url' => $application->promo_url,
                'nearest_landmark1_url' => $application->nearest_landmark1_url,
                'nearest_landmark2_url' => $application->nearest_landmark2_url,
                'document_attachment_url' => $application->document_attachment_url,
                'other_isp_bill_url' => $application->other_isp_bill_url,
                'terms_agreed' => $application->terms_agreed,
                'long_lat' => $application->long_lat,
                'organization_id' => $application->organization_id,
            ];

            return response()->json([
                'message' => 'Application created successfully',
                'application' => $formattedApplication,
                'success' => true
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('ApplicationController store validation error: ' . json_encode($e->errors()));
            return response()->json([
                'message' => 'Validation failed',
                'errors' => $e->errors(),
                'success' => false
            ], 422);
        } catch (\Exception $e) {
            Log::error('ApplicationController store error: ' . $e->getMessage());
            Log::error('ApplicationController store trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'message' => 'Failed to create application',
                'error' => $e->getMessage(),
                'success' => false
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            Log::info('ApplicationController show: Fetching application ID: ' . $id);
            
            $query = Application::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $application = $query->findOrFail($id);
            
            $formattedApplication = [
                'id' => (string)$application->id,
                'customer_name' => $this->getFullName($application),
                'timestamp' => $application->timestamp ? $application->timestamp->format('Y-m-d H:i:s') : null,
                'address' => $application->installation_address ?? '',
                'address_line' => $application->installation_address ?? '',
                'status' => $application->status ?? 'pending',
                'email_address' => $application->email_address,
                'first_name' => $application->first_name,
                'middle_initial' => $application->middle_initial,
                'last_name' => $application->last_name,
                'mobile_number' => $application->mobile_number,
                'secondary_mobile_number' => $application->secondary_mobile_number,
                'installation_address' => $application->installation_address,
                'landmark' => $application->landmark,
                'region' => $application->region,
                'city' => $application->city,
                'barangay' => $application->barangay,
                'location' => $application->location,
                'desired_plan' => $application->desired_plan,
                'promo' => $application->promo,
                'referrer_account_id' => $application->referrer_account_id,
                // Shown as a name; the id travels beside it so an edit form can
                // write the same referral back instead of turning it into a name.
                'referred_by' => \App\Support\AgentReferral::displayName($application->referred_by),
                'referred_by_agent_id' => \App\Support\AgentReferral::agentId($application->referred_by),
                'proof_of_billing_url' => $application->proof_of_billing_url,
                'government_valid_id_url' => $application->government_valid_id_url,
                'secondary_government_valid_id_url' => $application->secondary_government_valid_id_url,
                'house_front_picture_url' => $application->house_front_picture_url,
                'promo_url' => $application->promo_url,
                'nearest_landmark1_url' => $application->nearest_landmark1_url,
                'nearest_landmark2_url' => $application->nearest_landmark2_url,
                'document_attachment_url' => $application->document_attachment_url,
                'other_isp_bill_url' => $application->other_isp_bill_url,
                'terms_agreed' => $application->terms_agreed,
                'created_at' => $application->created_at ? $application->created_at->format('Y-m-d H:i:s') : null,
                'updated_at' => $application->updated_at ? $application->updated_at->format('Y-m-d H:i:s') : null,
                'created_by_user_id' => $application->created_by_user_id,
                'updated_by' => $application->updated_by,
                'remarks' => $application->remarks,
                'long_lat' => $application->long_lat,
                'organization_id' => $application->organization_id,
                
                'create_date' => $application->timestamp ? $application->timestamp->format('Y-m-d') : null,
                'create_time' => $application->timestamp ? $application->timestamp->format('H:i:s') : null
            ];
            
            return response()->json([
                'application' => $formattedApplication,
                'success' => true
            ]);
        } catch (\Exception $e) {
            Log::error('ApplicationController show error: ' . $e->getMessage());
            
            return response()->json([
                'message' => 'Application not found or error retrieving application',
                'error' => $e->getMessage(),
                'success' => false
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validatedData = $request->validate([
                'status' => 'nullable|string|max:100',
                'email_address' => 'nullable|email',
                'first_name' => 'nullable|string|max:255',
                'middle_initial' => 'nullable|string|max:1',
                'last_name' => 'nullable|string|max:255',
                'mobile_number' => 'nullable|string|max:50',
                'secondary_mobile_number' => 'nullable|string|max:50',
                'region' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'location' => 'nullable|string|max:255',
                'installation_address' => 'nullable',
                'landmark' => 'nullable',
                'referred_by' => 'nullable|string|max:255',
                'desired_plan' => 'nullable|string|max:255',
                'promo' => 'nullable|string|max:255',
                'remarks' => 'nullable|string',
                'updated_by' => 'nullable|string|max:255',
                'long_lat' => 'nullable|string|max:255',
                'organization_id' => 'nullable|integer'
            ]);

            $query = Application::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $application = $query->findOrFail($id);
            $oldStatus = $application->status;

            Log::info("=== UPDATE PAYLOAD FOR APP #$id ===", $request->all());

            $userEmail = $request->input('updated_by') ?? auth()->user()?->email;
            if (!$userEmail) {
                // Fallback to system or something else if not provided, though it should be provided
                $userEmail = 'System';
            }
            $validatedData['updated_by'] = $userEmail;
            
            Log::info("=== VALIDATED DATA ===", $validatedData);
            
            $application->fill($validatedData);
            $dirtyAttributes = $application->getDirty();
            
            Log::info("=== DIRTY ATTRIBUTES ===", $dirtyAttributes);
            
            if (!empty($dirtyAttributes)) {
                $oldData = [];
                $newData = [];
                
                foreach ($dirtyAttributes as $key => $newValue) {
                    // We typically ignore 'updated_at' logging as a meaningful change unless something else changed
                    if ($key === 'updated_at') continue;
                    $oldData[$key] = $application->getOriginal($key);
                    $newData[$key] = $newValue;
                }
                
                $application->save();

                if (!empty($newData)) {
                    AuditTrailLog::create([
                        'old_details' => [
                            'type' => 'applications',
                            'id' => $application->id,
                            'data' => $oldData
                        ],
                        'new_details' => [
                            'type' => 'applications',
                            'id' => $application->id,
                            'data' => $newData
                        ],
                        'created_by_user' => $validatedData['updated_by'],
                        'updated_by_user' => $validatedData['updated_by']
                    ]);
                }
            } else {
                $application->save();
            }

            // Create Activity Log
            ActivityLog::log(
                'Application Updated',
                "Application #{$id} updated by " . (auth()->user()->email ?? 'System') . ($oldStatus !== $application->status ? " (Status: {$oldStatus} -> {$application->status})" : ""),
                'info',
                [
                    'resource_type' => 'Application',
                    'resource_id' => $id,
                    'additional_data' => [
                        'old_status' => $oldStatus,
                        'new_status' => $application->status,
                        'updated_fields' => array_keys($validatedData)
                    ]
                ]
            );

            return response()->json([
                'message' => 'Application updated successfully',
                'application' => $application,
                'success' => true
            ]);
        } catch (\Exception $e) {
            Log::error('ApplicationController update error: ' . $e->getMessage());
            
            return response()->json([
                'message' => 'Failed to update application',
                'error' => $e->getMessage(),
                'success' => false
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $query = Application::query();
            $currentUser = auth()->user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $application = $query->findOrFail($id);
            $applicationData = $application->toArray();
            $application->delete();

            $userEmail = request()->input('updated_by') ?? auth()->user()?->email;
            if (!$userEmail) {
                throw new \Exception("Logged in user email is required for auditing.");
            }

            // Audit Trail Log
            AuditTrailLog::create([
                'old_details' => [
                    'type' => 'applications',
                    'id' => $id,
                    'data' => $applicationData
                ],
                'new_details' => null,
                'created_by_user' => $userEmail,
                'updated_by_user' => $userEmail
            ]);

            // Create Activity Log
            ActivityLog::log(
                'Application Deleted',
                "Application #{$id} ({$applicationData['first_name']} {$applicationData['last_name']}) deleted by " . (auth()->user()->email ?? 'System'),
                'warning',
                [
                    'resource_type' => 'Application',
                    'resource_id' => $id,
                    'additional_data' => [
                        'application_data' => $applicationData
                    ]
                ]
            );

            return response()->json([
                'message' => 'Application deleted successfully',
                'success' => true
            ]);
        } catch (\Exception $e) {
            Log::error('ApplicationController destroy error: ' . $e->getMessage());
            
            return response()->json([
                'message' => 'Failed to delete application',
                'error' => $e->getMessage(),
                'success' => false
            ], 500);
        }
    }

    public function broadcastViewing(Request $request)
    {
        try {
            $applicationId = $request->input('application_id');
            $action = $request->input('action', 'started_viewing');
            $username = auth()->user()->username ?? 'Guest';

            event(new ApplicationViewingUpdate($applicationId, $username, $action));

            return response()->json([
                'success' => true,
                'message' => 'Viewing update broadcasted'
            ]);
        } catch (\Exception $e) {
            Log::error('broadcastViewing error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to broadcast viewing update'
            ], 500);
        }
    }

    public function uploadImages(Request $request, $id)
    {
        try {
            $application = Application::findOrFail($id);
            $driveService = resolve(\App\Services\GoogleDriveService::class);

            $folderName = $request->input('folder_name', "(application) " . $application->first_name . " " . $application->last_name);
            $folderId = $driveService->findFolder($folderName) ?? $driveService->createFolder($folderName);

            $imageUrls = [];
            $fields = [
                'proof_of_billing' => 'proof_of_billing_url',
                'government_valid_id' => 'government_valid_id_url',
                'secondary_government_valid_id' => 'secondary_government_valid_id_url',
                'house_front_image' => 'house_front_picture_url',
                'promo_image' => 'promo_url',
                'nearest_landmark1' => 'nearest_landmark1_url',
                'nearest_landmark2' => 'nearest_landmark2_url',
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
                    $oldData[$dbColumn] = $application->$dbColumn;
                    $newData[$dbColumn] = $newUrl;
                }

                $application->update($imageUrls);

                // Audit Trail Log
                $userEmail = auth()->user()?->email ?? 'System';
                AuditTrailLog::create([
                    'old_details' => [
                        'type' => 'applications',
                        'id' => $application->id,
                        'data' => $oldData
                    ],
                    'new_details' => [
                        'type' => 'applications',
                        'id' => $application->id,
                        'data' => $newData
                    ],
                    'created_by_user' => $userEmail,
                    'updated_by_user' => $userEmail
                ]);

                // Log Activity
                ActivityLog::log(
                    'Application Attachments Uploaded',
                    "Uploaded " . count($imageUrls) . " attachments for Application #{$id}",
                    'info',
                    [
                        'resource_type' => 'Application',
                        'resource_id' => $id,
                        'additional_data' => array_keys($imageUrls)
                    ]
                );
            }

            return response()->json([
                'success' => true,
                'message' => 'Images uploaded successfully',
                'data' => $imageUrls
            ]);

        } catch (\Exception $e) {
            Log::error('ApplicationController uploadImages error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to upload images',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


