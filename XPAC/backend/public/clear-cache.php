<?php
/**
 * Cache Clearing Script
 * Access: https://backend.atssfiber.ph/clear-cache.php?key=@tss2025clear
 */

define('CLEAR_KEY', '@tss2025clear');

if (!isset($_GET['key']) || $_GET['key'] !== CLEAR_KEY) {
    http_response_code(403);
    die('Access denied.');
}

require __DIR__.'/../vendor/autoload.php';

$app = require_once __DIR__.'/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "<h1>Cache Clearing</h1>";

try {
    // Clear application cache
    Artisan::call('cache:clear');
    echo "<p>✅ Application cache cleared</p>";
    
    // Clear config cache
    Artisan::call('config:clear');
    echo "<p>✅ Config cache cleared</p>";
    
    // Clear route cache
    Artisan::call('route:clear');
    echo "<p>✅ Route cache cleared</p>";
    
    // Clear view cache
    Artisan::call('view:clear');
    echo "<p>✅ View cache cleared</p>";
    
    // Clear compiled files
    Artisan::call('clear-compiled');
    echo "<p>✅ Compiled files cleared</p>";
    
    // Clear OPcache if available
    if (function_exists('opcache_reset')) {
        opcache_reset();
        echo "<p>✅ OPcache cleared</p>";
    } else {
        echo "<p>⚠️ OPcache not available</p>";
    }
    
    echo "<hr>";
    echo "<h2>✅ All caches cleared successfully!</h2>";
    echo "<p>Now try accessing your pages again:</p>";
    echo "<ul>";
    echo "<li><a href='billing-check.php?key=@tss2025billing'>Billing Check</a></li>";
    echo "<li><a href='manual-billing-test.php?key=@tss2025billing&action=preview'>Manual Test</a></li>";
    echo "</ul>";
    
} catch (\Exception $e) {
    echo "<p>❌ Error: " . $e->getMessage() . "</p>";
}
?>
