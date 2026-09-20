<?php

namespace App\Services;

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Exception;

class DatabaseService
{
    public static function ensureTablesExist()
    {
        try {
            // Create tables in correct order to handle foreign key dependencies
            self::createOrganizationsTable();
            self::createRolesTable();
            self::createUsersTable();
            self::createGroupsTable();
            self::createUserRolesTable();
            self::createUserGroupsTable();
            self::createActivityLogsTable();
            
            // Create application and job order related tables
            self::createApplicationsTable();
            self::createModemRouterSNTable();
            self::createContractTemplatesTable();
            self::createLCPTable();
            self::createNAPTable();
            self::createPortsTable();
            self::createVLANsTable();
            self::createLCPNAPTable();
            self::createJobOrdersTable();
            
            return ['success' => true, 'message' => 'All tables ensured to exist'];
        } catch (Exception $e) {
            return ['success' => false, 'message' => 'Failed to create tables: ' . $e->getMessage()];
        }
    }

    private static function seedDefaultAdminUser()
    {
        if (!Schema::hasTable('users') || !Schema::hasTable('organizations') || !Schema::hasTable('roles')) {
            return;
        }

        try {
            // Check if admin user already exists
            $existingAdmin = DB::table('users')->where('email', 'admin@ampere.com')->first();
            if ($existingAdmin) {
                return; // Admin user already exists
            }

            // Generate unique user ID
            do {
                $userId = random_int(10000000, 99999999);
            } while (DB::table('users')->where('user_id', $userId)->exists());

            // Create admin user
            $adminUserId = DB::table('users')->insertGetId([
                'user_id' => $userId,
                'salutation' => 'Mr',
                'full_name' => 'System Administrator',
                'username' => 'admin',
                'email' => 'admin@ampere.com',
                'mobile_number' => null,
                'password_hash' => \Hash::make('admin123'),
                'org_id' => 10000001,
                'created_at' => now(),
                'updated_at' => now()
            ]);

            // Assign Administrator role to admin user
            DB::table('user_roles')->updateOrInsert(
                ['user_id' => $userId, 'role_id' => 20000001],
                ['created_at' => now(), 'updated_at' => now()]
            );

        } catch (Exception $e) {
            // Skip if error occurs
            return;
        }
    }

    private static function createActivityLogsTable()
    {
        if (!Schema::hasTable('activity_logs')) {
            Schema::create('activity_logs', function (Blueprint $table) {
                $table->id('log_id');
                $table->string('level')->default('info');
                $table->string('action');
                $table->text('message');
                $table->integer('user_id')->nullable();
                $table->integer('target_user_id')->nullable();
                $table->string('resource_type')->nullable();
                $table->integer('resource_id')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->string('user_agent')->nullable();
                $table->json('additional_data')->nullable();
                $table->timestamps();

                $table->index(['user_id', 'created_at']);
                $table->index(['action', 'created_at']);
                $table->index(['resource_type', 'resource_id']);
            });
        }
    }

