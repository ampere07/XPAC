<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Models\SmartOlt;

class SmartOltService
{
    /**
     * Seconds to wait for SmartOLT to accept a connection.
     *
     * Every caller here runs inside a technician's request — a Service Order save,
     * a pullout, a job order completion. Guzzle applies no timeout of its own, so
     * without these an unreachable SmartOLT holds the socket until PHP's own limit
     * and the technician watches a spinner for the duration. Best-effort means the
     * call is allowed to fail; it does not mean it is allowed to hang.
     */
    private const HTTP_CONNECT_TIMEOUT = 5;

    /** Seconds to wait for a complete response once connected. */
    private const HTTP_TIMEOUT = 10;

    /**
     * Clear (delete) the ONU name in SmartOLT for a given Serial Number.
     *
     * Mirrors SmartOltController::deleteOnuNameBySn — resolves the SN to the
     * ONU's unique external ID, then posts an empty name to update_location_details.
     *
     * Best-effort: never throws. Returns a status string:
     *   'success'      - name cleared in SmartOLT
     *   'skipped'      - no SN provided or SmartOLT not configured
     *   'not_found'    - SN not found in SmartOLT
     *   'api_error'    - SmartOLT returned an error
     *   'http_error'   - non-2xx HTTP response
     *   'exception'    - connection/other exception
     */
    public function clearOnuNameBySn(?string $sn): string
    {
        $tag = '[SMARTOLT CLEAR NAME]';

        if (empty($sn)) {
            Log::channel('smartoltrelated')->info($tag . ' Skipped — no SN provided');
            return 'skipped';
        }

        try {
            $config = SmartOlt::first();

            if (!$config) {
                Log::channel('smartoltrelated')->warning($tag . ' Skipped — SmartOLT not configured');
                return 'skipped';
            }

            $subDomain = $config->sub_domain;
            $token = $config->token;

            // Step 1: Retrieve ONU details using Serial Number
            $resolved = $this->resolveOnuExternalId($sn, $subDomain, $token, $tag);

            if ($resolved['status'] !== null) {
                return $resolved['status'];
            }

            $onuExternalId = $resolved['external_id'];

            // Step 2: Call update_location_details to set the name to empty
            $updateUrl = "https://{$subDomain}.smartolt.com/api/onu/update_location_details/{$onuExternalId}";
            Log::channel('smartoltrelated')->info($tag . " Clearing name: $updateUrl for external ID: $onuExternalId");

            $updateResponse = Http::withHeaders(['X-Token' => $token])
                ->connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                ->timeout(self::HTTP_TIMEOUT)
                ->asForm()
                ->post($updateUrl, ['name' => '']);

            if (!$updateResponse->successful()) {
                Log::channel('smartoltrelated')->error($tag . ' Clear name HTTP error: ' . $updateResponse->status(), [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                ]);
                return 'http_error';
            }

            $updateData = $updateResponse->json();

            if (isset($updateData['status']) && $updateData['status'] === false) {
                $errorMsg = $updateData['error'] ?? 'Failed to clear name';
                Log::channel('smartoltrelated')->warning($tag . ' Clear name API error: ' . $errorMsg, [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                ]);
                return 'api_error';
            }

            Log::channel('smartoltrelated')->info($tag . ' Success', [
                'sn' => $sn,
                'onu_external_id' => $onuExternalId,
            ]);

            return 'success';
        } catch (\Exception $e) {
            Log::channel('smartoltrelated')->error($tag . ' Exception: ' . $e->getMessage(), ['sn' => $sn]);
            return 'exception';
        }
    }

