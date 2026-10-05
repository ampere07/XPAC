<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\BillingAccount;
use App\Models\Customer;
use App\Models\JobOrder;
use App\Models\LCPNAPLocation;
use App\Models\OnlineStatus;
use App\Models\Plan;
use App\Models\RadiusConfig;
use App\Models\Role;
use App\Models\TechnicalDetail;
use App\Support\PortalPassword;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * SuperAdmin "direct add": a complete customer without the application -> job order -> approval
 * steps.
 *
 * Creates what job order approval (JobOrderController::approve) creates, from the form instead of
 * an application and a job order: customers, billing_accounts, technical_details, online_status
 * and the customer's portal login (users, role Customer) — plus the RADIUS user the job order's
 * Done step (JobOrderController::createRadiusAccountInternal) would have created. Same rules:
 *
 *   - the account number comes from AccountNumberService, the sequence approval uses;
 *   - PPPoE credentials follow the PPPoE username/password patterns unless typed in;
 *   - the RADIUS user is created in the Restricted group on radius_config #1 (3 tries), then #2,
 *     so the customer goes online only once the payment pipelines reconnect them;
 *   - postpaid starts Active, prepaid starts Inactive and gets its first bill.
 *
 * Unlike approval, nothing messages the customer (no welcome SMS or email, no bill notice), there
 * is no job order or application to link, and no agent commission — that is settled on a job
 * order.
 *
 * All or nothing. The RADIUS user is created first, outside the transaction: the account number
 * locks billing_accounts, and that lock must not be held across network calls to a router. The
 * database rows then go in one transaction, and if it fails the RADIUS user is removed again — or,
 * when RADIUS cannot be reached for that, queued for deletion.
 */
class DirectCustomerService
{
    private const RADIUS_ATTEMPTS_PER_CONFIG = 3;

    /** Source tag for RADIUS queue rows and logs. */
    private const SOURCE = 'customer_direct_add';

