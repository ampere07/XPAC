<?php

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$usageTypes = \App\Models\UsageType::all();
echo "USAGE_TYPES_BEGIN\n";
foreach($usageTypes as $u) {
    echo $u->id . " => " . $u->usage_name . "\n";
}
echo "USAGE_TYPES_END\n";
