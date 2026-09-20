<?php

namespace App\Services;

use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Log;

class ApplicationTableService
{
    /**
     * Ensure the application table exists, create it if it doesn't
     *
     * @return bool
     */
    public static function ensureApplicationTableExists()
    {
        try {
            // Check if the table already exists
            if (Schema::hasTable('application')) {
                Log::info('Application table already exists.');
                return true;
            }

            Log::info('Application table not found. Creating it now.');

            // Create the application table
            Schema::create('application', function (Blueprint $table) {
                $table->id('Application_ID');
                $table->timestamp('Timestamp')->useCurrent();
                
                // Contact Information
                $table->string('Email_Address');
                $table->string('Mobile_Number');
                $table->string('First_Name');
                $table->string('Last_Name');
                $table->string('Middle_Initial')->nullable();
                $table->string('Secondary_Mobile_Number')->nullable();
                
                // Location Information
                $table->string('Region');
                $table->string('City');
                $table->string('Barangay');
                $table->text('Installation_Address');
                $table->string('Landmark');
                $table->string('Referred_by')->nullable();
                
                // Plan Selection
                $table->string('Desired_Plan');
                $table->string('Select_the_applicable_promo')->default('None');
                
                // Document File Paths
                $table->string('Proof_of_Billing')->nullable();
                $table->string('Government_Valid_ID')->nullable();
                $table->string('2nd_Government_Valid_ID')->nullable();
                $table->string('House_Front_Picture')->nullable();
                
                // Additional fields
                $table->boolean('I_agree_to_the_terms_and_conditions')->default(false);
                $table->string('Attach_the_picture_of_your_document')->nullable();
                $table->string('Attach_SOA_from_other_provider')->nullable();
                $table->string('Referrers_Account_Number')->nullable();
                $table->string('Applying_for')->nullable();
                
                // Application Status
                $table->string('Status')->default('pending');
                $table->string('Visit_By')->nullable();
                $table->string('Visit_With')->nullable();
                $table->string('Visit_With_Other')->nullable();
                $table->text('Remarks')->nullable();
                $table->string('Modified_By')->nullable();
                $table->timestamp('Modified_Date')->nullable();
                $table->string('User_Email')->nullable();
                
                // Add index on email for better performance
                $table->index('Email_Address');
            });

            Log::info('Application table created successfully.');
            return true;

        } catch (\Exception $e) {
            Log::error('Failed to create application table: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if all required columns exist in the application table
     *
     * @return bool
     */
    public static function validateTableStructure()
    {
        try {
            $requiredColumns = [
                'Application_ID', 'Email_Address', 'Mobile_Number', 'First_Name', 'Last_Name',
                'Region', 'City', 'Barangay', 'Installation_Address', 'Landmark',
                'Desired_Plan', 'Status', 'Timestamp'
            ];

            foreach ($requiredColumns as $column) {
                if (!Schema::hasColumn('application', $column)) {
                    Log::warning("Missing column: {$column} in application table");
                    return false;
                }
            }

            return true;

        } catch (\Exception $e) {
            Log::error('Error validating table structure: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get table structure for debugging
     *
     * @return array
     */
    public static function getTableStructure()
    {
        try {
            if (!Schema::hasTable('application')) {
                return ['error' => 'Table does not exist'];
            }

            $columns = DB::select("DESCRIBE application");
            return array_map(function($column) {
                return [
                    'field' => $column->Field,
                    'type' => $column->Type,
                    'null' => $column->Null,
                    'key' => $column->Key,
                    'default' => $column->Default
                ];
            }, $columns);

        } catch (\Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
}
