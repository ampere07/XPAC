<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class SupportConcernSeeder extends Seeder
{
    public function run(): void
    {
        $concerns = [
            'Change Password',
            'Disconnect',
            'Migrate',
            'No Internet',
            'Others',
            'Pullout',
            'Reconnect',
            'Relocation',
            'Slow Internet',
            'Update Info',
            'Upgrade/Downgrade Plan',
        ];

        $rows = array_map(fn($name) => [
            'concern_name'        => $name,
            'organization_id'     => null,
            'created_by_user_id'  => null,
            'updated_by_user_id'  => null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $concerns);

        DB::table('support_concern')->upsert(
            $rows,
            ['concern_name'],
            ['concern_name', 'updated_at']
        );
    }
}
