<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Somewhere for the client to report a failure this server cannot see.
 *
 * The customer dashboard's balance is fetched from the browser. When that
 * request fails, the failure happens on the customer's device: nothing reaches
 * this server, so nothing is logged, and the only evidence is a console line on
 * a phone belonging to somebody who will never open a console. The endpoint
 * itself answers correctly for anyone who tries it, so the fault cannot be
 * reproduced from this end either.
 *
 * This is the missing half. The client posts what it saw — which account, which
 * request, the HTTP status, which attempt — and it lands in
 * storage/logs/customer-dashboard.log where it can be read.
 *
 * DELIBERATELY NARROW. It is unauthenticated, because the dashboard's own
 * endpoints are, and anything unauthenticated that writes to disk is worth
 * keeping dull:
 *
 *   • only the event names below are accepted, so it cannot be used as a
 *     general-purpose writer;
 *   • every field is length-capped before it is written;
 *   • the context is flattened to scalars, so no nested payload can be posted
 *     through it;
 *   • it is rate limited by the route, and always answers 204 so a caller
 *     learns nothing from it either way.
 */
class ClientLogController extends Controller
{
    /**
     * The only events worth a line in that file.
     *
     * A list rather than free text: an open endpoint that logs whatever it is
     * given is a way to fill a disk, and these are the failures actually being
     * chased.
     */
    private const ALLOWED_EVENTS = [
        'pay-summary-failed',
        'pay-summary-empty',
        'pay-summary-recovered',
        'customer-detail-failed',
        'balance-unavailable',
    ];

    public function store(Request $request): JsonResponse
    {
        try {
            $event = (string) $request->input('event', '');

            if (!in_array($event, self::ALLOWED_EVENTS, true)) {
                // Not an error worth reporting back: a caller sending something
                // else is either mistaken or probing, and neither needs an answer.
                return response()->json(null, 204);
            }

            $context = $request->input('context');
            $context = is_array($context) ? $context : [];

            $clean = [];
            foreach ($context as $key => $value) {
                if (count($clean) >= 12) {
                    break;
                }

                // Scalars only, each capped. An object or array is recorded as
                // its type rather than walked, so nothing unbounded is written.
                $clean[substr((string) $key, 0, 40)] = is_scalar($value) || $value === null
                    ? substr((string) $value, 0, 200)
                    : '[' . gettype($value) . ']';
            }

            Log::channel('client')->warning('[CLIENT] ' . $event, $clean + [
                // Added here rather than trusted from the payload: these are
                // facts about the request, and the client has no business
                // asserting them.
                'ip'         => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 200),
            ]);
        } catch (Throwable $e) {
            // A reporting endpoint that throws is worse than one that stays
            // quiet: the caller is already handling a failure and must not be
            // handed a second one.
            Log::channel('single')->error('[CLIENT LOG] Could not record a client event: ' . $e->getMessage());
        }

        return response()->json(null, 204);
    }
}
