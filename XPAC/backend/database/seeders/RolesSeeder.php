<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RolesSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            [
                'id'              => 1,
                'organization_id' => null,
                'role_name'       => 'Administrator',
                'description'     => 'System Administrator with full access',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 2,
                'organization_id' => null,
                'role_name'       => 'Technician',
                'description'     => 'Technician with limited access to maintenance and operations',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 3,
                'organization_id' => null,
                'role_name'       => 'Customer',
                'description'     => 'Customer with access to basic features and services',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 4,
                'organization_id' => null,
                'role_name'       => 'Agent',
                'description'     => 'Agent with assigned operational access',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 5,
                'organization_id' => null,
                'role_name'       => 'InventoryStaff',
                'description'     => null,
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 6,
                'organization_id' => null,
                'role_name'       => 'Osp',
                'description'     => 'OSP role access',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 7,
                'organization_id' => null,
                'role_name'       => 'SuperAdmin',
                'description'     => 'Super Administrator with full system control',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
            [
                'id'              => 8,
                'organization_id' => null,
                'role_name'       => 'HeadTech',
                'description'     => 'Head Technician with supervisory and technical oversight',
                'permissions'     => null,
                'created_by_user_id' => null,
                'updated_by_user_id' => null,
            ],
        ];

        DB::table('roles')->upsert(
            $roles,
            ['id'],
            ['role_name', 'description', 'permissions', 'organization_id']
        );
    }
}
