<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LCPNAPLocation;
use App\Services\GoogleDriveService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;

class LcpNapLocationController extends Controller
{
    protected $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 1000), 1000);
            $search = $request->get('search', '');
            
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            if (!empty($search)) {
                $query->where(function($q) use ($search) {
                    $q->where('lcpnap_name', 'like', '%' . $search . '%')
                      ->orWhere('lcp', 'like', '%' . $search . '%')
                      ->orWhere('nap', 'like', '%' . $search . '%')
                      ->orWhere('location', 'like', '%' . $search . '%');
                });
            }
            
            $totalItems = $query->count();
            $totalPages = $limit > 0 ? ceil($totalItems / $limit) : 1;
            
            $lcpnapItems = $query->orderBy('id', 'desc')
                                 ->skip(($page - 1) * $limit)
                                 ->take($limit)
                                 ->get();
            
            return response()->json([
                'success' => true,
                'data' => $lcpnapItems,
                'pagination' => [
                    'current_page' => $page,
                    'total_pages' => $totalPages,
                    'total_items' => $totalItems,
                    'items_per_page' => $limit,
                    'has_next' => $page < $totalPages,
                    'has_prev' => $page > 1
                ]
            ]);
            
        } catch (\Exception $e) {
            Log::error('LCPNAP API Error: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching LCPNAP items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getLocations(Request $request)
    {
        try {
            $search = $request->get('search');
            $currentUser = Auth::user();
            
            // Step 1: Pre-aggregate session counts from technical_details + online_status
            $sessionStatsQuery = \DB::table('technical_details as td')
                ->leftJoin('online_status as os', 'td.account_id', '=', 'os.account_id')
                ->whereNotNull('td.lcpnap')
                ->where('td.lcpnap', '!=', '');
            
            // Filter session stats by organization
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $sessionStatsQuery->where('td.organization_id', $currentUser->organization_id);
                } else {
                    $sessionStatsQuery->whereNull('td.organization_id');
                }
            }

            $sessionStatsQuery->groupBy('td.lcpnap')
                ->select(
                    'td.lcpnap',
                    \DB::raw('COUNT(DISTINCT td.id) as total_technical_details'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Online" THEN os.id END) as active_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Restricted" THEN os.id END) as restricted_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Offline" THEN os.id END) as offline_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Disconnected" THEN os.id END) as disconnected_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Not Found" THEN os.id END) as not_found_sessions'),
                    \DB::raw('COUNT(DISTINCT os.id) as total_sessions')
                );

            if (!empty($search)) {
                $sessionStatsQuery->where('td.lcpnap', '=', $search);
            }

            $sessionStats = $sessionStatsQuery->get()->keyBy('lcpnap');

            // Step 2: Fetch LCPNAP locations with coordinates (lightweight query)
            $lcpnapQuery = LCPNAPLocation::whereNotNull('coordinates')
                ->where('coordinates', '!=', '');

            // Filter LCPNAP locations by organization
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $lcpnapQuery->where('organization_id', $currentUser->organization_id);
                } else {
                    $lcpnapQuery->whereNull('organization_id');
                }
            }

            if (!empty($search)) {
                $lcpnapQuery->where('lcpnap_name', '=', $search);
            }

            $lcpnapLocations = $lcpnapQuery->orderBy('id', 'desc')
                ->get()
                ->map(function($item) use ($sessionStats) {
                    $stats = $sessionStats->get($item->lcpnap_name);

                    return [
                        'id' => $item->id,
                        'lcpnap_name' => $item->lcpnap_name,
                        'lcp_name' => $item->lcp,
                        'nap_name' => $item->nap,
                        'coordinates' => $item->coordinates,
                        'street' => $item->street,
                        'city' => $item->city,
                        'region' => $item->region,
                        'barangay' => $item->barangay,
                        'location' => $item->location,
                        'port_total' => $item->port_total,
                        'reading_image_url' => $item->reading_image_url,
                        'image1_url' => $item->image1_url,
                        'image2_url' => $item->image2_url,
                        'modified_by' => $item->modified_by,
                        'modified_date' => $item->modified_date,
                        'organization_id' => $item->organization_id,
                        'active_sessions' => $stats ? (int) $stats->active_sessions : 0,
                        'restricted_sessions' => $stats ? (int) $stats->restricted_sessions : 0,
                        'offline_sessions' => $stats ? (int) $stats->offline_sessions : 0,
                        'disconnected_sessions' => $stats ? (int) $stats->disconnected_sessions : 0,
                        'not_found_sessions' => $stats ? (int) $stats->not_found_sessions : 0,
                        'total_technical_details' => $stats ? (int) $stats->total_technical_details : 0,
                        'total_sessions' => $stats ? (int) $stats->total_sessions : 0
                    ];
                });

            return response()->json([
                'success' => true,
                'data' => $lcpnapLocations
            ]);
            
        } catch (\Exception $e) {
            Log::error('LCPNAP Locations Error: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching locations: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            Log::info('LCPNAP Store Request', [
                'has_reading_image' => $request->hasFile('reading_image'),
                'has_image' => $request->hasFile('image'),
                'has_image_2' => $request->hasFile('image_2'),
                'all_data' => $request->except(['reading_image', 'image', 'image_2'])
            ]);

            $validator = Validator::make($request->all(), [
                'lcpnap_name' => 'required|string|max:255',
                'street' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'lcp_id' => 'nullable|string|max:255',
                'nap_id' => 'nullable|string|max:255',
                'port_total' => 'required|integer|min:1',
                'coordinates' => 'nullable|string|max:255',
                'reading_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'image_2' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'modified_by' => 'nullable|string|max:255',
                'organization_id' => 'nullable|integer',
                'lcp_name' => 'nullable|string|max:255',
                'nap_name' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                Log::error('LCPNAP Store Validation Failed', $validator->errors()->toArray());
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $currentUser = Auth::user();
            $organizationId = $request->input('organization_id') ?? ($currentUser ? $currentUser->organization_id : null);

            $existingQuery = LCPNAPLocation::where('lcpnap_name', $request->lcpnap_name);
            if ($organizationId) {
                $existingQuery->where('organization_id', $organizationId);
            } else {
                $existingQuery->whereNull('organization_id');
            }
            
            $existing = $existingQuery->first();
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A LCPNAP with this name already exists in your organization'
                ], 422);
            }

            $folderName = "(lcpnap)" . $request->lcpnap_name;
            $folderId = $this->googleDriveService->createFolder($folderName);

            $readingImageUrl = null;
            $image1Url = null;
            $image2Url = null;

            if ($request->hasFile('reading_image')) {
                $readingImageUrl = $this->uploadImageToDrive(
                    $request->file('reading_image'),
                    $folderId,
                    'reading_image_' . time()
                );
            }

            if ($request->hasFile('image')) {
                $image1Url = $this->uploadImageToDrive(
                    $request->file('image'),
                    $folderId,
                    'image1_' . time()
                );
            }

            if ($request->hasFile('image_2')) {
                $image2Url = $this->uploadImageToDrive(
                    $request->file('image_2'),
                    $folderId,
                    'image2_' . time()
                );
            }

            $lcpnap = new LCPNAPLocation();
            $lcpnap->lcpnap_name = $request->lcpnap_name;
            $lcpnap->reading_image_url = $readingImageUrl;
            $lcpnap->street = $request->street;
            $lcpnap->region = $request->region;
            $lcpnap->city = $request->city;
            $lcpnap->barangay = $request->barangay;
            $lcpnap->lcp = $request->lcp_name ?? $request->lcp_id;
            $lcpnap->nap = $request->nap_name ?? $request->nap_id;
            $lcpnap->port_total = $request->port_total;
            $lcpnap->image1_url = $image1Url;
            $lcpnap->image2_url = $image2Url;
            $lcpnap->modified_by = $request->modified_by;
            $lcpnap->modified_date = now();
            $lcpnap->coordinates = $request->coordinates;
            $lcpnap->organization_id = $organizationId;
            $lcpnap->save();

            Log::info('LCPNAP Created Successfully', [
                'id' => $lcpnap->id,
                'name' => $lcpnap->lcpnap_name,
                'organization_id' => $lcpnap->organization_id
            ]);
            
            return response()->json([
                'success' => true,
                'message' => 'LCPNAP location added successfully',
                'data' => $lcpnap
            ], 201);
            
        } catch (\Exception $e) {
            Log::error('LCPNAP Store Error: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString(),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error adding LCPNAP location: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $query = LCPNAPLocation::query();
            
            // Apply organization filter
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }
            
            $lcpnap = $query->find($id);
            
            if (!$lcpnap) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCPNAP location not found'
                ], 404);
            }
            
            return response()->json([
                'success' => true,
                'data' => $lcpnap
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching LCPNAP location: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'lcpnap_name' => 'required|string|max:255',
                'street' => 'nullable|string|max:255',
                'region' => 'nullable|string|max:255',
                'city' => 'nullable|string|max:255',
                'barangay' => 'nullable|string|max:255',
                'lcp_id' => 'nullable|string|max:255',
                'nap_id' => 'nullable|string|max:255',
                'port_total' => 'required|integer|min:1',
                'coordinates' => 'nullable|string|max:255',
                'reading_image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'image_2' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff|max:10240',
                'modified_by' => 'nullable|string|max:255',
                'organization_id' => 'nullable|integer',
                'lcp_name' => 'nullable|string|max:255',
                'nap_name' => 'nullable|string|max:255'
            ]);

            if ($validator->fails()) {
                Log::error('LCPNAP Update Validation Failed', $validator->errors()->toArray());
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $query = LCPNAPLocation::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $lcpnap = $query->find($id);
            if (!$lcpnap) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCPNAP location not found'
                ], 404);
            }

            $organizationId = $request->input('organization_id') ?? $lcpnap->organization_id;

            $duplicateQuery = LCPNAPLocation::where('lcpnap_name', $request->lcpnap_name)
                ->where('id', '!=', $id);
            
            if ($organizationId) {
                $duplicateQuery->where('organization_id', $organizationId);
            } else {
                $duplicateQuery->whereNull('organization_id');
            }
            
            $duplicate = $duplicateQuery->first();
            if ($duplicate) {
                return response()->json([
                    'success' => false,
                    'message' => 'A LCPNAP with this name already exists in your organization'
                ], 422);
            }

            $folderName = "(lcpnap)" . $request->lcpnap_name;
            $folderId = $this->googleDriveService->createFolder($folderName);

            if ($request->hasFile('reading_image')) {
                $lcpnap->reading_image_url = $this->uploadImageToDrive(
                    $request->file('reading_image'),
                    $folderId,
                    'reading_image_' . time()
                );
            }

            if ($request->hasFile('image')) {
                $lcpnap->image1_url = $this->uploadImageToDrive(
                    $request->file('image'),
                    $folderId,
                    'image1_' . time()
                );
            }

            if ($request->hasFile('image_2')) {
                $lcpnap->image2_url = $this->uploadImageToDrive(
                    $request->file('image_2'),
                    $folderId,
                    'image2_' . time()
                );
            }

            $lcpnap->lcpnap_name = $request->lcpnap_name;
            $lcpnap->street = $request->street;
            $lcpnap->region = $request->region;
            $lcpnap->city = $request->city;
            $lcpnap->barangay = $request->barangay;
            $lcpnap->lcp = $request->lcp_name ?? $request->lcp_id;
            $lcpnap->nap = $request->nap_name ?? $request->nap_id;
            $lcpnap->port_total = $request->port_total;
            $lcpnap->modified_by = $request->modified_by;
            $lcpnap->modified_date = now();
            $lcpnap->coordinates = $request->coordinates;
            if ($request->has('organization_id')) {
                $lcpnap->organization_id = $request->organization_id;
            }
            $lcpnap->save();
            
            return response()->json([
                'success' => true,
                'message' => 'LCPNAP location updated successfully',
                'data' => $lcpnap
            ]);
            
        } catch (\Exception $e) {
            Log::error('LCPNAP Update Error: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error updating LCPNAP location: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $query = LCPNAPLocation::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $lcpnap = $query->find($id);
            if (!$lcpnap) {
                return response()->json([
                    'success' => false,
                    'message' => 'LCPNAP location not found'
                ], 404);
            }
            
            $lcpnap->delete();
            
            return response()->json([
                'success' => true,
                'message' => 'LCPNAP location permanently deleted from database'
            ]);
            
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting LCPNAP location: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $query = LCPNAPLocation::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $totalLcpnap = $query->count();
            $totalPorts = $query->sum('port_total');
            $uniqueLocations = $query->distinct('location')->count('location');
            
            return response()->json([
                'success' => true,
                'data' => [
                    'total_lcpnap' => $totalLcpnap,
                    'total_ports' => $totalPorts,
                    'unique_locations' => $uniqueLocations
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }

    private function uploadImageToDrive($file, $folderId, $filePrefix)
    {
        try {
            $extension = $file->getClientOriginalExtension();
            $fileName = $filePrefix . '.' . $extension;
            
            $fileUrl = $this->googleDriveService->uploadFile(
                $file,
                $folderId,
                $fileName,
                $file->getMimeType()
            );
            
            return $fileUrl;
        } catch (\Exception $e) {
            Log::error('Failed to upload image to Google Drive', [
                'error' => $e->getMessage(),
                'file_prefix' => $filePrefix
            ]);
            throw $e;
        }
    }

    public function getMostUsedLCPNAPs()
    {
        try {
            $currentUser = Auth::user();
            
            $mostUsedQuery = \Illuminate\Support\Facades\DB::table('job_orders')
                ->select('lcpnap', \Illuminate\Support\Facades\DB::raw('count(*) as count'))
                ->whereNotNull('lcpnap')
                ->where('lcpnap', '!=', '');
            
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $mostUsedQuery->where('organization_id', $currentUser->organization_id);
                } else {
                    $mostUsedQuery->whereNull('organization_id');
                }
            }

            $mostUsed = $mostUsedQuery->groupBy('lcpnap')
                ->orderBy('count', 'desc')
                ->take(5)
                ->get();

            $names = $mostUsed->pluck('lcpnap')->toArray();
            
            $locationQuery = LCPNAPLocation::whereIn('lcpnap_name', $names);
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $locationQuery->where('organization_id', $currentUser->organization_id);
                } else {
                    $locationQuery->whereNull('organization_id');
                }
            }

            $locations = $locationQuery->get()
                ->sortBy(function($location) use ($names) {
                    return array_search($location->lcpnap_name, $names);
                })
                ->values();

            return response()->json([
                'success' => true,
                'data' => $locations
            ]);
        } catch (\Exception $e) {
            Log::error('Most used LCP/NAP error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch most used LCP/NAP records',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getRelatedCustomers($id)
    {
        try {
            $query = LCPNAPLocation::query();
            $currentUser = Auth::user();
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            $lcpnap = $query->findOrFail($id);
            
            $customerQuery = \DB::table('technical_details as td')
                ->join('billing_accounts as ba', 'td.account_id', '=', 'ba.id')
                ->join('customers as c', 'ba.customer_id', '=', 'c.id')
                ->leftJoin('online_status as os', 'td.account_id', '=', 'os.account_id')
                ->where('td.lcpnap', '=', $lcpnap->lcpnap_name);
            
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $customerQuery->where('td.organization_id', $currentUser->organization_id);
                } else {
                    $customerQuery->whereNull('td.organization_id');
                }
            }

            $customers = $customerQuery->select(
                    'ba.id',
                    'ba.account_no',
                    \DB::raw("TRIM(CONCAT_WS(' ', c.first_name, c.middle_initial, c.last_name)) as full_name"),
                    'td.port',
                    'os.session_status as status'
                )
                ->get();

            return response()->json([
                'success' => true,
                'data' => $customers
            ]);
        } catch (\Exception $e) {
            Log::error('LCPNAP Related Customers Error: ' . $e->getMessage(), [
                'id' => $id,
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error fetching related customers: ' . $e->getMessage()
            ], 500);
        }
    }
}

