<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class UsersSeeder extends Seeder
{
    public function run(): void
    {
        DB::table('users')->upsert(
            [
                [
                    'id'                  => 1,
                    'username'            => 'superadmin',
                    'password_hash'       => Hash::make('superadmin123'),
                    'email_address'       => 'superadmin@localhost.com',
                    'first_name'          => 'Super',
                    'middle_initial'      => null,
                    'last_name'           => 'Admin',
                    'contact_number'      => null,
                    'organization_id'     => null,
                    'role_id'             => 7, // SuperAdmin
                    'agent_id'            => null,
                    'group_id'            => null,
                    'status'              => 'active',
                    'last_login'          => null,
                    'created_by_user_id'  => null,
                    'updated_by_user_id'  => null,
                    'darkmode'            => 'light',
                    'active'              => true,
                    'created_at'          => now(),
                    'updated_at'          => now(),
                ],
            ],
            ['id'],
            ['username', 'password_hash', 'email_address', 'first_name', 'last_name', 'role_id', 'status', 'active', 'updated_at']
        );
    }
}