    /**
     * @param array<string, mixed> $data validated by DirectCustomerController
     * @return array<string, mixed>
     *
     * @throws ValidationException when a value clashes with an existing account
     * @throws RuntimeException when RADIUS or the database refused, after undoing any part made
     */
    public function create(array $data, $actor): array
    {
        $actorEmail = (string) ($actor->email_address ?? $actor->email ?? 'System');
        $actorId = (int) ($actor->id ?? 1);
        $organizationId = $actor->organization_id ?? null;

        $plan = Plan::findOrFail((int) $data['plan_id']);
        $isPrepaid = BillingAccount::isPrepaidType($data['generation_type']);

        // LCP and NAP come from the LCP-NAP picked, as approval reads them.
        $lcpnapName = trim((string) ($data['lcpnap'] ?? ''));
        $lcpnap = $lcpnapName !== '' ? LCPNAPLocation::where('lcpnap_name', $lcpnapName)->first() : null;
        $lcp = trim((string) ($lcpnap->lcp ?? ''));
        $nap = trim((string) ($lcpnap->nap ?? ''));

        $serial = trim((string) ($data['router_modem_sn'] ?? ''));
        if ($serial !== '' && TechnicalDetail::where('router_modem_sn', $serial)->exists()) {
            throw ValidationException::withMessages([
                'router_modem_sn' => ['Another account already has this router serial number.'],
            ]);
        }

        $configs = app(RadiusServerResolver::class)->orderedConfigs($organizationId);
        if ($configs->isEmpty()) {
            throw new RuntimeException('No RADIUS server is configured. Add one under RADIUS Configuration first.');
        }

        // PPPoE credentials: typed in, or from the patterns with the same inputs approval uses.
        $pppoe = new PppoeUsernameService();
        $credentialInput = [
            'first_name' => $data['first_name'],
            'middle_initial' => $data['middle_initial'] ?? '',
            'last_name' => $data['last_name'],
            'mobile_number' => $data['contact_number_primary'],
            'lcp' => $lcp,
            'nap' => $nap,
            'port' => $data['port'] ?? '',
            'date_installed' => $data['date_installed'],
        ];

        $typedUsername = trim((string) ($data['pppoe_username'] ?? ''));
        if ($typedUsername !== '' && $this->usernameTaken($typedUsername)) {
            throw ValidationException::withMessages([
                'pppoe_username' => ['This PPPoE username is already used by another account.'],
            ]);
        }

        $usernames = $typedUsername !== ''
            ? new \ArrayIterator([$typedUsername])
            : $this->freeUsernames($pppoe->generateUsername($credentialInput));
        $password = trim((string) ($data['pppoe_password'] ?? '')) ?: $pppoe->generatePassword($credentialInput);

        $radius = $this->createRadiusUser($configs, $usernames, $password, $typedUsername !== '');
        $username = $radius['username'];

        try {
            $records = DB::transaction(fn () => $this->createRecords(
                $data, $plan, $isPrepaid, $username, $password, $serial, $lcp, $nap,
                $organizationId, $actorEmail, $actorId
            ));
        } catch (\Throwable $e) {
            Log::error('[DIRECT ADD] Database step failed; undoing the RADIUS user', [
                'username' => $username,
                'error' => $e->getMessage(),
            ]);

            $this->removeRadiusUser($radius['config'], $username, $organizationId, $actorEmail);

            if ($e instanceof ValidationException) {
                throw $e;
            }

            throw new RuntimeException('The customer could not be saved, so nothing was created: ' . $e->getMessage(), 0, $e);
        }

        /** @var BillingAccount $billingAccount */
        $billingAccount = $records['billing_account'];
        $customer = $records['customer'];

        // After the commit and best-effort, as in approval: none of these may undo the customer.
        $initialBilling = null;
        if ($isPrepaid) {
            try {
                $billingAccount->load(['customer', 'technicalDetails']);
                $initialBilling = app(EnhancedBillingGenerationServiceWithNotifications::class)
                    ->generateInitialBillingForAccount($billingAccount, $actorId, false);
            } catch (\Throwable $e) {
                Log::error('[DIRECT ADD] Prepaid initial billing failed (the customer was still created)', [
                    'account_no' => $billingAccount->account_no,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->syncSmartOlt($serial, $username, $customer, $billingAccount->account_no);

        ActivityLog::log(
            'Customer Added Directly',
            "Customer {$billingAccount->account_no} added directly by SuperAdmin (no application or job order)",
            'info',
            [
                'resource_type' => 'BillingAccount',
                'resource_id' => $billingAccount->id,
                'additional_data' => [
                    'account_no' => $billingAccount->account_no,
                    'customer_id' => $customer->id,
                    'pppoe_username' => $username,
                    'radius_config_id' => $radius['config']->id,
                    'generation_type' => $billingAccount->generation_type,
                ],
            ]
        );

        Log::info('[DIRECT ADD] Customer created', [
            'account_no' => $billingAccount->account_no,
            'customer_id' => $customer->id,
            'username' => $username,
            'radius_config_id' => $radius['config']->id,
            'created_by' => $actorEmail,
        ]);

        return [
            'customer_id' => $customer->id,
            'billing_account_id' => $billingAccount->id,
            'account_no' => $billingAccount->account_no,
            'full_name' => trim("{$customer->first_name} {$customer->last_name}"),
            'billing_status' => $isPrepaid ? 'Inactive' : 'Active',
            'pppoe_username' => $username,
            'pppoe_password' => $password,
            'radius_group' => JobOrder::USERNAME_STATUS_RESTRICTED,
            'radius_server' => "#{$radius['position']} ({$radius['config']->ip})",
            'initial_billing_created' => $initialBilling !== null
                && (($initialBilling['invoice_created'] ?? false) || ($initialBilling['statement_created'] ?? false)),
        ];
    }

    /**
     * The database half: customer, billing account, technical details, online status and portal
     * login — the rows approval writes, minus the job order back-link. Run inside the transaction.
     *
     * @return array{customer: Customer, billing_account: BillingAccount}
     */
    private function createRecords(
        array $data,
        Plan $plan,
        bool $isPrepaid,
        string $username,
        string $password,
        string $serial,
        string $lcp,
        string $nap,
        $organizationId,
        string $actorEmail,
        int $actorId
    ): array {
        $customer = Customer::create([
            'first_name' => $data['first_name'],
            'middle_initial' => $data['middle_initial'] ?? null,
            'last_name' => $data['last_name'],
            'email_address' => $data['email_address'],
            'contact_number_primary' => $data['contact_number_primary'],
            'contact_number_secondary' => $data['contact_number_secondary'] ?? null,
            'address' => $data['address'],
            'location' => $data['location'] ?? null,
            'barangay' => $data['barangay'],
            'city' => $data['city'],
            'region' => $data['region'],
            'address_coordinates' => $data['address_coordinates'] ?? null,
            'housing_status' => $data['housing_status'] ?? null,
            'referred_by' => $data['referred_by'] ?? null,
            // The bare plan_list name, as the Customer Details edit writes it; billing prices from it.
            'desired_plan' => $plan->plan_name,
            'organization_id' => $organizationId,
            'created_by' => $actorEmail,
            'updated_by' => $actorEmail,
        ]);

        $accountNo = app(AccountNumberService::class)->next();

        if (BillingAccount::where('account_no', $accountNo)->exists()) {
            throw new RuntimeException("Account number {$accountNo} is already taken.");
        }

        $customer->update(['account_no' => $accountNo]);

        $statusId = $isPrepaid
            ? (int) (DB::table('billing_status')->where('status_name', 'Inactive')->value('id') ?? 4)
            : (int) (DB::table('billing_status')->where('status_name', 'Active')->value('id') ?? 1);

        $vatEnabled = (bool) ($data['vat_enabled'] ?? false);
        $withholdingEnabled = (bool) ($data['withholding_enabled'] ?? false);

        $billingAccount = BillingAccount::create([
            'customer_id' => $customer->id,
            'account_no' => $accountNo,
            'date_installed' => $data['date_installed'],
            'plan_id' => $plan->id,
            'account_balance' => round((float) ($data['installation_fee'] ?? 0), 2),
            'balance_update_date' => now(),
            // Prepaid bills on a rolling period from the first payment, not on a day of the month.
            'billing_day' => $isPrepaid ? null : (int) $data['billing_day'],
            'billing_status_id' => $statusId,
            'generation_type' => $isPrepaid ? BillingAccount::GENERATION_PREPAID : BillingAccount::GENERATION_POSTPAID,
            // vat_type is the legacy text; kept in step with vat_enabled as Customer Details does.
            'vat_type' => $vatEnabled ? 'Excluded Vat' : 'No Vat',
            'vat_enabled' => $vatEnabled,
            'withholding_enabled' => $withholdingEnabled,
            'withholding_percentage' => $withholdingEnabled ? $data['withholding_percentage'] : null,
            'created_by' => $actorEmail,
            'updated_by' => $actorEmail,
        ]);

        if (TechnicalDetail::where('account_no', $accountNo)->exists()) {
            throw new RuntimeException("Technical details already exist for account {$accountNo}.");
        }

        TechnicalDetail::create([
            'account_id' => $billingAccount->id,
            'account_no' => $accountNo,
            'username' => $username,
            'pppoe_password' => $password,
            'username_status' => JobOrder::USERNAME_STATUS_RESTRICTED,
            'connection_type' => $data['connection_type'] ?? null,
            'router_model' => $data['router_model'],
            'router_modem_sn' => $serial !== '' ? $serial : null,
            'ip_address' => $data['ip_address'] ?? null,
            'lcp' => $lcp !== '' ? $lcp : null,
            'nap' => $nap !== '' ? $nap : null,
            'port' => $data['port'] ?? null,
            'vlan' => $data['vlan'] ?? null,
            'lcpnap' => $data['lcpnap'] ?? null,
            'usage_type' => $data['usage_type'] ?? null,
            'organization_id' => $organizationId,
            'created_by' => $actorEmail,
            'updated_by' => $actorEmail,
        ]);

        // Checked again inside the transaction: another account may have taken the username since
        // the check before RADIUS.
        if (OnlineStatus::where('username', $username)->exists()) {
            throw ValidationException::withMessages([
                'pppoe_username' => ['This PPPoE username is already used by another account.'],
            ]);
        }

        OnlineStatus::create([
            'account_id' => $billingAccount->id,
            'account_no' => $accountNo,
            'username' => $username,
            // RadiusStatusSyncService fills this in from the live session on its next pass.
            'session_status' => '',
        ]);

        // The customer portal login: account number + primary contact number, as approval
        // creates it, hashed through PortalPassword so any spelling of the number signs in.
        if (!DB::table('users')->where('username', $accountNo)->exists()) {
            DB::table('users')->insert([
                'username' => $accountNo,
                'email_address' => $customer->email_address,
                'first_name' => $customer->first_name,
                'middle_initial' => $customer->middle_initial,
                'last_name' => $customer->last_name,
                'contact_number' => $customer->contact_number_primary,
                'role_id' => Role::CUSTOMER,
                'status' => 'active',
                'active' => 1,
                'organization_id' => $organizationId,
                'created_by_user_id' => $actorId,
                'updated_by_user_id' => $actorId,
                // Inserted directly so the User model's hashing mutator does not hash it twice.
                'password_hash' => PortalPassword::hash($customer->contact_number_primary),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } else {
            Log::warning('[DIRECT ADD] A user with this account number already exists; portal login not created', [
                'account_no' => $accountNo,
            ]);
        }

        return ['customer' => $customer, 'billing_account' => $billingAccount];
    }

    /**
     * Create the RADIUS user in the Restricted group: radius_config #1 up to 3 times, then #2,
     * as job order provisioning does.
     *
     * addUser() reports success for a name the device already has, without touching it, so each
     * name is looked up on the device first. A taken name is an error when it was typed in; a
     * generated one moves on to the next free candidate.
     *
     * @param Collection<int, RadiusConfig> $configs
     * @return array{config: RadiusConfig, position: int, username: string}
     */
    private function createRadiusUser(Collection $configs, \Iterator $usernames, string $password, bool $typed): array
    {
        $usernames->rewind();

        if (!$usernames->valid()) {
            throw ValidationException::withMessages([
                'pppoe_username' => ['No free PPPoE username could be generated. Type one in.'],
            ]);
        }

        $username = (string) $usernames->current();
        $error = 'No RADIUS server answered.';
        $positions = $configs->count() >= 2 ? [1, 2] : [1];

        foreach ($positions as $position) {
            $config = $configs->get($position - 1);

            for ($attempt = 1; $attempt <= self::RADIUS_ATTEMPTS_PER_CONFIG; $attempt++) {
                $api = app(RouterosApiService::class);

                try {
                    if (!$api->connect($config)) {
                        $error = $api->getLastError() !== '' ? $api->getLastError() : 'No RADIUS endpoint responded.';

                        // Every transport is in cool-off: retrying only repeats the refusal.
                        if ($api->lastConnectAllEndpointsDown()) {
                            break;
                        }

                        continue;
                    }

                    while ($api->findUser($config, $username) !== null) {
                        if ($typed) {
                            throw ValidationException::withMessages([
                                'pppoe_username' => ["'{$username}' already exists on RADIUS server #{$position}."],
                            ]);
                        }

                        $usernames->next();

                        if (!$usernames->valid()) {
                            throw ValidationException::withMessages([
                                'pppoe_username' => ['No free PPPoE username could be generated. Type one in.'],
                            ]);
                        }

                        $username = (string) $usernames->current();
                    }

                    // findUser() also answers null when it could not read the device.
                    if ($api->getLastError() !== '') {
                        $error = 'Could not check the username on RADIUS: ' . $api->getLastError();
                        continue;
                    }

                    if ($api->addUser($config, $username, $password, JobOrder::USERNAME_STATUS_RESTRICTED)) {
                        Log::channel('radiusrelated')->info('[DIRECT ADD] RADIUS user created (Restricted)', [
                            'username' => $username,
                            'position' => $position,
                            'radius_config_id' => $config->id,
                        ]);

                        return ['config' => $config, 'position' => $position, 'username' => $username];
                    }

                    // The device answered and refused this account; re-sending it gets the same
                    // answer, so move on to the next server.
                    $error = $api->getLastError() !== '' ? $api->getLastError() : 'The RADIUS server refused the account.';
                    break;
                } catch (ValidationException $e) {
                    throw $e;
                } catch (\Throwable $e) {
                    $error = $e->getMessage();
                }
            }
        }

        Log::channel('radiusrelated')->error('[DIRECT ADD] RADIUS user could not be created; nothing was saved', [
            'username' => $username,
            'error' => $error,
        ]);

        throw new RuntimeException("The RADIUS account could not be created, so the customer was not added: {$error}");
    }

    /**
     * Undo createRadiusUser() after the database step failed. When the device cannot be reached
     * for that, the deletion is queued, as CustomerPurgeService does.
     */
    private function removeRadiusUser(RadiusConfig $config, string $username, $organizationId, string $actorEmail): void
    {
        $error = null;

        try {
            $api = app(RouterosApiService::class);

            if ($api->removeUser($config, $username)) {
                Log::channel('radiusrelated')->info('[DIRECT ADD] RADIUS user removed after the database step failed', [
                    'username' => $username,
                    'radius_config_id' => $config->id,
                ]);

                return;
            }

            $error = $api->getLastError() !== '' ? $api->getLastError() : 'removeUser returned failure';
        } catch (\Throwable $e) {
            $error = $e->getMessage();
        }

        $queuedId = RadiusQueueService::queue([
            'organization_id' => $organizationId,
            'source_type' => self::SOURCE,
            'source_id' => 0,
            'account_no' => null,
            'operation' => 'delete_user',
            'params' => ['username' => $username, 'organization_id' => $organizationId],
            'last_error' => $error,
            'created_by' => $actorEmail,
        ]);

        Log::channel('radiusrelated')->error('[DIRECT ADD] RADIUS user could not be removed after the database step failed', [
            'username' => $username,
            'radius_config_id' => $config->id,
            'error' => $error,
            'queued_for_deletion' => (bool) $queuedId,
        ]);
    }

    /**
     * Free usernames from a generated base: the base, then base1, base2, ... — the suffixing
     * PppoeUsernameService::generateUniqueUsername() uses, checked against every table that holds
     * a PPPoE username rather than only job_orders.
     */
    private function freeUsernames(string $base): \Generator
    {
        if ($base === '') {
            return;
        }

        for ($i = 0; $i <= 999; $i++) {
            $candidate = $i === 0 ? $base : $base . $i;

            if (!$this->usernameTaken($candidate)) {
                yield $candidate;
            }
        }
    }

    private function usernameTaken(string $username): bool
    {
        return DB::table('technical_details')->where('username', $username)->exists()
            || DB::table('online_status')->where('username', $username)->exists()
            || DB::table('job_orders')->where('pppoe_username', $username)->exists();
    }

    /**
     * Label the ONU with the PPPoE username, as approval does. Best-effort: SmartOLT is a
     * downstream label and must never fail the add.
     */
    private function syncSmartOlt(string $serial, string $username, Customer $customer, string $accountNo): void
    {
        if ($serial === '') {
            return;
        }

        try {
            $address = implode(', ', array_filter([
                trim((string) ($customer->address ?? '')),
                trim((string) ($customer->barangay ?? '')),
                trim((string) ($customer->city ?? '')),
            ], static fn (string $part): bool => $part !== ''));

            $outcome = app(SmartOltService::class)->setOnuNameBySn(
                $serial,
                $username,
                $address !== '' ? $address : null,
                $customer->contact_number_primary ?? null
            );

            Log::channel('smartoltrelated')->info('[SMARTOLT DIRECT ADD] ' . $outcome, [
                'account_no' => $accountNo,
                'sn' => $serial,
                'name' => $username,
            ]);
        } catch (\Throwable $e) {
            Log::channel('smartoltrelated')->error('[SMARTOLT DIRECT ADD] Sync failed', [
                'account_no' => $accountNo,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
