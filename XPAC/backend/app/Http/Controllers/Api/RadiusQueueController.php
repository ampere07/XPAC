<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Reads the RADIUS operation queue.
 *
 * Every RADIUS call the system cannot complete at the moment it is needed —
 * a disconnect, a reconnect, a credential change — is parked in
 * radius_operation_queue and retried. This exposes that queue read-only, so an
 * operator can see what is waiting, what has been retried how many times, and
 * what the server said when it last refused.
 *
 * Shaped like DataLogsController: one index, filters applied in SQL, a hard row
 * limit, and dates pre-formatted for Manila so the page renders them as-is.
 */
class RadiusQueueController extends Controller
{
    /** The statuses the table actually carries, for the page's filter. */
    private const STATUSES = ['pending', 'success', 'failed', 'cancelled'];

    public function index(Request $request)
    {
        try {
            $query = DB::table('radius_operation_queue as q')
                // created_by holds a user id on some rows, so the email is
                // resolved where one matches and the raw value kept otherwise.
                ->leftJoin('users as u', 'u.id', '=', 'q.created_by')
                ->select([
                    'q.id',
                    'q.organization_id',
                    'q.source_type',
                    'q.source_id',
                    'q.account_no',
                    'q.operation',
                    'q.params',
                    'q.status',
                    'q.attempts',
                    'q.max_attempts',
                    'q.last_error',
                    'q.next_retry_at',
                    'q.created_by',
                    'q.completed_at',
                    'q.created_at',
                    'q.updated_at',
                    'u.email_address as created_by_email',
                ]);

            if ($status = trim((string) $request->input('status', ''))) {
                if (in_array(strtolower($status), self::STATUSES, true)) {
                    $query->whereRaw('LOWER(q.status) = ?', [strtolower($status)]);
                }
            }

            if ($operation = trim((string) $request->input('operation', ''))) {
                $query->whereRaw('LOWER(q.operation) = ?', [strtolower($operation)]);
            }

            if ($search = trim((string) $request->input('search', ''))) {
                $query->where(function ($q) use ($search) {
                    $q->where('q.account_no', 'like', "%{$search}%")
                      ->orWhere('q.operation', 'like', "%{$search}%")
                      ->orWhere('q.source_type', 'like', "%{$search}%")
                      ->orWhere('q.status', 'like', "%{$search}%")
                      ->orWhere('q.last_error', 'like', "%{$search}%")
                      ->orWhere('q.params', 'like', "%{$search}%")
                      ->orWhere('q.id', '=', $search);
                });
            }

            // Newest first: what is waiting or has just failed is what an
            // operator opens this page to see.
            $query->orderByDesc('q.updated_at')->orderByDesc('q.id');

            $limit = max(1, min((int) $request->input('limit', 250), 2000));

            $rows = $query->limit($limit)->get();

            $fmt = fn ($value) => $value
                ? Carbon::parse($value)->setTimezone('Asia/Manila')->format('m/d/Y h:i A')
                : '';

            return response()->json([
                'status' => 'success',
                'data'   => $rows->map(fn ($r) => [
                    'id'              => (string) $r->id,
                    'organization_id' => $r->organization_id,
                    'account_no'      => $r->account_no ?? '',
                    'operation'       => $r->operation,
                    'status'          => $r->status,
                    'source_type'     => $r->source_type,
                    'source_id'       => (string) $r->source_id,
                    // "3 / 5" reads at a glance; the page also sorts on it.
                    'attempts'        => (int) $r->attempts,
                    'max_attempts'    => (int) $r->max_attempts,
                    'params'          => $r->params,
                    'last_error'      => $r->last_error,
                    'next_retry_at'   => $fmt($r->next_retry_at),
                    'completed_at'    => $fmt($r->completed_at),
                    'created_at'      => $fmt($r->created_at),
                    'updated_at'      => $fmt($r->updated_at),
                    // Prefer the resolved email; fall back to whatever the row holds.
                    'created_by'      => trim((string) ($r->created_by_email ?: $r->created_by)) ?: 'System/N/A',
                ])->all(),
            ]);
        } catch (Throwable $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }
}
