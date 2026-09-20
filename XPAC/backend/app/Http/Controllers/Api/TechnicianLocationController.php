<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TechnicianLocation;
use App\Events\TechnicianLocationUpdated;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class TechnicianLocationController extends Controller
{
    // A location older than this (seconds) is considered "stale".
    const STALE_SECONDS = 120; // 2 minutes

    const TECHNICIAN_ROLE_ID = 2;
    const ADMIN_ROLE_IDS = [1, 7, 8]; // Administrator, SuperAdmin, HeadTech

    // Breadcrumb trail tuning: record a history point when the tech has moved at least
    // this far, or at least this often (heartbeat), so trails are detailed while moving
    // and cheap while parked.
    const HISTORY_MIN_MOVE_METERS = 8;
    const HISTORY_HEARTBEAT_SECONDS = 60;
    const HISTORY_RETENTION_HOURS = 24; // pruned by cron:mark-stale-locations

    /**
     * Receive a GPS update from the authenticated technician and upsert their single
     * live-location row. The technician identity is ALWAYS taken from the auth session,
     * never from the request body, so a technician can only update their own location.
     */
    public function update(Request $request)
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized'
            ], 401);
        }

        if ((int) $user->role_id !== self::TECHNICIAN_ROLE_ID) {
            return response()->json([
                'success' => false,
                'message' => 'Only technicians can report a location'
            ], 403);
        }

        $validator = Validator::make($request->all(), [
            'latitude'  => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'accuracy'  => 'nullable|numeric|min:0',
            'speed'     => 'nullable|numeric',
            'heading'   => 'nullable|numeric',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors'  => $validator->errors()
            ], 422);
        }

        try {
            $location = TechnicianLocation::updateOrCreate(
                ['user_id' => $user->id],
                [
                    'organization_id' => $user->organization_id,
                    'latitude'        => $request->input('latitude'),
                    'longitude'       => $request->input('longitude'),
                    'accuracy'        => $request->input('accuracy'),
                    'speed'           => $request->input('speed'),
                    'heading'         => $request->input('heading'),
                    'status'          => 'online',
                    'last_updated_at' => Carbon::now(),
                ]
            );

            // Append to the breadcrumb trail when the tech has moved enough, or on a
            // periodic heartbeat — keeps trails detailed while moving, sparse while parked.
            $this->maybeRecordHistory($user, (float) $request->input('latitude'), (float) $request->input('longitude'), $request);

            $payload = $this->payload($location, $user);

            // Push the new position to any admin dashboards watching the map.
            try {
                event(new TechnicianLocationUpdated($payload));
            } catch (\Throwable $e) {
                // Broadcasting must never break the technician's update loop.
                \Log::warning('TechnicianLocation broadcast failed: ' . $e->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Location updated',
                'data'    => $payload,
            ]);
        } catch (\Exception $e) {
            \Log::error('TechnicianLocation update error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update location',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Admin-only: list every technician's live location for the monitoring map.
     */
    public function index(Request $request)
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        if (!in_array((int) $user->role_id, self::ADMIN_ROLE_IDS, true)) {
            return response()->json(['success' => false, 'message' => 'Forbidden'], 403);
        }

        try {
            $data = $this->fetchLocations($user, $request);
            return response()->json([
                'success' => true,
                'data'    => $data,
            ]);
        } catch (\Exception $e) {
            \Log::error('TechnicianLocation index error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch technician locations',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Admin-only: recent breadcrumb trail for one technician (for drawing a path).
     * GET /technician-locations/{userId}/trail?minutes=120
     */
    public function trail(Request $request, $userId)
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }
        if (!in_array((int) $user->role_id, self::ADMIN_ROLE_IDS, true)) {
            return response()->json(['success' => false, 'message' => 'Forbidden'], 403);
        }

        try {
            // scope=today -> from local (Manila) midnight, so the trail resets each day.
            // Otherwise fall back to a rolling window of `minutes`.
            if ($request->get('scope') === 'today') {
                $storageTz = config('app.timezone', 'UTC');
                $since = Carbon::now('Asia/Manila')->startOfDay()->setTimezone($storageTz);
            } else {
                $minutes = min(max((int) $request->get('minutes', 120), 1), 24 * 60);
                $since = Carbon::now()->subMinutes($minutes);
            }

            $query = DB::table('technician_location_history')
                ->where('user_id', $userId)
                ->where('recorded_at', '>=', $since);

            // Org-scope: non-global admins can only see their own organization's techs.
            if ($user->organization_id !== null) {
                $query->where('organization_id', $user->organization_id);
            }

            $points = $query->orderBy('recorded_at')
                ->select('latitude', 'longitude', 'recorded_at')
                ->get()
                ->map(function ($p) {
                    return [
                        'latitude'    => (float) $p->latitude,
                        'longitude'   => (float) $p->longitude,
                        'recorded_at' => $p->recorded_at,
                    ];
                });

            return response()->json(['success' => true, 'data' => $points]);
        } catch (\Exception $e) {
            \Log::error('TechnicianLocation trail error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch trail',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Append a breadcrumb point when the technician has moved far enough since the last
     * recorded point, or when the heartbeat interval has elapsed (keeps parked techs cheap).
     */
    private function maybeRecordHistory($user, float $lat, float $lng, Request $request): void
    {
        try {
            $last = DB::table('technician_location_history')
                ->where('user_id', $user->id)
                ->orderByDesc('recorded_at')
                ->first();

            $shouldRecord = true;
            if ($last) {
                $moved = self::haversine((float) $last->latitude, (float) $last->longitude, $lat, $lng);
                $ageSeconds = Carbon::parse($last->recorded_at)->diffInSeconds(Carbon::now());
                $shouldRecord = ($moved >= self::HISTORY_MIN_MOVE_METERS)
                    || ($ageSeconds >= self::HISTORY_HEARTBEAT_SECONDS);
            }

            if (!$shouldRecord) {
                return;
            }

            DB::table('technician_location_history')->insert([
                'user_id'         => $user->id,
                'organization_id' => $user->organization_id,
                'latitude'        => $lat,
                'longitude'       => $lng,
                'accuracy'        => $request->input('accuracy'),
                'speed'           => $request->input('speed'),
                'heading'         => $request->input('heading'),
                'recorded_at'     => Carbon::now(),
                'created_at'      => Carbon::now(),
            ]);
        } catch (\Throwable $e) {
            // History is best-effort; never fail the live update because of it.
            \Log::warning('TechnicianLocation history insert failed: ' . $e->getMessage());
        }
    }

    /** Great-circle distance in meters. */
    private static function haversine(float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $R = 6371000;
        $dLat = deg2rad($bLat - $aLat);
        $dLng = deg2rad($bLng - $aLng);
        $lat1 = deg2rad($aLat);
        $lat2 = deg2rad($bLat);
        $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
        return 2 * $R * asin(min(1, sqrt($h)));
    }

    /**
     * Shared query used by both the REST index and the /monitor/handle widget action.
     * SuperAdmins with a null organization see all technicians; everyone else is org-scoped.
     */
    public static function fetchLocations($authUser, Request $request = null)
    {
        $organizationId = $authUser->organization_id;

        // Allow a global SuperAdmin to optionally filter to one org (mirrors MonitorController).
        if ($organizationId === null && $request && $request->has('organization_id')) {
            $reqOrgId = $request->input('organization_id');
            if ($reqOrgId !== '' && $reqOrgId !== 'null' && $reqOrgId !== 'All') {
                $organizationId = $reqOrgId;
            }
        }

        $query = DB::table('technician_locations as tl')
            ->join('users', 'users.id', '=', 'tl.user_id')
            ->where('users.role_id', self::TECHNICIAN_ROLE_ID);

        if ($organizationId !== null) {
            $query->where('tl.organization_id', $organizationId);
        }

        $rows = $query->select(
            'tl.user_id',
            'tl.latitude',
            'tl.longitude',
            'tl.accuracy',
            'tl.speed',
            'tl.heading',
            'tl.status as stored_status',
            'tl.last_updated_at',
            'users.username',
            'users.email_address',
            'users.first_name',
            'users.last_name',
            'users.role_id'
        )->get();

        $now = Carbon::now();

        return $rows->map(function ($row) use ($now) {
            return self::shapeRow($row, $now);
        })->values();
    }

    /**
     * Build the payload for a freshly-saved model (technician update path).
     */
    private function payload(TechnicianLocation $location, $user)
    {
        $now = Carbon::now();
        $row = (object) [
            'user_id'         => $location->user_id,
            'latitude'        => $location->latitude,
            'longitude'       => $location->longitude,
            'accuracy'        => $location->accuracy,
            'speed'           => $location->speed,
            'heading'         => $location->heading,
            'stored_status'   => $location->status,
            'last_updated_at' => $location->last_updated_at,
            'username'        => $user->username,
            'email_address'   => $user->email_address,
            'first_name'      => $user->first_name,
            'last_name'       => $user->last_name,
            'role_id'         => $user->role_id,
        ];

        return self::shapeRow($row, $now);
    }

    /**
     * Normalize a DB row into the shape the mobile app and admin map consume,
     * computing a live "online | stale | offline" status from last_updated_at.
     */
    private static function shapeRow($row, Carbon $now)
    {
        $lastUpdated = $row->last_updated_at ? Carbon::parse($row->last_updated_at) : null;
        $ageSeconds = $lastUpdated ? $lastUpdated->diffInSeconds($now) : null;

        if (($row->stored_status ?? null) === 'offline') {
            $status = 'offline';
        } elseif ($ageSeconds !== null && $ageSeconds <= self::STALE_SECONDS) {
            $status = 'online';
        } else {
            $status = 'stale';
        }

        $fullName = trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? ''));
        if ($fullName === '') {
            $fullName = $row->username ?? ('Technician #' . $row->user_id);
        }

        return [
            'user_id'         => (int) $row->user_id,
            'full_name'       => $fullName,
            'username'        => $row->username,
            'email_address'   => $row->email_address,
            // The users table has no employee_id / avatar columns; surface what exists.
            'employee_id'     => $row->username,
            'profile_picture' => null,
            'role_id'         => (int) $row->role_id,
            'latitude'        => $row->latitude !== null ? (float) $row->latitude : null,
            'longitude'       => $row->longitude !== null ? (float) $row->longitude : null,
            'accuracy'        => $row->accuracy !== null ? (float) $row->accuracy : null,
            'speed'           => $row->speed !== null ? (float) $row->speed : null,
            'heading'         => $row->heading !== null ? (float) $row->heading : null,
            'status'          => $status,
            'last_updated_at' => $lastUpdated ? $lastUpdated->toDateTimeString() : null,
            'age_seconds'     => $ageSeconds,
        ];
    }
}
