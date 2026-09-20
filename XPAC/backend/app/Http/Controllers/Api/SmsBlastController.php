<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SmsQueueService;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\SmsBlastLog;
use App\Models\SmsConfig;
use App\Models\ActivityLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class SmsBlastController extends Controller
{
    public function index(Request $request)
    {
        try {
            $currentUser = Auth::user();
            $query = DB::table('sms_blast_logs')
                ->leftJoin('barangay', 'sms_blast_logs.barangay_id', '=', 'barangay.id')
                ->leftJoin('city', 'barangay.city_id', '=', 'city.id')
                ->leftJoin('lcpnap', 'sms_blast_logs.lcpnap_id', '=', 'lcpnap.id')
                ->leftJoin('lcp', 'sms_blast_logs.lcp_id', '=', 'lcp.id')
                ->leftJoin('users as creator', 'sms_blast_logs.created_by_user_id', '=', 'creator.id')
                ->leftJoin('users as updater', 'sms_blast_logs.updated_by_user_id', '=', 'updater.id')
                ->select(
                    'sms_blast_logs.*',
                    'barangay.barangay as barangay_name',
                    'city.city as city_name',
                    'lcpnap.lcpnap_name',
                    'lcp.lcp_name',
                    'creator.email_address as user_email',
                    'updater.email_address as modified_email'
                );

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('sms_blast_logs.organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('sms_blast_logs.organization_id');
                }
            }

            $query->orderBy('sms_blast_logs.created_at', 'desc');

            if ($request->has('barangay') && $request->barangay !== 'All') {
                $query->where('barangay.barangay', $request->barangay);
            }

            if ($request->has('city') && $request->city !== 'All') {
                $query->where('city.city', $request->city);
            }

            $records = $query->get();

            // Format data for frontend
            $data = $records->map(function ($record) {
                // Logic based target selection
                $target = '';
                $type = '';
                
                if (isset($record->barangay_id) && $record->barangay_id > 0) {
                    $target = $record->barangay_name ?? 'Barangay ' . $record->barangay_id;
                    $type = 'Barangay';
                } elseif (isset($record->lcpnap_id) && $record->lcpnap_id > 0) {
                    $target = $record->lcpnap_name ?? 'NAP ' . $record->lcpnap_id;
                    $type = 'LCPNAP';
                } elseif (isset($record->lcp_id) && $record->lcp_id > 0) {
                    $target = $record->lcp_name ?? 'LCP ' . $record->lcp_id;
                    $type = 'LCP';
                } elseif (isset($record->billing_day) && $record->billing_day > 0) {
                    $target = 'Day ' . $record->billing_day;
                    $type = 'Billing Day';
                }

                if (empty($target)) $target = 'N/A';
                if (empty($type)) $type = 'N/A';

                return [
                    'id' => (string)$record->id,
                    'target_name' => $target,
                    'target_type' => $type,
                    'barangay' => $record->barangay_name ?? 'N/A',
                    'city' => $record->city_name ?? 'N/A',
                    'message' => $record->message,
                    'billing_day' => $record->billing_day,
                    'message_count' => $record->message_count,
                    'credit_used' => $record->credit_used,
                    'modifiedDate' => $record->updated_at ? \Carbon\Carbon::parse($record->updated_at)->format('n/j/Y g:i:s A') : ($record->created_at ? \Carbon\Carbon::parse($record->created_at)->format('n/j/Y g:i:s A') : 'N/A'),
                    'modifiedEmail' => $record->modified_email ?? $record->user_email ?? 'N/A',
                    'userEmail' => $record->user_email ?? 'N/A',
                    'organization_id' => $record->organization_id
                ];
            });

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * Queue an SMS blast and answer immediately.
     *
     * This used to call iTexMo once per recipient, in the request, before answering. A blast to a
     * populated LCPNAP is hundreds of subscribers and each call is an HTTP round trip of a second
     * or more, so the request outlived the gateway timeout in front of it; what the operator saw
     * was a CORS error, because a 504 generated by the proxy carries none of the CORS headers the
     * application would have set. The messages were usually going out anyway, which made the
     * failure look like a delivery problem rather than a duration one — and re-clicking Send
     * texted everyone a second time.
     *
     * Nothing here talks to the provider. Recipients are resolved, the blast and one sms_queue row
     * per recipient are written in a single transaction, and the response goes back. The cron
     * worker (cron:process-email-queue, every minute) sends them, claiming each row before it calls
     * out so two overlapping ticks cannot both send the same one.
     *
     * Idempotency has two layers, because they guard different mistakes:
     *   - `idempotency_key`, one per compose session, stops a resubmitted request raising a SECOND
     *     blast — the queue's own key could not, because a second blast has a second id and every
     *     row under it hashes differently;
     *   - `sms_queue.dedupe_key`, over (blast, account, contact), makes writing the batch for a
     *     given blast repeatable, so a retry that got as far as the insert adds nothing.
     */
    public function store(Request $request, SmsQueueService $smsQueueService)
    {
        try {
            $currentUser = Auth::user();
            $validated = $request->validate([
                'message' => 'required|string',
                'barangay_id' => 'nullable|integer',
                'lcpnap_id' => 'nullable|integer',
                'lcp_id' => 'nullable|integer',
                'billing_day' => 'nullable|integer',
                'send_all' => 'nullable|boolean',
                // Client-generated, one per compose session. Optional: a client that sends none
                // behaves exactly as before, so an older build keeps working.
                'idempotency_key' => 'nullable|string|max:100',
            ]);

            $organizationId = $currentUser->organization_id ?? null;

            // Hashed rather than stored raw: it normalises whatever the client sent to the 64
            // characters the column holds, and scoping by organisation keeps one tenant's key from
            // ever matching another's.
            $idempotencyKey = !empty($validated['idempotency_key'])
                ? hash('sha256', ($organizationId ?? 'global') . "\0" . $validated['idempotency_key'])
                : null;

            if ($idempotencyKey !== null) {
                $existing = SmsBlastLog::where('idempotency_key', $idempotencyKey)->first();

                if ($existing) {
                    // The same compose session, submitted twice. The first submit already queued
                    // every recipient, so this one must add nothing and must not read as an error.
                    Log::info('SMS blast already queued for this request, not queueing again', [
                        'blast_id' => $existing->id,
                        'organization_id' => $organizationId,
                    ]);

                    return $this->queuedResponse($existing, (int) $existing->message_count, true);
                }
            }

            // Reads only, and none of it needs to be inside the transaction — keeping it out is
            // what stops a large send_all holding write locks while it counts subscribers.
            $recipients = $this->resolveRecipients($validated, $currentUser);
            $recipientCount = $recipients->count();

            $smsLog = null;
            $queuedCount = 0;

            try {
                DB::transaction(function () use (
                    $validated, $currentUser, $organizationId, $idempotencyKey,
                    $recipients, $recipientCount, $smsQueueService, &$smsLog, &$queuedCount
                ) {
                    $smsLog = new SmsBlastLog();
                    $smsLog->fill($validated);
                    $smsLog->idempotency_key = $idempotencyKey;
                    $smsLog->timestamp = now();
                    $smsLog->message_count = $recipientCount;
                    $smsLog->credit_used = $recipientCount;
                    $smsLog->created_by_user_id = $currentUser->id ?? 1;
                    $smsLog->updated_by_user_id = $currentUser->id ?? 1;
                    $smsLog->organization_id = $organizationId;
                    $smsLog->save();

                    $queuedCount = $smsQueueService->queueBlast(
                        (int) $smsLog->id,
                        $recipients,
                        $validated['message']
                    );

                    // What was actually queued, not what the recipient query returned: an account
                    // carrying two technical_details rows appears twice there and is deduplicated
                    // on the way into the queue, and it must not be billed twice for one text.
                    if ($queuedCount !== $recipientCount) {
                        $smsLog->message_count = $queuedCount;
                        $smsLog->credit_used = $queuedCount;
                        $smsLog->save();
                    }

                    ActivityLog::log(
                        'SMS Blast Queued',
                        "SMS Blast queued for {$queuedCount} recipient(s). Message: " . substr($validated['message'], 0, 100) . (strlen($validated['message']) > 100 ? '...' : ''),
                        'info',
                        [
                            'resource_type' => 'SmsBlast',
                            'resource_id' => $smsLog->id,
                            'additional_data' => [
                                'message_count' => $queuedCount,
                                'target_type' => !empty($validated['send_all']) ? 'All Customers' : (!empty($validated['barangay_id']) ? 'Barangay' : (!empty($validated['lcp_id']) ? 'LCP' : (!empty($validated['lcpnap_id']) ? 'LCPNAP' : (!empty($validated['billing_day']) ? 'Billing Day' : 'Unknown')))),
                                'target_id' => $validated['barangay_id'] ?? $validated['lcp_id'] ?? $validated['lcpnap_id'] ?? $validated['billing_day'] ?? null,
                                'organization_id' => $organizationId
                            ]
                        ]
                    );
                });
            } catch (QueryException $e) {
                // Lost the race to a request carrying the same key — two clicks close enough
                // together that neither saw the other's row. The winner has queued the batch, so
                // this is success, not failure.
                if ($idempotencyKey !== null && $this->isDuplicateKeyViolation($e)) {
                    $existing = SmsBlastLog::where('idempotency_key', $idempotencyKey)->first();

                    if ($existing) {
                        Log::info('SMS blast queued concurrently by another request, reusing it', [
                            'blast_id' => $existing->id,
                        ]);

                        return $this->queuedResponse($existing, (int) $existing->message_count, true);
                    }
                }

                throw $e;
            }

            Log::info('SMS blast accepted', [
                'blast_id' => $smsLog->id,
                'organization_id' => $organizationId,
                'recipients' => $recipientCount,
                'queued' => $queuedCount,
                'user_id' => $currentUser->id ?? null,
            ]);

            return $this->queuedResponse($smsLog, $queuedCount, false);
        } catch (\Throwable $e) {
            // \Throwable so a TypeError in the recipient resolution is reported as a failed blast
            // rather than escaping as an unhandled 500 with no context in the log.
            Log::error('Failed to queue SMS blast', [
                'organization_id' => Auth::user()->organization_id ?? null,
                'user_id' => Auth::id(),
                'target' => $request->only(['barangay_id', 'lcpnap_id', 'lcp_id', 'billing_day', 'send_all']),
                'error' => $e->getMessage(),
                'exception' => get_class($e),
                'trace' => $e->getTraceAsString(),
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to process SMS blast: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * The one shape every accepted blast answers with, whether it queued the batch or found it
     * already queued. `sent` is deliberately absent: nothing has been sent yet when this returns,
     * and reporting a zero there is what made the old client warn "Saved (Not Sent)".
     */
    private function queuedResponse(SmsBlastLog $smsLog, int $queuedCount, bool $alreadyQueued)
    {
        $message = $queuedCount === 0
            ? 'SMS Blast saved, but no recipients matched the selected target (check that customers are Active/VIP and have a contact number).'
            : "SMS Blast queued successfully for {$queuedCount} recipient(s). Processing in background.";

        return response()->json([
            'status' => 'success',
            'message' => $message,
            'data' => [
                'blast_id' => $smsLog->id,
                'queued_count' => $queuedCount,
            ],
            'blast' => $smsLog,
            'summary' => [
                'recipients' => $queuedCount,
                'queued' => $queuedCount,
                'already_queued' => $alreadyQueued,
            ],
        ], 201);
    }

    /**
     * Who this blast goes to, for whichever target the request selected.
     *
     * Lifted out of store() unchanged. It is five variants of the same query and it was what made
     * the method hard to read once the queueing and idempotency work went in around it.
     *
     * @return \Illuminate\Support\Collection rows carrying contact_no, customer_id, account_no
     */
    private function resolveRecipients(array $validated, $currentUser)
    {
        $recipients = collect();

        if (!empty($validated['send_all'])) {
            // Send to every Active or VIP customer (org-scoped) that has a contact number.
            $allQuery = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->whereIn('billing_accounts.billing_status_id', [1, 7]) // Active + VIP
                ->whereNotNull('customers.contact_number_primary');

            if ($currentUser && $currentUser->organization_id) {
                $allQuery->where('billing_accounts.organization_id', $currentUser->organization_id);
            }

            $recipients = $allQuery->select('customers.contact_number_primary as contact_no', 'customers.id as customer_id', 'billing_accounts.account_no as account_no')
                ->get();
        } elseif (!empty($validated['barangay_id'])) {
            // Get the barangay name from barangay table
            $barangay = DB::table('barangay')->where('id', $validated['barangay_id'])->first();
            if ($barangay) {
                $customerQuery = DB::table('customers')
                    ->join('billing_accounts', 'customers.id', '=', 'billing_accounts.customer_id')
                    ->where('customers.barangay', $barangay->barangay)
                    ->whereIn('billing_accounts.billing_status_id', [1, 7])
                    ->whereNotNull('customers.contact_number_primary');

                if ($currentUser && $currentUser->organization_id) {
                    $customerQuery->where('customers.organization_id', $currentUser->organization_id);
                }

                $recipients = $customerQuery->select('customers.contact_number_primary as contact_no', 'customers.id as customer_id', 'billing_accounts.account_no as account_no')
                    ->get();
            }
        } elseif (!empty($validated['lcp_id'])) {
            $lcp = DB::table('lcp')->where('id', $validated['lcp_id'])->first();
            if ($lcp) {
                $techQuery = DB::table('technical_details')
                    ->join('billing_accounts', 'technical_details.account_no', '=', 'billing_accounts.account_no')
                    ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->where('technical_details.lcp', $lcp->lcp_name)
                    ->whereIn('billing_accounts.billing_status_id', [1, 7])
                    ->whereNotNull('customers.contact_number_primary');

                if ($currentUser && $currentUser->organization_id) {
                    $techQuery->where('technical_details.organization_id', $currentUser->organization_id);
                }

                $recipients = $techQuery->select('customers.contact_number_primary as contact_no', 'customers.id as customer_id', 'billing_accounts.account_no as account_no')
                    ->get();
            }
        } elseif (!empty($validated['lcpnap_id'])) {
            $lcpnap = DB::table('lcpnap')->where('id', $validated['lcpnap_id'])->first();
            if ($lcpnap) {
                $napQuery = DB::table('technical_details')
                    ->join('billing_accounts', 'technical_details.account_no', '=', 'billing_accounts.account_no')
                    ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    ->where('technical_details.lcpnap', $lcpnap->lcpnap_name)
                    ->whereIn('billing_accounts.billing_status_id', [1, 7])
                    ->whereNotNull('customers.contact_number_primary');

                if ($currentUser && $currentUser->organization_id) {
                    $napQuery->where('technical_details.organization_id', $currentUser->organization_id);
                }

                $recipients = $napQuery->select('customers.contact_number_primary as contact_no', 'customers.id as customer_id', 'billing_accounts.account_no as account_no')
                    ->get();
            }
        } elseif (!empty($validated['billing_day'])) {
            $billingQuery = DB::table('billing_accounts')
                ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.billing_day', $validated['billing_day'])
                ->whereIn('billing_accounts.billing_status_id', [1, 7]) // Active + VIP
                ->whereNotNull('customers.contact_number_primary');

            if ($currentUser && $currentUser->organization_id) {
                $billingQuery->where('billing_accounts.organization_id', $currentUser->organization_id);
            }

            $recipients = $billingQuery->select('customers.contact_number_primary as contact_no', 'customers.id as customer_id', 'billing_accounts.account_no as account_no')
                ->get();
        }

        return $recipients;
    }

    /**
     * A UNIQUE constraint violation, as opposed to any other query failure.
     *
     * Matched on SQLSTATE 23000 plus the driver code so a connection error or a missing column is
     * never mistaken for "already queued".
     */
    private function isDuplicateKeyViolation(QueryException $e): bool
    {
        return ($e->errorInfo[0] ?? null) === '23000'
            && in_array((int) ($e->errorInfo[1] ?? 0), [1062, 1586], true);
    }
}
