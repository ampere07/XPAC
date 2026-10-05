<?php

namespace App\Services;

use App\Models\RadiusConfig;
use RuntimeException;

/**
 * TCP ping from this server to a RADIUS device's API port, for the Ping button on the RADIUS
 * Configuration page (PING and LOSS).
 *
 * `count` TCP connects to the port the API dials first
 * ({@see RouterosApiService::primaryEndpoint()}), e.g. a forwarded 58728, each closed as soon as
 * it opens, without logging in. A connect that completes is a reply, and its handshake time the
 * latency. One that is refused or times out is a loss; `refused` counts the first kind apart,
 * since a refusal means the device answered but nothing listens on that port.
 *
 * TCP rather than ICMP because it needs nothing from the server: ICMP from PHP means running the
 * system ping, which production's PHP does not allow (proc_open and exec are disabled). It also
 * tests the path the app actually uses. Settings are in config/radius.php, under `ping`.
 */
class RadiusPingService
{
    /**
     * @return array{host: string, port: int, sent: int, received: int, refused: int, loss_pct: float, min_ms: ?float, avg_ms: ?float, max_ms: ?float, measured_at: string}
     *
     * @throws RuntimeException when the configuration has no address to connect to
     */
    public function ping(RadiusConfig $config): array
    {
        $endpoint = app(RouterosApiService::class)->primaryEndpoint($config);

        if ($endpoint === null) {
            throw new RuntimeException('This RADIUS configuration has no IP address to ping.');
        }

        $host = $endpoint['host'];
        $port = $endpoint['port'];
        $count = max(1, (int) config('radius.ping.count', 10));
        $timeout = max(1, (int) config('radius.ping.timeout_ms', 1000)) / 1000;
        $intervalMs = max(0, (int) config('radius.ping.interval_ms', 200));

        $times = [];
        $refused = 0;

        for ($i = 0; $i < $count; $i++) {
            if ($i > 0 && $intervalMs > 0) {
                usleep($intervalMs * 1000);
            }

            $errno = 0;
            $errstr = '';
            $start = hrtime(true);

            $socket = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, $timeout);

            if ($socket !== false) {
                $times[] = (hrtime(true) - $start) / 1e6;
                fclose($socket);
                continue;
            }

            // ECONNREFUSED: 111 on Linux, 10061 (WSAECONNREFUSED) on Windows.
            if (in_array($errno, [111, 10061], true) || stripos($errstr, 'refused') !== false) {
                $refused++;
            }
        }

        $received = count($times);

        return [
            'host' => $host,
            'port' => $port,
            'sent' => $count,
            'received' => $received,
            'refused' => $refused,
            'loss_pct' => round(($count - $received) / $count * 100, 1),
            'min_ms' => $received ? round(min($times), 1) : null,
            'avg_ms' => $received ? round(array_sum($times) / $received, 1) : null,
            'max_ms' => $received ? round(max($times), 1) : null,
            'measured_at' => now()->format('Y-m-d H:i:s'),
        ];
    }
}
