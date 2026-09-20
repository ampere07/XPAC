<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class InventoryCategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            'FTTH',
            'OSP',
            'SERVER',
            'ETC.',
            'EVENT',
            'CABLE TIES',
            'FOC',
            'TAPE',
            'LADDER',
            'ROUTER',
        ];

        $rows = array_map(fn($name) => [
            'category_name'       => $name,
            'organization_id'     => null,
            'created_by_user_id'  => null,
            'updated_by_user_id'  => null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $categories);

        DB::table('inventory_category')->upsert(
            $rows,
            ['category_name'],
            ['category_name', 'updated_at']
        );
    }
}
