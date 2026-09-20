<?php

namespace App\Services;

use App\Models\RadiusConfig;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Central place for deciding WHICH radius_config a RADIUS operation should hit.
 *
 * Two strategies live here so the rest of the app never re-implements them:
 *
 *  1. Default selection (resolveForCity) — returns the first available config for the
 *     organization. Barangay-based routing has been removed; account creation now uses
 *     radius_config #1 with failover to #2 (see JobOrderController).
 *  2. Failover lookup (findConfigForAccount) — used for operations on an EXISTING
 *     account: search radius_config #1, then #2, ... and operate only where the
 *     account is actually found.
 *
 * "radius_config #1 / #2" means the records ordered by id (see orderedConfigs()).
 */
class RadiusServerResolver
{
    /**
     * How many of the configured RADIUS servers this deployment expects to be live.
     *
     * `all` - every radius_config record is a production server and every one of them
     * is queried; a server that does not answer is a real fault.
     * `primary` - radius_config #1 carries the estate and the records after it are
     * failover targets. They are still searched by findConfigForAccount() and still
     * merged into a session sweep when they answer, but one of them being unreachable
     * is the normal steady state and must not be reported as an outage.
     *
     * DEFAULT_TOPOLOGY is this deployment's shape. `config('radius.topology')`
     * overrides it where a client's estate changes without a code change.
     */
    public const TOPOLOGY_ALL = 'all';
    public const TOPOLOGY_PRIMARY = 'primary';
    public const DEFAULT_TOPOLOGY = self::TOPOLOGY_PRIMARY;

    private string $logName = 'Radius_Resolver';

    /**
     * All radius_config records that apply to the given organization, ordered by id.
     *
     * Prefers organization-specific configs and falls back to the shared (null-org)
     * ones when none exist — mirroring the selection pattern used elsewhere in the app.
     * The returned collection is zero-indexed; position #1 is index 0, #2 is index 1, etc.
     */
    public function orderedConfigs(?int $organizationId = null): Collection
    {
        if ($organizationId !== null) {
            $configs = RadiusConfig::where('organization_id', $organizationId)->orderBy('id')->get();
            if ($configs->isNotEmpty()) {
                return $configs->values();
            }
        }

        return RadiusConfig::whereNull('organization_id')->orderBy('id')->get()->values();
    }

    /**
     * The configs this deployment expects to answer.
     *
     * Not the same question as "which configs exist": a failover server is configured
     * on purpose and is legitimately dark most of the time. Callers that need to
     * decide whether a sweep succeeded judge themselves against this list, while
     * callers that gather data still read every config - a standby that does answer
     * is merged in, it just cannot fail the run by being absent.
     *
     * @return Collection<int, RadiusConfig>
     */
    public function activeConfigs(?int $organizationId = null): Collection
    {
        $configs = $this->orderedConfigs($organizationId);

        if ($configs->isEmpty() || $this->topology() === self::TOPOLOGY_ALL) {
            return $configs;
        }

        return $configs->take(1)->values();
    }

    /**
     * Is this config one the deployment expects to answer, or a standby?
     */
    public function isActiveConfig(RadiusConfig $config, ?int $organizationId = null): bool
    {
        return $this->activeConfigs($organizationId)
            ->contains(fn (RadiusConfig $candidate): bool => (int) $candidate->id === (int) $config->id);
    }

    /**
     * Anything other than an explicit `all` is read as `primary`, so a typo in
     * configuration degrades to the safer reading rather than to "everything is live".
     */
    private function topology(): string
    {
        $value = strtolower(trim((string) config('radius.topology', self::DEFAULT_TOPOLOGY)));

        return $value === self::TOPOLOGY_ALL ? self::TOPOLOGY_ALL : self::TOPOLOGY_PRIMARY;
    }

    /**
     * Get the radius_config at a 1-based position (#1, #2, ...).
     */
    public function configByPosition(int $position, ?int $organizationId = null): ?RadiusConfig
    {
        $configs = $this->orderedConfigs($organizationId);
        return $configs->get($position - 1);
    }

