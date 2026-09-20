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
    /**
     * lcpnap names compared with spaces and dashes removed.
     *
     * technical_details.lcpnap is free text and has drifted: the same box is
     * written "LP 146 NP 04" on most rows and "LP 146 - NP 04" on others, and
     * matching it literally left the second kind attributed to no box at all —
     * so its port read as free on a NAP that was in fact full.
     *
     * The ".2" that distinguishes a second box on the same LCP/NAP survives this,
     * and no two of the lcpnap names collide once normalised, so it can only ever
     * match rows that were always meant to match.
     */
    private const NORMALISED = "REPLACE(REPLACE(%s, ' ', ''), '-', '')";

    protected $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;
    }

    /** The PHP side of self::NORMALISED, for comparing against a bound value. */
    private function normaliseLcpNapName(?string $name): string
    {
        return str_replace([' ', '-'], '', (string) $name);
    }

    /**
     * The (lcp, nap) pairs that name more than one box, lowercased as "lcp|nap".
     *
     * A technical_details row carrying no lcpnap of its own can still be placed by
     * its lcp and nap columns — but only when that pair names exactly one box.
     * These pairs each have a second ".2" record and nothing on the row says which
     * of the two it sits on, so they are left unattributed rather than counted
     * against both.
     */
    private function ambiguousLcpNapPairs(): array
    {
        return \DB::table('lcpnap')
            ->select('lcp', 'nap')
            ->groupBy('lcp', 'nap')
            ->havingRaw('COUNT(*) > 1')
            ->get()
            ->map(fn ($row) => strtolower(trim((string) $row->lcp) . '|' . trim((string) $row->nap)))
            ->all();
    }

    /**
     * Fold per-(lcpnap, lcp, nap) aggregates onto the boxes they belong to.
     *
     * Keyed by lcpnap id, with total_technical_details being the number of ports
     * occupied — the figure every client renders as "used / total". Ports are a set
     * rather than a sum because two groups can resolve to the same box, and because
     * a port that has been re-let carries one technical_details row per subscriber
     * that has ever sat on it; counting rows made a full 16-port NAP read "25 / 16".
     *
     * A group that resolves to no box is dropped, exactly as it was when the stats
     * were keyed by the raw name.
     */
    private function attributeStatsToLocations($statGroups, $locations): \Illuminate\Support\Collection
    {
        // Ambiguity is read from the whole table, never from $locations: a search
        // or an organization filter can hide the second box of a pair, and a pair
        // that only looks unique would place rows on a box they may not be on.
        $ambiguous = array_flip($this->ambiguousLcpNapPairs());

        $byName = [];
        $byPair = [];

        foreach ($locations as $location) {
            $byName[$this->normaliseLcpNapName($location->lcpnap_name)] = $location->id;

            // Only a pair that names exactly one box can place a row carrying no name.
            $pair = strtolower(trim((string) $location->lcp) . '|' . trim((string) $location->nap));
            if (!isset($ambiguous[$pair])) {
                $byPair[$pair] = $location->id;
            }
        }

        $counters = ['active_sessions', 'restricted_sessions', 'offline_sessions',
                     'disconnected_sessions', 'not_found_sessions', 'total_sessions'];
        $stats = [];

        foreach ($statGroups as $group) {
            $name = trim((string) ($group->lcpnap ?? ''));
            $pair = strtolower(trim((string) $group->lcp) . '|' . trim((string) $group->nap));

            // A name that matches no box is left where it was rather than guessed at
            // from lcp and nap — it could name either half of an ambiguous pair.
            $locationId = $name !== ''
                ? ($byName[$this->normaliseLcpNapName($name)] ?? null)
                : ($byPair[$pair] ?? null);

            if ($locationId === null) {
                continue;
            }

            if (!isset($stats[$locationId])) {
                $stats[$locationId] = array_fill_keys($counters, 0) + ['ports' => []];
            }

            foreach (explode(',', (string) $group->occupied_ports) as $port) {
                if ($port !== '') {
                    $stats[$locationId]['ports'][$port] = true;
                }
            }

            foreach ($counters as $counter) {
                $stats[$locationId][$counter] += (int) $group->{$counter};
            }
        }

        return collect($stats)->map(function ($row) {
            $row['total_technical_details'] = count($row['ports']);
            unset($row['ports']);

            return (object) $row;
        });
    }

    public function index(Request $request)
    {
        try {
            $rawLimit = $request->get('limit');
            $noLimit = $rawLimit === '0' || $rawLimit === 0 || $rawLimit === -1 || $rawLimit === '-1' || $rawLimit === 'all' || $request->boolean('no_limit') || $request->boolean('all');
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

            if ($noLimit) {
                $lcpnapItems = $query->orderBy('lcpnap_name', 'asc')->get();
                return response()->json([
                    'success' => true,
                    'data' => $lcpnapItems,
                    'pagination' => [
                        'current_page' => 1,
                        'total_pages' => 1,
                        'total_items' => $totalItems,
                        'items_per_page' => $totalItems,
                        'has_next' => false,
                        'has_prev' => false
                    ]
                ]);
            }
            
            $page = (int) $request->get('page', 1);
            $limit = min((int) ($rawLimit ?: 1000), 1000);
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
            
            // Step 1: Fetch the NAP boxes to be shown (lightweight query).
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

            $lcpnapLocations = $lcpnapQuery->orderBy('id', 'desc')->get();

            // Step 2: Pre-aggregate per NAP box from technical_details + online_status.
            //
            // Grouped by the three columns that say which box a row is on, and
            // resolved to the box itself afterwards in PHP. Matching in SQL instead
            // would mean joining on REPLACE(...) — no index is usable through that,
            // and it turned a 0.2s page into a 5s one.
            $sessionStatsQuery = \DB::table('technical_details as td')
                ->leftJoin('online_status as os', 'td.account_id', '=', 'os.account_id');

            // Filter session stats by organization
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $sessionStatsQuery->where('td.organization_id', $currentUser->organization_id);
                } else {
                    $sessionStatsQuery->whereNull('td.organization_id');
                }
            }

            $statGroups = $sessionStatsQuery->groupBy('td.lcpnap', 'td.lcp', 'td.nap')
                ->select(
                    'td.lcpnap',
                    'td.lcp',
                    'td.nap',
                    // The ports themselves, not a count: two groups can resolve to the
                    // same box ("LP 146 NP 04" and "LP 146 - NP 04"), and their ports
                    // have to be deduplicated across the pair, not added up. Written
                    // "P01" and occasionally "P 01", so carried as the number it is.
                    \DB::raw("GROUP_CONCAT(DISTINCT CASE WHEN COALESCE(td.port, '') <> '' THEN CAST(REPLACE(REPLACE(UPPER(td.port), ' ', ''), 'P', '') AS UNSIGNED) END) as occupied_ports"),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Online" THEN os.id END) as active_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Restricted" THEN os.id END) as restricted_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Offline" THEN os.id END) as offline_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Disconnected" THEN os.id END) as disconnected_sessions'),
                    \DB::raw('COUNT(DISTINCT CASE WHEN os.session_status = "Not Found" THEN os.id END) as not_found_sessions'),
                    \DB::raw('COUNT(DISTINCT os.id) as total_sessions')
                )
                ->get();

            $sessionStats = $this->attributeStatsToLocations($statGroups, $lcpnapLocations);

            $lcpnapLocations = $lcpnapLocations
                ->map(function($item) use ($sessionStats) {
                    $stats = $sessionStats->get($item->id);

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
                'reading_image' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
                'image' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
                'image_2' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
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
                'reading_image' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
                'image' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
                'image_2' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:10240',
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

            // The panel derives the free ports from this list, so a subscriber the
            // query fails to return reads as an empty port. Matched the same way
            // the usage count is: on the normalised name, falling back to lcp+nap
            // for a row that carries no name — but only when that pair names this
            // box alone, since otherwise the row could belong to either.
            $normalisedName = $this->normaliseLcpNapName($lcpnap->lcpnap_name);
            $pairNamesOneBox = \DB::table('lcpnap')
                ->where('lcp', $lcpnap->lcp)
                ->where('nap', $lcpnap->nap)
                ->count() === 1;

            $customerQuery = \DB::table('technical_details as td')
                ->join('billing_accounts as ba', 'td.account_id', '=', 'ba.id')
                ->join('customers as c', 'ba.customer_id', '=', 'c.id')
                ->leftJoin('online_status as os', 'td.account_id', '=', 'os.account_id')
                // Billing status decides whether this customer still occupies the port:
                // once pulled out, the port is free for someone else.
                ->leftJoin('billing_status as bs', 'ba.billing_status_id', '=', 'bs.id')
                ->where(function ($match) use ($normalisedName, $pairNamesOneBox, $lcpnap) {
                    $tdName = sprintf(self::NORMALISED, 'td.lcpnap');
                    $match->whereRaw("COALESCE(td.lcpnap, '') <> '' AND {$tdName} = ?", [$normalisedName]);

                    if ($pairNamesOneBox) {
                        $match->orWhere(function ($fallback) use ($lcpnap) {
                            $fallback->whereRaw("COALESCE(td.lcpnap, '') = ''")
                                ->where('td.lcp', '=', $lcpnap->lcp)
                                ->where('td.nap', '=', $lcpnap->nap);
                        });
                    }
                });

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
                    'os.session_status as status',
                    'ba.billing_status_id',
                    'bs.status_name as billing_status'
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

