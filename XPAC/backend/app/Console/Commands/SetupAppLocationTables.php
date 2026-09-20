<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SetupAppLocationTables extends Command
{
    protected $signature = 'setup:app-locations';
    protected $description = 'Setup app_regions, app_cities, and app_barangays tables for Location List';

    public function handle()
    {
        $this->info('Setting up app_* location tables...');
        
        try {
            // Create app_regions table
            if (!Schema::hasTable('app_regions')) {
                $this->info('Creating app_regions table...');
                DB::statement("
                    CREATE TABLE `app_regions` (
                      `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
                      `code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                      `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `is_active` tinyint(1) NOT NULL DEFAULT 1,
                      `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system@ampere.com',
                      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                      `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (`id`),
                      UNIQUE KEY `app_regions_name_unique` (`name`),
                      KEY `app_regions_is_active_index` (`is_active`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                ");
                $this->info('✅ app_regions table created!');
            } else {
                $this->info('✓ app_regions table already exists');
            }
            
            // Create app_cities table
            if (!Schema::hasTable('app_cities')) {
                $this->info('Creating app_cities table...');
                DB::statement("
                    CREATE TABLE `app_cities` (
                      `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
                      `region_id` bigint(20) UNSIGNED NOT NULL,
                      `code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                      `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `is_active` tinyint(1) NOT NULL DEFAULT 1,
                      `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system@ampere.com',
                      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                      `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (`id`),
                      KEY `app_cities_region_id_foreign` (`region_id`),
                      KEY `app_cities_is_active_index` (`is_active`),
                      CONSTRAINT `app_cities_region_id_foreign` FOREIGN KEY (`region_id`) REFERENCES `app_regions` (`id`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                ");
                $this->info('✅ app_cities table created!');
            } else {
                $this->info('✓ app_cities table already exists');
            }
            
            // Create app_barangays table
            if (!Schema::hasTable('app_barangays')) {
                $this->info('Creating app_barangays table...');
                DB::statement("
                    CREATE TABLE `app_barangays` (
                      `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
                      `city_id` bigint(20) UNSIGNED NOT NULL,
                      `code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                      `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                      `is_active` tinyint(1) NOT NULL DEFAULT 1,
                      `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system@ampere.com',
                      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                      `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (`id`),
                      KEY `app_barangays_city_id_foreign` (`city_id`),
                      KEY `app_barangays_is_active_index` (`is_active`),
                      CONSTRAINT `app_barangays_city_id_foreign` FOREIGN KEY (`city_id`) REFERENCES `app_cities` (`id`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                ");
                $this->info('✅ app_barangays table created!');
            } else {
                $this->info('✓ app_barangays table already exists');
            }
            
            // Insert sample data
            $this->info('Adding sample location data...');
            
            // Sample regions
            $regions = [
                ['code' => 'R_NCR_001', 'name' => 'National Capital Region (NCR)', 'description' => 'Metropolitan Manila region'],
                ['code' => 'R_REGION4A_002', 'name' => 'CALABARZON (Region IV-A)', 'description' => 'Cavite, Laguna, Batangas, Rizal, Quezon'],
                ['code' => 'R_REGION3_003', 'name' => 'Central Luzon (Region III)', 'description' => 'Central Luzon provinces']
            ];
            
            foreach ($regions as $region) {
                $existing = DB::table('app_regions')->where('name', $region['name'])->first();
                if (!$existing) {
                    $regionData = array_merge($region, [
                        'is_active' => 1,
                        'modified_by' => 'ravenampere0123@gmail.com',
                        'created_at' => now(),
                        'updated_at' => now()
                    ]);
                    DB::table('app_regions')->insert($regionData);
                    $this->info("✅ Added region: {$region['name']}");
                } else {
                    $this->info("✓ Region {$region['name']} already exists");
                }
            }
            
            // Sample cities
            $cities = [
                ['region_name' => 'National Capital Region (NCR)', 'code' => 'C_MANILA_001', 'name' => 'Manila', 'description' => 'Capital city of the Philippines'],
                ['region_name' => 'National Capital Region (NCR)', 'code' => 'C_QUEZON_002', 'name' => 'Quezon City', 'description' => 'Most populous city in Metro Manila'],
                ['region_name' => 'National Capital Region (NCR)', 'code' => 'C_MAKATI_003', 'name' => 'Makati', 'description' => 'Financial center of the Philippines'],
                ['region_name' => 'CALABARZON (Region IV-A)', 'code' => 'C_ANTIPOLO_004', 'name' => 'Antipolo', 'description' => 'City in Rizal province'],
                ['region_name' => 'CALABARZON (Region IV-A)', 'code' => 'C_LAGUNA_005', 'name' => 'Santa Rosa', 'description' => 'City in Laguna province'],
                ['region_name' => 'Central Luzon (Region III)', 'code' => 'C_ANGELES_006', 'name' => 'Angeles', 'description' => 'City in Pampanga province']
            ];
            
            foreach ($cities as $city) {
                $region = DB::table('app_regions')->where('name', $city['region_name'])->first();
                if ($region) {
                    $existing = DB::table('app_cities')->where('name', $city['name'])->where('region_id', $region->id)->first();
                    if (!$existing) {
                        $cityData = [
                            'region_id' => $region->id,
                            'code' => $city['code'],
                            'name' => $city['name'],
                            'description' => $city['description'],
                            'is_active' => 1,
                            'modified_by' => 'ravenampere0123@gmail.com',
                            'created_at' => now(),
                            'updated_at' => now()
                        ];
                        DB::table('app_cities')->insert($cityData);
                        $this->info("✅ Added city: {$city['name']}");
                    } else {
                        $this->info("✓ City {$city['name']} already exists");
                    }
                }
            }
            
            // Sample barangays
            $barangays = [
                ['city_name' => 'Manila', 'code' => 'B_BINONDO_001', 'name' => 'Binondo', 'description' => 'Historic district in Manila'],
                ['city_name' => 'Manila', 'code' => 'B_ERMITA_002', 'name' => 'Ermita', 'description' => 'Tourist district in Manila'],
                ['city_name' => 'Quezon City', 'code' => 'B_DILIMAN_003', 'name' => 'Diliman', 'description' => 'University district in Quezon City'],
                ['city_name' => 'Makati', 'code' => 'B_POBLACION_004', 'name' => 'Poblacion', 'description' => 'Central business district in Makati'],
                ['city_name' => 'Antipolo', 'code' => 'B_BINANGONAN_005', 'name' => 'Binangonan', 'description' => 'Barangay in Antipolo']
            ];
            
            foreach ($barangays as $barangay) {
                $city = DB::table('app_cities')->where('name', $barangay['city_name'])->first();
                if ($city) {
                    $existing = DB::table('app_barangays')->where('name', $barangay['name'])->where('city_id', $city->id)->first();
                    if (!$existing) {
                        $barangayData = [
                            'city_id' => $city->id,
                            'code' => $barangay['code'],
                            'name' => $barangay['name'],
                            'description' => $barangay['description'],
                            'is_active' => 1,
                            'modified_by' => 'ravenampere0123@gmail.com',
                            'created_at' => now(),
                            'updated_at' => now()
                        ];
                        DB::table('app_barangays')->insert($barangayData);
                        $this->info("✅ Added barangay: {$barangay['name']}");
                    } else {
                        $this->info("✓ Barangay {$barangay['name']} already exists");
                    }
                }
            }
            
            // Show statistics
            $regionCount = DB::table('app_regions')->count();
            $cityCount = DB::table('app_cities')->count();
            $barangayCount = DB::table('app_barangays')->count();
            
            $this->info('');
            $this->info('📊 Final statistics:');
            $this->info("Regions: {$regionCount}");
            $this->info("Cities: {$cityCount}");
            $this->info("Barangays: {$barangayCount}");
            $this->info("Total locations: " . ($regionCount + $cityCount + $barangayCount));
            
            $this->info('');
            $this->info('🎉 Location tables setup completed successfully!');
            $this->info('Your Location List will now use app_regions, app_cities, and app_barangays tables.');
            
            return 0;
            
        } catch (\Exception $e) {
            $this->error('❌ Failed to setup location tables: ' . $e->getMessage());
            $this->error('Stack trace: ' . $e->getTraceAsString());
            return 1;
        }
    }
}