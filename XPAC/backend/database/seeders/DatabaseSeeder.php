<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RolesSeeder::class,
            UsersSeeder::class,
            RepairCategorySeeder::class,
            ConcernSeeder::class,
            SupportConcernSeeder::class,
            InventoryCategorySeeder::class,
            ApplicationSeeder::class,
            JobOrderSeeder::class,
            CustomerSeeder::class,
            TransactionSeeder::class,
            InvoiceSoaOverdueSeeder::class,
            DiscountsRebatesNoticeSeeder::class,
            PaymentPortalLogSeeder::class,
            ServiceOrderSeeder::class,
        ]);
    }
}