    private static function seedJobOrderLookupData()
    {
        // Seed Modem Router SNs
        if (Schema::hasTable('modem_router_sn')) {
            $modems = [
                ['SN' => 'MR001', 'Model' => 'Router Model A'],
                ['SN' => 'MR002', 'Model' => 'Router Model B'],
                ['SN' => 'MR003', 'Model' => 'Router Model C'],
            ];
            
            foreach ($modems as $modem) {
                try {
                    DB::table('modem_router_sn')->updateOrInsert(
                        ['SN' => $modem['SN']],
                        array_merge($modem, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed Contract Templates
        if (Schema::hasTable('contract_templates')) {
            $templates = [
                ['Template_Name' => 'Template_A', 'Description' => 'Basic Service Contract'],
                ['Template_Name' => 'Template_B', 'Description' => 'Premium Service Contract'],
                ['Template_Name' => 'Template_C', 'Description' => 'Enterprise Contract'],
            ];
            
            foreach ($templates as $template) {
                try {
                    DB::table('contract_templates')->updateOrInsert(
                        ['Template_Name' => $template['Template_Name']],
                        array_merge($template, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed LCPs
        if (Schema::hasTable('lcp')) {
            $lcps = [
                ['LCP_ID' => 'LCP001', 'Name' => 'Main Distribution Point A'],
                ['LCP_ID' => 'LCP002', 'Name' => 'Main Distribution Point B'],
                ['LCP_ID' => 'LCP003', 'Name' => 'Secondary Distribution Point'],
            ];
            
            foreach ($lcps as $lcp) {
                try {
                    DB::table('lcp')->updateOrInsert(
                        ['LCP_ID' => $lcp['LCP_ID']],
                        array_merge($lcp, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed NAPs
        if (Schema::hasTable('nap')) {
            $naps = [
                ['NAP_ID' => 'NAP001', 'Location' => 'Network Access Point - Area 1'],
                ['NAP_ID' => 'NAP002', 'Location' => 'Network Access Point - Area 2'],
                ['NAP_ID' => 'NAP003', 'Location' => 'Network Access Point - Area 3'],
            ];
            
            foreach ($naps as $nap) {
                try {
                    DB::table('nap')->updateOrInsert(
                        ['NAP_ID' => $nap['NAP_ID']],
                        array_merge($nap, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed Ports
        if (Schema::hasTable('ports')) {
            $ports = [
                ['PORT_ID' => 'PORT001', 'Label' => 'Port 1'],
                ['PORT_ID' => 'PORT002', 'Label' => 'Port 2'],
                ['PORT_ID' => 'PORT003', 'Label' => 'Port 3'],
                ['PORT_ID' => 'PORT004', 'Label' => 'Port 4'],
            ];
            
            foreach ($ports as $port) {
                try {
                    DB::table('ports')->updateOrInsert(
                        ['PORT_ID' => $port['PORT_ID']],
                        array_merge($port, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed VLANs
        if (Schema::hasTable('vlans')) {
            $vlans = [
                ['VLAN_ID' => 'VLAN100', 'Value' => '100'],
                ['VLAN_ID' => 'VLAN200', 'Value' => '200'],
                ['VLAN_ID' => 'VLAN300', 'Value' => '300'],
            ];
            
            foreach ($vlans as $vlan) {
                try {
                    DB::table('vlans')->updateOrInsert(
                        ['VLAN_ID' => $vlan['VLAN_ID']],
                        array_merge($vlan, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }

        // Seed LCPNAPs
        if (Schema::hasTable('lcpnap')) {
            $lcpnaps = [
                ['LCPNAP_ID' => 'LCPNAP001', 'Combined_Location' => 'LCP001-NAP001'],
                ['LCPNAP_ID' => 'LCPNAP002', 'Combined_Location' => 'LCP001-NAP002'],
                ['LCPNAP_ID' => 'LCPNAP003', 'Combined_Location' => 'LCP002-NAP001'],
            ];
            
            foreach ($lcpnaps as $lcpnap) {
                try {
                    DB::table('lcpnap')->updateOrInsert(
                        ['LCPNAP_ID' => $lcpnap['LCPNAP_ID']],
                        array_merge($lcpnap, ['created_at' => now(), 'updated_at' => now()])
                    );
                } catch (Exception $e) {
                    continue;
                }
            }
        }
    }

    private static function createOrganizationsTable()
    {
        if (!Schema::hasTable('organizations')) {
            Schema::create('organizations', function (Blueprint $table) {
                $table->integer('org_id')->primary();
                $table->string('org_name');
                $table->string('org_type');
                $table->timestamps();
            });
        }
    }

    private static function createRolesTable()
    {
        if (!Schema::hasTable('roles')) {
            Schema::create('roles', function (Blueprint $table) {
                $table->integer('role_id')->primary();
                $table->string('role_name')->unique();
                $table->timestamps();
            });
        }
    }

    private static function createUsersTable()
    {
        if (!Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table) {
                $table->integer('user_id')->primary();
                $table->string('salutation', 10)->nullable();
                $table->string('full_name');
                $table->string('username')->unique();
                $table->string('email')->unique();
                $table->string('mobile_number', 20)->nullable();
                $table->string('password_hash');
                $table->integer('org_id')->nullable();
                $table->rememberToken();
                $table->timestamps();
                
                // Add foreign key constraint only if organizations table exists
                if (Schema::hasTable('organizations')) {
                    $table->foreign('org_id')->references('org_id')->on('organizations')->onDelete('set null');
                }
            });
        }
    }

    private static function createGroupsTable()
    {
        if (!Schema::hasTable('groups')) {
            Schema::create('groups', function (Blueprint $table) {
                $table->integer('group_id')->primary();
                $table->string('group_name');
                $table->integer('org_id');
                $table->timestamps();
                
                // Add foreign key constraint only if organizations table exists
                if (Schema::hasTable('organizations')) {
                    $table->foreign('org_id')->references('org_id')->on('organizations')->onDelete('cascade');
                }
            });
        }
    }

    private static function createUserRolesTable()
    {
        if (!Schema::hasTable('user_roles')) {
            Schema::create('user_roles', function (Blueprint $table) {
                $table->integer('user_id');
                $table->integer('role_id');
                $table->timestamps();
                
                $table->primary(['user_id', 'role_id']);
                
                // Add foreign key constraints only if referenced tables exist
                if (Schema::hasTable('users')) {
                    $table->foreign('user_id')->references('user_id')->on('users')->onDelete('cascade');
                }
                if (Schema::hasTable('roles')) {
                    $table->foreign('role_id')->references('role_id')->on('roles')->onDelete('cascade');
                }
            });
        }
    }

    private static function createUserGroupsTable()
    {
        if (!Schema::hasTable('user_groups')) {
            Schema::create('user_groups', function (Blueprint $table) {
                $table->integer('user_id');
                $table->integer('group_id');
                $table->timestamps();
                
                $table->primary(['user_id', 'group_id']);
                
                // Add foreign key constraints only if referenced tables exist
                if (Schema::hasTable('users')) {
                    $table->foreign('user_id')->references('user_id')->on('users')->onDelete('cascade');
                }
                if (Schema::hasTable('groups')) {
                    $table->foreign('group_id')->references('group_id')->on('groups')->onDelete('cascade');
                }
            });
        }
    }

    public static function seedDefaultData()
    {
        try {
            self::seedDefaultOrganizations();
            self::seedDefaultRoles();
            self::seedDefaultAdminUser();
            self::seedJobOrderLookupData();
            
            return ['success' => true, 'message' => 'Default data seeded successfully'];
        } catch (Exception $e) {
            return ['success' => false, 'message' => 'Failed to seed data: ' . $e->getMessage()];
        }
    }

    private static function seedDefaultOrganizations()
    {
        if (!Schema::hasTable('organizations')) {
            return;
        }

        $organizations = [
            ['org_id' => 10000001, 'org_name' => 'Default Organization', 'org_type' => 'Company'],
            ['org_id' => 10000002, 'org_name' => 'System Organization', 'org_type' => 'System'],
        ];

        foreach ($organizations as $org) {
            try {
                DB::table('organizations')->updateOrInsert(
                    ['org_id' => $org['org_id']],
                    array_merge($org, ['created_at' => now(), 'updated_at' => now()])
                );
            } catch (Exception $e) {
                // Skip if already exists or other error
                continue;
            }
        }
    }

    private static function seedDefaultRoles()
    {
        if (!Schema::hasTable('roles')) {
            return;
        }

        $roles = [
            ['role_id' => 20000001, 'role_name' => 'Administrator'],
            ['role_id' => 20000002, 'role_name' => 'Manager'],
            ['role_id' => 20000003, 'role_name' => 'User'],
            ['role_id' => 20000004, 'role_name' => 'Guest'],
        ];

        foreach ($roles as $role) {
            try {
                DB::table('roles')->updateOrInsert(
                    ['role_id' => $role['role_id']],
                    array_merge($role, ['created_at' => now(), 'updated_at' => now()])
                );
            } catch (Exception $e) {
                // Skip if already exists or other error
                continue;
            }
        }
    }

    public static function checkTableStatus()
    {
        $tables = [
            'organizations', 'roles', 'users', 'groups', 'user_roles', 'user_groups', 'activity_logs',
            'job_orders', 'modem_router_sn', 'contract_templates',
            'lcp', 'nap', 'ports', 'vlans', 'lcpnap'
        ];
        $status = [];
        
        foreach ($tables as $table) {
            try {
                $status[$table] = Schema::hasTable($table);
            } catch (Exception $e) {
                $status[$table] = false;
            }
        }
        
        return $status;
    }

    private static function createModemRouterSNTable()
    {
        if (!Schema::hasTable('modem_router_sn')) {
            Schema::create('modem_router_sn', function (Blueprint $table) {
                $table->string('SN')->primary();
                $table->string('Model')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createContractTemplatesTable()
    {
        if (!Schema::hasTable('contract_templates')) {
            Schema::create('contract_templates', function (Blueprint $table) {
                $table->string('Template_Name')->primary();
                $table->string('Description')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createLCPTable()
    {
        if (!Schema::hasTable('lcp')) {
            Schema::create('lcp', function (Blueprint $table) {
                $table->string('LCP_ID')->primary();
                $table->string('Name')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createNAPTable()
    {
        if (!Schema::hasTable('nap')) {
            Schema::create('nap', function (Blueprint $table) {
                $table->string('NAP_ID')->primary();
                $table->string('Location')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createPortsTable()
    {
        if (!Schema::hasTable('ports')) {
            Schema::create('ports', function (Blueprint $table) {
                $table->string('PORT_ID')->primary();
                $table->string('Label')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createVLANsTable()
    {
        if (!Schema::hasTable('vlans')) {
            Schema::create('vlans', function (Blueprint $table) {
                $table->string('VLAN_ID')->primary();
                $table->string('Value')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createLCPNAPTable()
    {
        if (!Schema::hasTable('lcpnap')) {
            Schema::create('lcpnap', function (Blueprint $table) {
                $table->string('LCPNAP_ID')->primary();
                $table->string('Combined_Location')->nullable();
                $table->timestamps();
            });
        }
    }

    private static function createJobOrdersTable()
    {
        if (!Schema::hasTable('job_orders')) {
            Schema::create('job_orders', function (Blueprint $table) {
                $table->id();
                $table->string('Application_ID')->nullable();
                $table->datetime('Timestamp')->nullable();
                $table->string('Email_Address')->nullable();
                $table->string('Referred_By')->nullable();
                $table->string('First_Name')->nullable();
                $table->string('Middle_Initial')->nullable();
                $table->string('Last_Name')->nullable();
                $table->string('Contact_Number')->nullable();
                $table->string('Applicant_Email_Address')->nullable();
                $table->string('Address')->nullable();
                $table->string('Location')->nullable();
                $table->string('Barangay')->nullable();
                $table->string('City')->nullable();
                $table->string('Region')->nullable();
                $table->string('Choose_Plan')->nullable();
                $table->string('Remarks')->nullable();
                $table->decimal('Installation_Fee', 10, 2)->nullable();
                $table->string('Contract_Template')->nullable();
                $table->string('Billing_Day')->nullable();
                $table->string('Preferred_Day')->nullable();
                $table->string('JO_Remarks')->nullable();
                $table->string('Status')->nullable();
                $table->string('Verified_By')->nullable();
                $table->string('Modem_Router_SN')->nullable();
                $table->string('LCP')->nullable();
                $table->string('NAP')->nullable();
                $table->string('PORT')->nullable();
                $table->string('VLAN')->nullable();
                $table->string('Username')->nullable();
                $table->string('Visit_By')->nullable();
                $table->string('Visit_With')->nullable();
                $table->string('Visit_With_Other')->nullable();
                $table->string('Onsite_Status')->nullable();
                $table->string('Onsite_Remarks')->nullable();
                $table->string('Modified_By')->nullable();
                $table->datetime('Modified_Date')->nullable();
                $table->string('Contract_Link')->nullable();
                $table->string('Connection_Type')->nullable();
                $table->string('Assigned_Email')->nullable();
                $table->string('Setup_Image')->nullable();
                $table->string('Speedtest_Image')->nullable();
                $table->datetime('StartTimeStamp')->nullable();
                $table->datetime('EndTimeStamp')->nullable();
                $table->string('Duration')->nullable();
                $table->string('LCPNAP')->nullable();
                $table->string('Billing_Status')->nullable();
                $table->string('Router_Model')->nullable();
                $table->date('Date_Installed')->nullable();
                $table->string('Client_Signature')->nullable();
                $table->string('IP')->nullable();
                $table->string('Signed_Contract_Image')->nullable();
                $table->string('Box_Reading_Image')->nullable();
                $table->string('Router_Reading_Image')->nullable();
                $table->string('Username_Status')->nullable();
                $table->string('LCPNAPPORT')->nullable();
                $table->string('Usage_Type')->nullable();
                $table->string('Renter')->nullable();
                $table->string('Installation_Landmark')->nullable();
                $table->string('Status_Remarks')->nullable();
                $table->string('Port_Label_Image')->nullable();
                $table->string('Second_Contact_Number')->nullable();
                $table->string('Account_No')->nullable();
                $table->string('Address_Coordinates')->nullable();
                $table->string('Referrers_Account_Number')->nullable();
                $table->string('House_Front_Picture')->nullable();
                $table->timestamps();
            });
        }
    }
}
