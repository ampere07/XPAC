<?php

namespace Tests\Unit;

use App\Models\RadiusConfig;
use App\Services\RadiusReconciliationService;
use App\Services\RadiusServerResolver;
use Mockery;
use Tests\TestCase;

/**
 * Tests for shared-IP fallback detection in the Mikrotik Radius Tool.
 *
 * When multiple radius_config records share the same IP address (e.g. plain API
 * on 8728 and SSL API on 8729 for the same router), the subsequent record must
 * be classified as a fallback rather than a second server.
 */
class RadiusFallbackDetectionTest extends TestCase
{
    public function test_configs_with_same_ip_are_classified_as_primary_and_fallback(): void
    {
        $config1 = new RadiusConfig([
            'id'       => 1,
            'ip'       => '103.121.65.24',
            'port'     => 8728,
            'ssl_type' => 'http',
            'username' => 'apiuser',
        ]);
        $config1->id = 1;

        $config2 = new RadiusConfig([
            'id'       => 7,
            'ip'       => '103.121.65.24',
            'port'     => 8729,
            'ssl_type' => 'https',
            'username' => 'apiuser',
        ]);
        $config2->id = 7;

        $config3 = new RadiusConfig([
            'id'       => 8,
            'ip'       => '103.121.65.99',
            'port'     => 8728,
            'ssl_type' => 'http',
            'username' => 'apiuser',
        ]);
        $config3->id = 8;

        $resolver = Mockery::mock(RadiusServerResolver::class);
        $resolver->shouldReceive('orderedConfigs')
            ->andReturn(collect([$config1, $config2, $config3]));

        $service = new RadiusReconciliationService($resolver);

        $classified = $service->classifiedConfigs();

        // Config 1 is primary Server #1
        $this->assertFalse($classified[1]['is_fallback']);
        $this->assertSame(1, $classified[1]['server_number']);
        $this->assertNull($classified[1]['fallback_for']);
        $this->assertSame('Server #1 (103.121.65.24)', $classified[1]['label']);

        // Config 2 shares IP with Config 1: must be detected as Fallback, NOT Server #2
        $this->assertTrue($classified[7]['is_fallback']);
        $this->assertSame(1, $classified[7]['server_number']);
        $this->assertSame(1, $classified[7]['fallback_for']);
        $this->assertSame('Server #1 Fallback (103.121.65.24)', $classified[7]['label']);

        // Config 3 has a new IP: must be Server #2 (skipping the fallback count)
        $this->assertFalse($classified[8]['is_fallback']);
        $this->assertSame(2, $classified[8]['server_number']);
        $this->assertSame('Server #2 (103.121.65.99)', $classified[8]['label']);

        // Verify getServers() output structure
        $servers = $service->getServers();
        $this->assertCount(3, $servers);

        $this->assertSame(1, $servers[0]['id']);
        $this->assertFalse($servers[0]['is_fallback']);
        $this->assertSame('Server #1 (103.121.65.24)', $servers[0]['label']);

        $this->assertSame(7, $servers[1]['id']);
        $this->assertTrue($servers[1]['is_fallback']);
        $this->assertSame(1, $servers[1]['fallback_for']);
        $this->assertSame('Server #1 Fallback (103.121.65.24)', $servers[1]['label']);

        $this->assertSame(8, $servers[2]['id']);
        $this->assertFalse($servers[2]['is_fallback']);
        $this->assertSame('Server #2 (103.121.65.99)', $servers[2]['label']);
    }

    public function test_resolve_duplicate_blocks_deletion_between_shared_ip_configs(): void
    {
        $config1 = new RadiusConfig([
            'id'       => 1,
            'ip'       => '103.121.65.24',
            'port'     => 8728,
            'ssl_type' => 'http',
            'username' => 'apiuser',
        ]);
        $config1->id = 1;

        $config2 = new RadiusConfig([
            'id'       => 7,
            'ip'       => '103.121.65.24',
            'port'     => 8729,
            'ssl_type' => 'https',
            'username' => 'apiuser',
        ]);
        $config2->id = 7;

        $resolver = Mockery::mock(RadiusServerResolver::class);
        $resolver->shouldReceive('orderedConfigs')
            ->andReturn(collect([$config1, $config2]));

        $service = new RadiusReconciliationService($resolver);

        // Attempting to resolve duplicate between config 1 and config 7 (same IP) must fail safely
        $result = $service->resolveDuplicate('testuser', 1, 7);

        $this->assertFalse($result['success']);
        $this->assertStringContainsString('same IP', $result['message']);
        $this->assertStringContainsString('fallback connection', $result['message']);
    }
}
