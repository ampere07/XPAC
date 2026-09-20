<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RepairCategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            'Fiber Relaying',
            'Migrate',
            'Others',
            'Pullout',
            'Reboot/Reconfig Router',
            'Relocate',
            'Relocate Router',
            'Replace Patch Cord',
            'Replace Router',
            'Resplice',
            'Transfer LCP / NAP / PORT',
            'Update VLAN',
            'Reactivation',
        ];

        $rows = array_map(fn($name) => [
            'category_name'       => $name,
            'organization_id'     => null,
            'created_by_user_id'  => null,
            'updated_by_user_id'  => null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $categories);

        DB::table('repair_category')->upsert(
            $rows,
            ['category_name'],
            ['category_name', 'updated_at']
        );
    }
}
