<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SetupRouterModelsTable extends Command
{
    protected $signature = 'setup:router-models';
    protected $description = 'Setup the modem_router_sn table for Router Models functionality';

    public function handle()
    {
        $this->info('Setting up modem_router_sn table for Router Models...');
        
        try {
            // Check if table exists
            if (!Schema::hasTable('modem_router_sn')) {
                $this->error('❌ modem_router_sn table does not exist!');
                $this->info('Creating modem_router_sn table...');
                
                // Create the table
                DB::statement('
                    CREATE TABLE `modem_router_sn` (
                      `SN` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                      `Model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `brand` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `is_active` tinyint(1) NOT NULL DEFAULT 1,
                      `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT "system@ampere.com",
                      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                      `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (`SN`),
                      KEY `brand_index` (`brand`),
                      KEY `is_active_index` (`is_active`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                ');
                
                $this->info('✅ modem_router_sn table created!');
            } else {
                $this->info('✅ modem_router_sn table already exists');
            }
            
            // Get current columns
            $columns = DB::select('SHOW COLUMNS FROM modem_router_sn');
            $columnNames = array_column($columns, 'Field');
            
            $this->info('Current columns: ' . implode(', ', $columnNames));
            
            // Add missing columns
            $columnsToAdd = [
                'brand' => 'VARCHAR(255) NULL',
                'description' => 'TEXT NULL',
                'is_active' => 'TINYINT(1) NOT NULL DEFAULT 1',
                'modified_date' => 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
                'modified_by' => 'VARCHAR(255) NOT NULL DEFAULT "system@ampere.com"'
            ];
            
            foreach ($columnsToAdd as $column => $definition) {
                if (!in_array($column, $columnNames)) {
                    $this->info("Adding column: {$column}");
                    DB::statement("ALTER TABLE modem_router_sn ADD COLUMN {$column} {$definition}");
                    $this->info("✅ Added {$column} column");
                } else {
                    $this->info("✓ Column {$column} already exists");
                }
            }
            
            // Insert sample data
            $this->info('Adding sample router models...');
            
            $sampleRouters = [
                [
                    'SN' => 'TPL_ARCHER_001',
                    'Model' => 'Archer AX73',
                    'brand' => 'TP-Link',
                    'description' => 'AX5400 Dual Band Gigabit Wi-Fi 6 Router',
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'SN' => 'LIN_VELOP_002',
                    'Model' => 'Velop MX4200',
                    'brand' => 'Linksys',
                    'description' => 'AX4200 Tri-Band Mesh WiFi 6 System',
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'SN' => 'ASU_AX6000_003',
                    'Model' => 'RT-AX88U',
                    'brand' => 'ASUS',
                    'description' => 'AX6000 Dual Band WiFi 6 Gaming Router',
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'SN' => 'NET_ORBI_004',
                    'Model' => 'RBK753',
                    'brand' => 'Netgear',
                    'description' => 'Orbi AX4200 Tri-band Mesh WiFi 6 System',
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'SN' => 'DLI_DIR867_005',
                    'Model' => 'DIR-867',
                    'brand' => 'D-Link',
                    'description' => 'AC1750 MU-MIMO Wi-Fi Gigabit Router',
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ]
            ];
            
            foreach ($sampleRouters as $router) {
                try {
                    // Check if record already exists
                    $existing = DB::table('modem_router_sn')->where('SN', $router['SN'])->first();
                    if (!$existing) {
                        DB::table('modem_router_sn')->insert($router);
                        $this->info("✅ Added router: {$router['brand']} {$router['Model']}");
                    } else {
                        $this->info("✓ Router {$router['SN']} already exists");
                    }
                } catch (\Exception $e) {
                    $this->warn("⚠️  Could not add {$router['SN']}: " . $e->getMessage());
                }
            }
            
            // Verify the setup
            $count = DB::table('modem_router_sn')->count();
            $this->info("📊 Total router models in database: {$count}");
            
            // Show table structure
            $this->info('📋 Final table structure:');
            $columns = DB::select('DESCRIBE modem_router_sn');
            
            $this->table(
                ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'],
                collect($columns)->map(function ($col) {
                    return [
                        $col->Field,
                        $col->Type,
                        $col->Null,
                        $col->Key,
                        $col->Default,
                        $col->Extra
                    ];
                })->toArray()
            );
            
            // Show sample data
            $routers = DB::select('SELECT SN, brand, Model, is_active FROM modem_router_sn ORDER BY brand LIMIT 10');
            
            if (!empty($routers)) {
                $this->info('📋 Sample router models:');
                $this->table(
                    ['Serial Number', 'Brand', 'Model', 'Active'],
                    collect($routers)->map(function ($router) {
                        return [
                            $router->SN,
                            $router->brand ?? 'N/A',
                            $router->Model ?? 'N/A',
                            ($router->is_active ?? 1) ? 'Yes' : 'No'
                        ];
                    })->toArray()
                );
            }
            
            $this->info('🎉 Router Models setup completed successfully!');
            $this->info('You can now use the Router Models functionality in your application.');
            
            return 0;
            
        } catch (\Exception $e) {
            $this->error('❌ Failed to setup router models: ' . $e->getMessage());
            $this->error('Stack trace: ' . $e->getTraceAsString());
            return 1;
        }
    }
}