    /**
     * Assign an ONU's location details in SmartOLT for a given Serial Number.
     *
     * The inverse of clearOnuNameBySn and the same two-step shape: resolve the SN
     * to the ONU's unique external ID, then post the location block to
     * update_location_details. Mirrors SmartOltController::updateOnuNameBySn so a
     * router swapped from a Service Order lands in SmartOLT identically to one
     * named at installation — the parameter names mirror the fields shown in the
     * SmartOLT UI ("Name", "Address or comment", "Contact").
     *
     * `$name` is the account's PPPoE username, which is what SmartOLT's ONU name
     * carries throughout this system — not the person's name. That is the same
     * value clearOnuNameBySn blanks, so the two stay symmetrical.
     *
     * Only non-empty address/contact values are sent: posting a blank would
     * overwrite whatever an installer had already typed into SmartOLT with nothing.
     *
     * Idempotent by nature — re-posting identical location details is a no-op at
     * SmartOLT, so replaying a Service Order save costs one API round trip and
     * changes nothing.
     *
     * Best-effort: never throws. Returns the same status vocabulary as
     * clearOnuNameBySn, plus 'skipped' when no name is available to assign.
     */
    public function setOnuNameBySn(
        ?string $sn,
        ?string $name,
        ?string $addressOrComment = null,
        ?string $contact = null
    ): string {
        $tag = '[SMARTOLT SET NAME]';

        if (empty($sn)) {
            Log::channel('smartoltrelated')->info($tag . ' Skipped — no SN provided');
            return 'skipped';
        }

        $name = trim((string) $name);
        $addressOrComment = trim((string) $addressOrComment);
        $contact = trim((string) $contact);

        // Without a name there is nothing to assign, and posting an empty one here
        // would silently do the job of clearOnuNameBySn on a live ONU.
        if ($name === '') {
            Log::channel('smartoltrelated')->warning($tag . ' Skipped — no name to assign', ['sn' => $sn]);
            return 'skipped';
        }

        try {
            $config = SmartOlt::first();

            if (!$config) {
                Log::channel('smartoltrelated')->warning($tag . ' Skipped — SmartOLT not configured');
                return 'skipped';
            }

            $subDomain = $config->sub_domain;
            $token = $config->token;

            // Step 1: Retrieve ONU details using Serial Number
            $resolved = $this->resolveOnuExternalId($sn, $subDomain, $token, $tag);

            if ($resolved['status'] !== null) {
                return $resolved['status'];
            }

            $onuExternalId = $resolved['external_id'];

            // Step 2: Call update_location_details to assign the name
            $updateUrl = "https://{$subDomain}.smartolt.com/api/onu/update_location_details/{$onuExternalId}";

            $updatePayload = ['name' => $name];
            if ($addressOrComment !== '') {
                $updatePayload['address_or_comment'] = $addressOrComment;
            }
            if ($contact !== '') {
                $updatePayload['contact'] = $contact;
            }

            // Logged so a rejected/ignored parameter name is diagnosable from this channel alone.
            Log::channel('smartoltrelated')->info($tag . " Assigning name: $updateUrl for external ID: $onuExternalId", [
                'sn' => $sn,
                'fields' => array_keys($updatePayload),
            ]);

            $updateResponse = Http::withHeaders(['X-Token' => $token])
                ->connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                ->timeout(self::HTTP_TIMEOUT)
                ->asForm()
                ->post($updateUrl, $updatePayload);

            if (!$updateResponse->successful()) {
                Log::channel('smartoltrelated')->error($tag . ' Assign name HTTP error: ' . $updateResponse->status(), [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                ]);
                return 'http_error';
            }

            $updateData = $updateResponse->json();

            if (isset($updateData['status']) && $updateData['status'] === false) {
                $errorMsg = $updateData['error'] ?? 'Failed to assign name';
                Log::channel('smartoltrelated')->warning($tag . ' Assign name API error: ' . $errorMsg, [
                    'sn' => $sn,
                    'onu_external_id' => $onuExternalId,
                ]);
                return 'api_error';
            }

            Log::channel('smartoltrelated')->info($tag . ' Success', [
                'sn' => $sn,
                'onu_external_id' => $onuExternalId,
                'name' => $name,
                'address_or_comment' => $addressOrComment ?: null,
                'contact' => $contact ?: null,
            ]);

            return 'success';
        } catch (\Exception $e) {
            Log::channel('smartoltrelated')->error($tag . ' Exception: ' . $e->getMessage(), ['sn' => $sn]);
            return 'exception';
        }
    }

