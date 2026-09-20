<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class ConcernSeeder extends Seeder
{
    public function run(): void
    {
        $concerns = [
            ['id' => 1,  'concern_name' => 'Change Password'],
            ['id' => 2,  'concern_name' => 'Restrict'],
            ['id' => 3,  'concern_name' => 'Migrate'],
            ['id' => 4,  'concern_name' => 'No Internet'],
            ['id' => 5,  'concern_name' => 'Others'],
            ['id' => 6,  'concern_name' => 'Pullout'],
            ['id' => 7,  'concern_name' => 'Reconnect'],
            ['id' => 8,  'concern_name' => 'Relocation'],
            ['id' => 9,  'concern_name' => 'Slow Internet'],
            ['id' => 10, 'concern_name' => 'Update Info'],
            ['id' => 11, 'concern_name' => 'Upgrade/Downgrade Plan'],
            ['id' => 12, 'concern_name' => 'Reactivate'],
        ];

        $rows = array_map(fn($row) => [
            'id'           => $row['id'],
            'concern_name' => $row['concern_name'],
            'modified_by'  => null,
            'modified_at'  => null,
            'organization_id' => null,
        ], $concerns);

        DB::table('concern')->upsert(
            $rows,
            ['id'],
            ['concern_name']
        );
    }
}
