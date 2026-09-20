<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('application', function (Blueprint $table) {
            $table->id('Application_ID');
            $table->timestamp('Timestamp')->useCurrent();
            
            // Contact Information
            $table->string('Email_Address')->unique();
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
            $table->string('First_Nearest_landmark')->nullable();
            $table->string('Second_Nearest_landmark')->nullable();
            
            // Additional fields from your existing schema
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
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('application');
    }
};
