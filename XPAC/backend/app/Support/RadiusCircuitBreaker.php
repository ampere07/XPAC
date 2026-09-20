<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Keeps the app from spending connection attempts on a RADIUS endpoint that is
 * not answering.
 *
 * The problem it solves is not one slow request — it is the multiplier. A queue
 * run works through 20 items; each item tries every configured server over both
 * protocols; each of those attempts waits out a connect timeout before failing.
 * Nothing remembers that the previous 19 items just proved the server is down,
 * so every item pays the full cost again. The sockets that result are what keep
 * a struggling RouterOS too busy to accept the connections that would work.
 *
 * So the knowledge is shared. A handful of connection failures against one
 * endpoint marks it down, and every caller then skips it outright — no socket,
 * no timeout — until the cool-off expires. Recovery needs no signal: the cache
 * entry simply expires and the next call goes through, which is the half-open
 * probe. If the server is still down that call fails and the endpoint is marked
 * down again.
 *
 * What counts as a failure is deliberately narrow. Only connection-level errors
 * do — a refused or timed-out socket, a TLS handshake that fails, a rejected
 * login. A device that answers the API at all, even to refuse the command, has
 * proved the endpoint is alive and clears the count. This tracks reachability,
 * not whether the request did what was wanted.
 *
 * Keys are per endpoint (transport + host + port), so tcp://host:8728 and
 * ssl://host:8729 on the same box are judged separately, as are two
 * radius_config rows that happen to share a host. A wrong ssl_type in
 * radius_config therefore costs a few failures once, rather than a wasted
 * connect timeout on every call for as long as it stays wrong.
 *
 * Callers that need a different threshold for one endpoint pass it to
 * recordFailure(); everything else uses radius.circuit_breaker.failure_threshold.
 */
class RadiusCircuitBreaker
{
    private const PREFIX = 'radius:breaker:';

    /**
     * Drop the endpoints currently marked down.
     *
     * Returns them in the order given, so a caller's protocol preference is
     * preserved. An empty result means every endpoint is in cool-off and the
     * caller should give up now rather than connect: that is the entire point.
     *
     * @param  string[]  $baseUrls
     * @return string[]
     */
    public static function usable(array $baseUrls): array
    {
        if (!self::enabled()) {
            return $baseUrls;
        }

        return array_values(array_filter($baseUrls, static fn (string $url) => !self::isOpen($url)));
    }

    /** Is this endpoint currently marked down? */
    public static function isOpen(string $url): bool
    {
        if (!self::enabled()) {
            return false;
        }

        return Cache::get(self::openKey($url)) !== null;
    }

    /**
     * Record that a connection to this endpoint could not be made.
     *
     * Call this only for connection-level failures. An HTTP error response is
     * not one — the endpoint answered.
     */
    public static function recordFailure(string $url, ?int $threshold = null): int
    {
        if (!self::enabled()) {
            return 0;
        }

        $base      = self::baseUrl($url);
        $threshold = ($threshold !== null && $threshold > 0) ? $threshold : self::threshold();
        $failures  = ((int) Cache::get(self::failureKey($base), 0)) + 1;

        if ($failures < $threshold) {
            Cache::put(self::failureKey($base), $failures, self::window());

            Log::channel('radiusrelated')->info('[RADIUS BREAKER] Endpoint failed; still preferred', [
                'endpoint'  => $base,
                'failures'  => $failures . '/' . $threshold,
            ]);

            return $failures;
        }

        $cooldown = self::cooldown();

        Cache::put(self::openKey($base), true, $cooldown);
        Cache::forget(self::failureKey($base));

        Log::channel('radiusrelated')->warning('[RADIUS BREAKER] Endpoint marked down; calls will use the alternate transport', [
            'endpoint'         => $base,
            'failures'         => $failures . '/' . $threshold,
            'cooldown_seconds' => $cooldown,
        ]);

        return $failures;
    }

    /**
     * Record that this endpoint answered. Any HTTP status counts: the point is
     * that a connection was accepted.
     */
    public static function recordSuccess(string $url): void
    {
        if (!self::enabled()) {
            return;
        }

        $base = self::baseUrl($url);

        if (Cache::get(self::openKey($base)) !== null) {
            Log::channel('radiusrelated')->info('[RADIUS BREAKER] Endpoint answered again; resuming normal calls', [
                'endpoint' => $base,
            ]);
        }

        Cache::forget(self::openKey($base));
        Cache::forget(self::failureKey($base));
    }

    /**
     * Consecutive failures recorded against this endpoint so far.
     *
     * Zero once the threshold has been reached — at that point the count is
     * replaced by the open marker, which isOpen() reports instead.
     */
    public static function failureCount(string $url): int
    {
        return (int) Cache::get(self::failureKey(self::baseUrl($url)), 0);
    }

    /**
     * 'down' while the endpoint is in cool-off, otherwise 'up'. Purely for logs,
     * so an operator can read which transport a call chose and why.
     */
    public static function state(string $url): string
    {
        return self::isOpen($url) ? 'down' : 'up';
    }

    /** Clear every recorded state. For diagnostics and tests. */
    public static function reset(string $url): void
    {
        $base = self::baseUrl($url);
        Cache::forget(self::openKey($base));
        Cache::forget(self::failureKey($base));
    }

    /**
     * transport://host:port, with any path and query removed.
     *
     * Endpoints arrive already in this shape from RouterosApiService; the
     * normalisation is kept so a caller that passes a fuller URL still lands on
     * the same key, rather than giving every path its own private circuit.
     */
    public static function baseUrl(string $url): string
    {
        $parts = parse_url($url);

        if ($parts === false || empty($parts['host'])) {
            return $url;
        }

        $scheme = $parts['scheme'] ?? 'http';
        $port   = isset($parts['port']) ? ':' . $parts['port'] : '';

        return $scheme . '://' . $parts['host'] . $port;
    }

    private static function openKey(string $url): string
    {
        return self::PREFIX . 'open:' . self::baseUrl($url);
    }

    private static function failureKey(string $url): string
    {
        return self::PREFIX . 'fail:' . self::baseUrl($url);
    }

    public static function enabled(): bool
    {
        return (bool) config('radius.circuit_breaker.enabled', true);
    }

    private static function threshold(): int
    {
        $configured = (int) config('radius.circuit_breaker.failure_threshold', 5);

        return $configured > 0 ? $configured : 5;
    }

    private static function window(): int
    {
        $configured = (int) config('radius.circuit_breaker.failure_window_seconds', 120);

        return $configured > 0 ? $configured : 120;
    }

    private static function cooldown(): int
    {
        $configured = (int) config('radius.circuit_breaker.cooldown_seconds', 60);

        return $configured > 0 ? $configured : 60;
    }
}
