<?php

namespace App\Services;

use PDO;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Config;

class TableCheckService
{
    /**
     * Ensure the database exists, create it if it doesn't
     * 
     * @return bool
     */
    public static function ensureDatabaseExists()
    {
        try {
            $dbName = Config::get('database.connections.mysql.database');
            $host = Config::get('database.connections.mysql.host');
            $port = Config::get('database.connections.mysql.port');
            $username = Config::get('database.connections.mysql.username');
            $password = Config::get('database.connections.mysql.password');
            
            Log::info("Checking if database '$dbName' exists on host '$host'.");
            
            // Connect to MySQL without specifying a database
            $dsn = "mysql:host=$host;port=$port";
            
            // Create a PDO connection without database
            try {
                $pdo = new PDO($dsn, $username, $password);
                $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            } catch (\PDOException $e) {
                Log::error("Could not connect to MySQL server: " . $e->getMessage());
                return false;
            }
            
            // Check if database exists
            $stmt = $pdo->query("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '$dbName'");
            $dbExists = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$dbExists) {
                // Create the database
                Log::info("Database '$dbName' not found. Creating it now.");
                $pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbName`");
                Log::info("Database '$dbName' created successfully.");
                
                // Reconnect to MySQL to use the new database
                try {
                    DB::reconnect();
                    Log::info("Successfully reconnected to database '$dbName'.");
                } catch (\Exception $e) {
                    Log::error("Failed to reconnect to the new database: " . $e->getMessage());
                    return false;
                }
                
                return true;
            }
            
            Log::info("Database '$dbName' already exists.");
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create database: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if personal_access_tokens table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensurePersonalAccessTokensTableExists()
    {
        try {
            if (!Schema::hasTable('personal_access_tokens')) {
                Log::info('Personal access tokens table not found. Creating it now.');
                
                Schema::create('personal_access_tokens', function (Blueprint $table) {
                    $table->id();
                    $table->morphs('tokenable');
                    $table->string('name');
                    $table->string('token', 64)->unique();
                    $table->text('abilities')->nullable();
                    $table->timestamp('last_used_at')->nullable();
                    $table->timestamp('expires_at')->nullable();
                    $table->timestamps();
                });
                
                Log::info('Personal access tokens table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create personal_access_tokens table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_REGIONS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppRegionsTableExists()
    {
        try {
            if (!Schema::hasTable('APP_REGIONS')) {
                Log::info('APP_REGIONS table not found. Creating it now.');
                
                Schema::create('APP_REGIONS', function (Blueprint $table) {
                    $table->id();
                    $table->string('name');
                });
                
                Log::info('APP_REGIONS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_REGIONS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_CITIES table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppCitiesTableExists()
    {
        try {
            if (!Schema::hasTable('APP_CITIES')) {
                Log::info('APP_CITIES table not found. Creating it now.');
                
                Schema::create('APP_CITIES', function (Blueprint $table) {
                    $table->id();
                    $table->unsignedBigInteger('region_id');
                    $table->string('name');
                    
                    // Add foreign key if APP_REGIONS table exists
                    if (Schema::hasTable('APP_REGIONS')) {
                        $table->foreign('region_id')->references('id')->on('APP_REGIONS');
                    }
                });
                
                Log::info('APP_CITIES table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_CITIES table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_BARANGAYS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppBarangaysTableExists()
    {
        try {
            if (!Schema::hasTable('APP_BARANGAYS')) {
                Log::info('APP_BARANGAYS table not found. Creating it now.');
                
                Schema::create('APP_BARANGAYS', function (Blueprint $table) {
                    $table->id();
                    $table->unsignedBigInteger('city_id');
                    $table->string('name');
                    
                    // Add foreign key if APP_CITIES table exists
                    if (Schema::hasTable('APP_CITIES')) {
                        $table->foreign('city_id')->references('id')->on('APP_CITIES');
                    }
                });
                
                Log::info('APP_BARANGAYS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_BARANGAYS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_VILLAGES table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppVillagesTableExists()
    {
        try {
            if (!Schema::hasTable('APP_VILLAGES')) {
                Log::info('APP_VILLAGES table not found. Creating it now.');
                
                Schema::create('APP_VILLAGES', function (Blueprint $table) {
                    $table->id();
                    $table->unsignedBigInteger('barangay_id');
                    $table->string('name');
                    
                    // Add foreign key if APP_BARANGAYS table exists
                    if (Schema::hasTable('APP_BARANGAYS')) {
                        $table->foreign('barangay_id')->references('id')->on('APP_BARANGAYS');
                    }
                });
                
                Log::info('APP_VILLAGES table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_VILLAGES table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_PLANS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppPlansTableExists()
    {
        try {
            if (!Schema::hasTable('APP_PLANS')) {
                Log::info('APP_PLANS table not found. Creating it now.');
                
                Schema::create('APP_PLANS', function (Blueprint $table) {
                    $table->id();
                    $table->string('name');
                    $table->text('description')->nullable();
                    $table->decimal('price', 10, 2)->nullable();
                });
                
                Log::info('APP_PLANS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_PLANS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_PARTNERS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppPartnersTableExists()
    {
        try {
            if (!Schema::hasTable('APP_PARTNERS')) {
                Log::info('APP_PARTNERS table not found. Creating it now.');
                
                Schema::create('APP_PARTNERS', function (Blueprint $table) {
                    $table->id();
                    $table->string('name');
                    $table->string('status', 50)->nullable();
                });
                
                Log::info('APP_PARTNERS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_PARTNERS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_GROUPS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureAppGroupsTableExists()
    {
        try {
            if (!Schema::hasTable('APP_GROUPS')) {
                Log::info('APP_GROUPS table not found. Creating it now.');
                
                Schema::create('APP_GROUPS', function (Blueprint $table) {
                    $table->id();
                    $table->string('group_name');
                    $table->text('description')->nullable();
                });
                
                Log::info('APP_GROUPS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_GROUPS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APP_APPLICATIONS table exists and create it if it doesn't
     * This matches the structure shown in the ER diagram
     *
     * @return bool
     */
    public static function ensureAppApplicationsTableExists()
    {
        try {
            if (!Schema::hasTable('APP_APPLICATIONS')) {
                Log::info('APP_APPLICATIONS table not found. Creating it now.');
                
                Schema::create('APP_APPLICATIONS', function (Blueprint $table) {
                    $table->id();
                    
                    // Timestamps
                    $table->date('create_date')->nullable();
                    $table->time('create_time')->nullable();
                    $table->date('update_date')->nullable();
                    $table->time('update_time')->nullable();
                    
                    // Personal information
                    $table->string('email');
                    $table->string('first_name', 100);
                    $table->string('middle_initial', 10)->nullable();
                    $table->string('last_name', 100);
                    $table->string('mobile', 20);
                    $table->string('mobile_alt', 20)->nullable();
                    
                    // Foreign keys for location
                    $table->unsignedBigInteger('region_id')->nullable();
                    $table->unsignedBigInteger('city_id')->nullable();
                    $table->unsignedBigInteger('borough_id')->nullable(); // Equivalent to barangay_id
                    $table->unsignedBigInteger('village_id')->nullable();
                    
                    // Address information
                    $table->text('address_line')->nullable();
                    $table->string('landmark')->nullable();
                    
                    // Plan information
                    $table->unsignedBigInteger('plan_id')->nullable();
                    $table->unsignedBigInteger('promo_id')->nullable();
                    
                    // Document paths (as seen in the ER diagram)
                    $table->string('proof_of_billing')->nullable();
                    $table->string('gov_id_primary')->nullable();
                    $table->string('gov_id_secondary')->nullable();
                    $table->string('house_front_pic')->nullable();
                    $table->string('room_pic')->nullable();
                    
                    // Consent information
                    $table->boolean('primary_consent')->default(false);
                    $table->dateTime('primary_consent_at')->nullable();
                    
                    // Tracking information
                    $table->string('source', 100)->nullable();
                    $table->string('ip_address', 45)->nullable();
                    $table->string('user_agent')->nullable();
                    $table->string('status', 50)->nullable();
                    
                    // Foreign keys for business logic
                    $table->unsignedBigInteger('portal_id')->nullable();
                    $table->unsignedBigInteger('group_id')->nullable();
                    
                    // Add indexes (as shown in ER diagram)
                    $table->index('email');
                    $table->index('region_id');
                    $table->index('city_id');
                    $table->index('borough_id');
                    $table->index('village_id');
                    $table->index('plan_id');
                    $table->index('promo_id');
                    $table->index('group_id');
                });
                
                // Add foreign key constraints if tables exist
                if (Schema::hasTable('APP_REGIONS')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('region_id')->references('id')->on('APP_REGIONS');
                    });
                }
                
                if (Schema::hasTable('APP_CITIES')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('city_id')->references('id')->on('APP_CITIES');
                    });
                }
                
                if (Schema::hasTable('APP_BARANGAYS')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('borough_id')->references('id')->on('APP_BARANGAYS');
                    });
                }
                
                if (Schema::hasTable('APP_VILLAGES')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('village_id')->references('id')->on('APP_VILLAGES');
                    });
                }
                
                if (Schema::hasTable('APP_PLANS')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('plan_id')->references('id')->on('APP_PLANS');
                    });
                }
                
                if (Schema::hasTable('APP_GROUPS')) {
                    Schema::table('APP_APPLICATIONS', function (Blueprint $table) {
                        $table->foreign('group_id')->references('id')->on('APP_GROUPS');
                    });
                }
                
                Log::info('APP_APPLICATIONS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APP_APPLICATIONS table: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Check if APPLICATION_DOCUMENTS table exists and create it if it doesn't
     *
     * @return bool
     */
    public static function ensureApplicationDocumentsTableExists()
    {
        try {
            if (!Schema::hasTable('APPLICATION_DOCUMENTS')) {
                Log::info('APPLICATION_DOCUMENTS table not found. Creating it now.');
                
                Schema::create('APPLICATION_DOCUMENTS', function (Blueprint $table) {
                    $table->id();
                    $table->unsignedBigInteger('application_id');
                    $table->string('document_type');
                    $table->string('document_name');
                    $table->string('file_path');
                    $table->string('file_type')->nullable();
                    $table->unsignedBigInteger('file_size')->nullable();
                    $table->boolean('is_verified')->default(false);
                    $table->string('verification_status')->default('pending');
                    $table->text('verification_notes')->nullable();
                    $table->timestamp('verified_at')->nullable();
                    $table->unsignedBigInteger('verified_by')->nullable();
                    $table->timestamps();
                    
                    // Add foreign key if APP_APPLICATIONS table exists
                    if (Schema::hasTable('APP_APPLICATIONS')) {
                        $table->foreign('application_id')->references('id')->on('APP_APPLICATIONS');
                    }
                });
                
                Log::info('APPLICATION_DOCUMENTS table created successfully.');
                return true;
            }
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to create APPLICATION_DOCUMENTS table: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Check for all required tables based on schema from database/migrations
     * This ensures that your application tables exist even if migrations haven't been run
     *
     * @return array
     */
    public static function ensureAllRequiredTablesExist()
    {
        $results = [];
        
        // First, ensure the database exists
        $dbResult = self::ensureDatabaseExists();
        if (!$dbResult) {
            Log::error('Could not create database. All table creation will fail.');
            return ['database' => false];
        }
        
        $results['database'] = true;
        Log::info('Database check passed successfully.');
        
        // Only create these tables from the ER diagram
        $results['personal_access_tokens'] = self::ensurePersonalAccessTokensTableExists();
        $results['app_regions'] = self::ensureAppRegionsTableExists();
        $results['app_cities'] = self::ensureAppCitiesTableExists();
        $results['app_barangays'] = self::ensureAppBarangaysTableExists();
        $results['app_villages'] = self::ensureAppVillagesTableExists();
        $results['app_plans'] = self::ensureAppPlansTableExists();
        $results['app_partners'] = self::ensureAppPartnersTableExists();
        $results['app_groups'] = self::ensureAppGroupsTableExists();
        $results['app_applications'] = self::ensureAppApplicationsTableExists();
        $results['application_documents'] = self::ensureApplicationDocumentsTableExists();
        
        return $results;
    }
}