    /**
     * Hand an account's ONU over from one router to another after a replacement.
     *
     * Two halves, in order:
     *   1. Unbind the router that came out, so the old SN stops carrying a live
     *      subscriber's name in SmartOLT. Skipped when the SN did not actually
     *      change — a Service Order re-saved with the same router must not clear
     *      the ONU it is currently bound to.
     *   2. Name the router that went in, using the account's own PPPoE username,
     *      address and contact.
     *
     * Call this AFTER the database transaction has committed: both halves are
     * outbound HTTP, and SmartOLT should only ever be told about a swap that
     * actually persisted.
     *
     * Best-effort throughout — never throws, so a SmartOLT outage cannot fail a
     * Service Order the technician already saved. Every outcome is logged to the
     * smartoltrelated channel; the returned statuses are for callers that want to
     * surface the result.
     *
     * Idempotent: replaying the same save skips the unbind (SNs now match) and
     * re-posts identical location details, which is a no-op at SmartOLT.
     *
     * @return array{cleared: ?string, assigned: ?string} per-half status, null when that half did not run
     */
    public function syncOnuForRouterReplacement(
        string $accountNo,
        ?string $oldSn,
        ?string $newSn,
        string $tag = '[SMARTOLT SO REPLACE ROUTER]'
    ): array {
        $oldSn = trim((string) $oldSn);
        $newSn = trim((string) $newSn);

        $result = ['cleared' => null, 'assigned' => null];

        // Nothing was swapped — no ONU to hand over.
        if ($oldSn === '' && $newSn === '') {
            return $result;
        }

        if ($oldSn !== '' && $oldSn !== $newSn) {
            try {
                $result['cleared'] = $this->clearOnuNameBySn($oldSn);

                Log::channel('smartoltrelated')->info($tag . ' Unbound old ONU: ' . $result['cleared'], [
                    'account_no' => $accountNo,
                    'old_router_modem_sn' => $oldSn,
                    'new_router_modem_sn' => $newSn ?: null,
                ]);
            } catch (\Exception $e) {
                // clearOnuNameBySn already swallows its own failures; this guards
                // against anything unexpected so the assign half still runs.
                $result['cleared'] = 'exception';
                Log::channel('smartoltrelated')->error($tag . ' Unbind old ONU failed: ' . $e->getMessage(), [
                    'account_no' => $accountNo,
                    'old_router_modem_sn' => $oldSn,
                ]);
            }
        }

        if ($newSn === '') {
            return $result;
        }

        try {
            // One query for the three values SmartOLT needs, rather than one per
            // field. technical_details joins on account_id to match how the rest of
            // this system resolves an account's technical row.
            $subscriber = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'technical_details.username as pppoe_username',
                    'customers.address',
                    'customers.barangay',
                    'customers.city',
                    'customers.region',
                    'customers.contact_number_primary'
                )
                ->first();

            if (!$subscriber) {
                Log::channel('smartoltrelated')->warning($tag . ' Skipped assign — account not found', [
                    'account_no' => $accountNo,
                    'new_router_modem_sn' => $newSn,
                ]);
                $result['assigned'] = 'skipped';
                return $result;
            }

            // SmartOLT's "Address or comment" is one free-text field, so the address
            // is composed into a single readable line. Empty parts are dropped rather
            // than leaving stray commas.
            $addressOrComment = implode(', ', array_filter([
                trim((string) ($subscriber->address ?? '')),
                trim((string) ($subscriber->barangay ?? '')),
                trim((string) ($subscriber->city ?? '')),
                trim((string) ($subscriber->region ?? '')),
            ], fn($part) => $part !== ''));

            $result['assigned'] = $this->setOnuNameBySn(
                $newSn,
                $subscriber->pppoe_username ?? null,
                $addressOrComment,
                $subscriber->contact_number_primary ?? null
            );

            Log::channel('smartoltrelated')->info($tag . ' Assigned new ONU: ' . $result['assigned'], [
                'account_no' => $accountNo,
                'new_router_modem_sn' => $newSn,
                'pppoe_username' => $subscriber->pppoe_username ?? null,
            ]);
        } catch (\Exception $e) {
            $result['assigned'] = 'exception';
            Log::channel('smartoltrelated')->error($tag . ' Assign new ONU failed: ' . $e->getMessage(), [
                'account_no' => $accountNo,
                'new_router_modem_sn' => $newSn,
            ]);
        }

        return $result;
    }

    /**
     * Resolve a Serial Number to the ONU's unique external ID.
     *
     * Shared by the clear and assign paths so the two cannot drift on how a SN is
     * looked up or how a lookup failure is classified.
     *
     * Returns ['external_id' => string, 'status' => null] on success, or
     * ['external_id' => null, 'status' => '<failure status>'] — the caller returns
     * that status verbatim, keeping each path's public contract unchanged.
     *
     * @return array{external_id: ?string, status: ?string}
     */
    private function resolveOnuExternalId(string $sn, string $subDomain, string $token, string $tag): array
    {
        $getOnuUrl = "https://{$subDomain}.smartolt.com/api/onu/get_onus_details_by_sn/{$sn}";
        Log::channel('smartoltrelated')->info($tag . " Getting ONU details: $getOnuUrl");

        $getOnuResponse = Http::withHeaders(['X-Token' => $token])
            ->connectTimeout(self::HTTP_CONNECT_TIMEOUT)
            ->timeout(self::HTTP_TIMEOUT)
            ->get($getOnuUrl);

        if (!$getOnuResponse->successful()) {
            Log::channel('smartoltrelated')->error($tag . ' Failed to fetch ONU details: ' . $getOnuResponse->status());
            return ['external_id' => null, 'status' => 'http_error'];
        }

        $getOnuData = $getOnuResponse->json();

        if (isset($getOnuData['status']) && $getOnuData['status'] === false) {
            $errorMsg = $getOnuData['error'] ?? 'Unknown error';
            Log::channel('smartoltrelated')->warning($tag . ' Get ONU details API error: ' . $errorMsg, ['sn' => $sn]);
            return ['external_id' => null, 'status' => 'api_error'];
        }

        if (!isset($getOnuData['onus']) || !is_array($getOnuData['onus']) || empty($getOnuData['onus'])) {
            Log::channel('smartoltrelated')->warning($tag . ' SN not found in SmartOLT', ['sn' => $sn]);
            return ['external_id' => null, 'status' => 'not_found'];
        }

        $onuDetails = $getOnuData['onus'][0];
        $onuExternalId = $onuDetails['unique_external_id'] ?? $onuDetails['onu_external_id'] ?? $onuDetails['id'] ?? null;

        if (!$onuExternalId) {
            Log::channel('smartoltrelated')->error($tag . ' Could not determine external ID', ['sn' => $sn]);
            return ['external_id' => null, 'status' => 'api_error'];
        }

        return ['external_id' => (string) $onuExternalId, 'status' => null];
    }
}