    /**
     * Pick a radius_config without any city-specific routing.
     *
     * The former hardcoded city => server map has been removed. This simply returns
     * the first available config for the organization and exists for callers that
     * still pass a city.
     */
    public function resolveForCity(?string $city, ?int $organizationId = null): ?RadiusConfig
    {
        $configs = $this->orderedConfigs($organizationId);

        if ($configs->isEmpty()) {
            $this->log('error', 'No radius_config records available for selection', ['city' => $city]);
            return null;
        }

        $config = $configs->first();

        $this->log('info', 'Selected default RADIUS server (no city mapping)', [
            'city'             => $city,
            'radius_config_id' => $config->id ?? null,
            'radius_ip'        => $config->ip ?? null,
        ]);

        return $config;
    }

    /**
     * Locate an existing account across the configured RADIUS servers (#1, then #2, ...).
     *
     * Returns details of the FIRST server where the account exists, or null if it is
     * not found on any of them. A connection/API error on one server is logged and
     * skipped so the remaining servers are still checked. Only a lookup (GET) is
     * performed here — no mutating call — so this never duplicates the actual operation.
     *
     * @return array{config: RadiusConfig, position: int, base_url: string, radius_id: string, group: string}|null
     */
    public function findConfigForAccount(string $username, ?int $organizationId = null): ?array
    {
        $configs = $this->orderedConfigs($organizationId);

        if ($configs->isEmpty()) {
            $this->log('error', 'No radius_config records available for account lookup', ['username' => $username]);
            return null;
        }

        foreach ($configs as $index => $config) {
            $position = $index + 1;
            $found = $this->lookupOnConfig($config, $username, $position);

            if ($found !== null) {
                $this->log('info', 'Account located on RADIUS server', [
                    'username'         => $username,
                    'position'         => $position,
                    'radius_config_id' => $config->id,
                    'radius_ip'        => $config->ip,
                ]);

                return [
                    'config'    => $config,
                    'position'  => $position,
                    'base_url'  => $found['base_url'],
                    'radius_id' => $found['radius_id'],
                    'group'     => $found['group'],
                ];
            }
        }

        $this->log('warning', 'Account not found on any RADIUS server', ['username' => $username]);
        return null;
    }

    /**
     * Attempt to find the user on a single config over the native RouterOS API.
     *
     * Tolerant of connection failures: an unreachable device is logged and reported as
     * "not here" so the caller still checks the remaining servers. `base_url` now carries
     * the API endpoint that answered (e.g. `tcp://10.0.0.1:8728`) rather than a REST URL.
     *
     * @return array{base_url: string, radius_id: string, group: string}|null
     */
    private function lookupOnConfig(RadiusConfig $config, string $username, int $position): ?array
    {
        $this->log('info', 'Searching for account on RADIUS server', [
            'username'         => $username,
            'position'         => $position,
            'radius_config_id' => $config->id,
            'radius_ip'        => $config->ip,
        ]);

        try {
            $api = app(RouterosApiService::class);

            $user = $api->findUser($config, $username);

            if ($user === null) {
                $error = $api->getLastError();

                if ($error !== '') {
                    $this->log('error', 'Connection error during account lookup', [
                        'username'         => $username,
                        'radius_config_id' => $config->id,
                        'radius_ip'        => $config->ip,
                        'error'            => $error,
                    ]);
                }

                return null;
            }

            return [
                'base_url'  => $api->getUserManagerPrefix() . '@' . $config->ip,
                'radius_id' => $user['.id'],
                'group'     => $user['group'],
            ];
        } catch (Throwable $e) {
            $this->log('error', 'Connection error during account lookup', [
                'username'         => $username,
                'radius_config_id' => $config->id,
                'radius_ip'        => $config->ip,
                'error'            => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Build the base URL(s) to try for a config: configured protocol first, then the alternate.
     *
     * @deprecated RADIUS traffic now uses the native RouterOS API socket
     *             (see RouterosApiService), not these REST URLs. Retained because the shape
     *             is part of this service's public contract.
     */
    public function baseUrlsFor(RadiusConfig $config): array
    {
        $protocol = strtolower($config->ssl_type ?: 'https');
        $primary = "{$protocol}://{$config->ip}:{$config->port}";
        $alternate = $protocol === 'https'
            ? "http://{$config->ip}:{$config->port}"
            : "https://{$config->ip}:{$config->port}";

        return [$primary, $alternate];
    }

    private function log(string $level, string $message, array $context = []): void
    {
        Log::channel('radiusrelated')->{$level}("[{$this->logName}] {$message}", $context);
    }
}
