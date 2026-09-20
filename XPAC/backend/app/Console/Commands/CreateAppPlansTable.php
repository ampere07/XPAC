<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CreateAppPlansTable extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'plans:create-table';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Create the app_plans table and seed it with sample data';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        try {
            // Check if table already exists
            if (Schema::hasTable('app_plans')) {
                $this->warn('app_plans table already exists!');
                return 0;
            }

            $this->info('Creating app_plans table...');

            // Create the table using raw SQL
            DB::statement('
                CREATE TABLE `app_plans` (
                  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
                  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                  `description` text COLLATE utf8mb4_unicode_ci,
                  `price` decimal(10,2) NOT NULL,
                  `is_active` tinyint(1) NOT NULL DEFAULT 1,
                  `modified_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  `modified_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
                  `created_at` timestamp NULL DEFAULT NULL,
                  `updated_at` timestamp NULL DEFAULT NULL,
                  PRIMARY KEY (`id`),
                  UNIQUE KEY `app_plans_name_unique` (`name`),
                  KEY `app_plans_is_active_name_index` (`is_active`,`name`),
                  KEY `app_plans_price_index` (`price`),
                  KEY `app_plans_modified_date_index` (`modified_date`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ');

            $this->info('✓ app_plans table created successfully!');

            // Insert sample data
            $this->info('Seeding sample data...');

            $plans = [
                [
                    'name' => 'Basic Plan',
                    'description' => 'Basic internet plan for home users with 25 Mbps speed',
                    'price' => 999.00,
                    'is_active' => true,
                    'modified_date' => now(),
                    'modified_by' => 'system@ampere.com',
                    'created_at' => now(),
                    'updated_at' => now()
                ],
                [
                    'name' => 'Premium Plan',
                    'description' => 'High-speed internet plan for businesses with 100 Mbps speed',
                    'price' => 1999.00,
                    'is_active' => true,
                    'modified_date' => now(),
                    'modified_by' => 'system@ampere.com',
                    'created_at' => now(),
                    'updated_at' => now()
                ],
                [
                    'name' => 'Enterprise Plan',
                    'description' => 'Ultra-fast internet plan for large enterprises with 500 Mbps speed',
                    'price' => 4999.00,
                    'is_active' => true,
                    'modified_date' => now(),
                    'modified_by' => 'system@ampere.com',
                    'created_at' => now(),
                    'updated_at' => now()
                ],
                [
                    'name' => 'Student Plan',
                    'description' => 'Affordable internet plan for students with 15 Mbps speed',
                    'price' => 599.00,
                    'is_active' => true,
                    'modified_date' => now(),
                    'modified_by' => 'system@ampere.com',
                    'created_at' => now(),
                    'updated_at' => now()
                ],
                [
                    'name' => 'Family Plan',
                    'description' => 'Perfect for families with multiple devices, 50 Mbps speed',
                    'price' => 1499.00,
                    'is_active' => true,
                    'modified_date' => now(),
                    'modified_by' => 'system@ampere.com',
                    'created_at' => now(),
                    'updated_at' => now()
                ]
            ];

            foreach ($plans as $plan) {
                DB::table('app_plans')->insert($plan);
            }

            $count = DB::table('app_plans')->count();
            $this->info("✓ Successfully seeded {$count} sample plans!");

            $this->info('');
            $this->info('app_plans table is ready for use!');
            $this->info('You can now use the Plan List functionality in your application.');

            return 0;

        } catch (\Exception $e) {
            $this->error('Failed to create app_plans table: ' . $e->getMessage());
            return 1;
        }
    }
}