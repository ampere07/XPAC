<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SetupAppPlansTable extends Command
{
    protected $signature = 'setup:app-plans';
    protected $description = 'Setup the app_plans table with proper structure and sample data';

    public function handle()
    {
        $this->info('Setting up app_plans table...');
        
        try {
            // Drop existing table if it exists
            if (Schema::hasTable('app_plans')) {
                $this->warn('Dropping existing app_plans table...');
                Schema::dropIfExists('app_plans');
            }
            
            // Create table using raw SQL for better control
            $this->info('Creating app_plans table...');
            
            DB::statement('
                CREATE TABLE `app_plans` (
                  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
                  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                  `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
                  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
                  `is_active` tinyint(1) NOT NULL DEFAULT 1,
                  `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT "system@ampere.com",
                  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  PRIMARY KEY (`id`),
                  UNIQUE KEY `app_plans_name_unique` (`name`),
                  KEY `app_plans_is_active_name_index` (`is_active`,`name`),
                  KEY `app_plans_price_index` (`price`),
                  KEY `app_plans_modified_date_index` (`modified_date`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ');
            
            $this->info('✅ app_plans table created successfully!');
            
            // Insert sample data
            $this->info('Inserting sample data...');
            
            $samplePlans = [
                [
                    'name' => 'Basic Plan',
                    'description' => 'Basic internet plan for home users with 25 Mbps speed',
                    'price' => 999.00,
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'name' => 'Premium Plan',
                    'description' => 'High-speed internet plan for businesses with 100 Mbps speed',
                    'price' => 1999.00,
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'name' => 'Enterprise Plan',
                    'description' => 'Ultra-fast internet plan for large enterprises with 500 Mbps speed',
                    'price' => 4999.00,
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'name' => 'Student Plan',
                    'description' => 'Affordable internet plan for students with 15 Mbps speed',
                    'price' => 599.00,
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ],
                [
                    'name' => 'Family Plan',
                    'description' => 'Perfect for families with multiple devices, 50 Mbps speed',
                    'price' => 1499.00,
                    'is_active' => 1,
                    'modified_by' => 'ravenampere0123@gmail.com'
                ]
            ];
            
            foreach ($samplePlans as $plan) {
                DB::table('app_plans')->insert($plan);
            }
            
            $count = DB::table('app_plans')->count();
            $this->info("✅ Inserted {$count} sample plans!");
            
            // Verify the setup
            $this->info('Verifying table structure...');
            $columns = DB::select('DESCRIBE app_plans');
            
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
            $this->info('Sample data in table:');
            $plans = DB::select('SELECT id, name, price, is_active FROM app_plans ORDER BY price');
            
            $this->table(
                ['ID', 'Name', 'Price', 'Active'],
                collect($plans)->map(function ($plan) {
                    return [
                        $plan->id,
                        $plan->name,
                        '₱' . number_format($plan->price, 2),
                        $plan->is_active ? 'Yes' : 'No'
                    ];
                })->toArray()
            );
            
            $this->info('🎉 app_plans table is ready!');
            $this->info('You can now use the Plan List functionality in your application.');
            
            return 0;
            
        } catch (\Exception $e) {
            $this->error('❌ Failed to setup app_plans table: ' . $e->getMessage());
            $this->error('Stack trace: ' . $e->getTraceAsString());
            return 1;
        }
    }
}