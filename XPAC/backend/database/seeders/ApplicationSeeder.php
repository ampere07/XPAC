<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class ApplicationSeeder extends Seeder
{
    public function run(): void
    {
        $firstNames = ['Juan', 'Maria', 'Jose', 'Pedro', 'Ana', 'Manuel', 'Elizabeth', 'Robert', 'Jennie', 'Mark', 'Carlos', 'Patricia', 'Grace', 'David', 'Joseph', 'Sarah', 'Paul', 'Michelle', 'Daniel', 'Karen'];
        $lastNames = ['Dela Cruz', 'Santos', 'Reyes', 'Diaz', 'Aquino', 'Marcos', 'Castro', 'Gonzales', 'Bautista', 'Villanueva', 'Fernandez', 'Lopez', 'Cruz', 'Santiago', 'Ramos', 'Gomez', 'Garcia', 'Torres', 'Diaz', 'Rivera'];
        $barangays = ['San Jose', 'Poblacion', 'San Antonio', 'Bagong Pag-asa', 'Santa Cruz', 'San Roque', 'Concepcion', 'Santo Nino'];
        $plans = ['Plan 1299 - 25 Mbps', 'Plan 1599 - 50 Mbps', 'Plan 1999 - 100 Mbps', 'Plan 2499 - 200 Mbps'];
        $statuses = ['Pending', 'Approved', 'Rejected'];

        $records = [];
        for ($i = 0; $i < 20; $i++) {
            $firstName = $firstNames[$i % count($firstNames)];
            $lastName = $lastNames[$i % count($lastNames)];
            $email = strtolower($firstName . '.' . str_replace(' ', '', $lastName) . '@example.com');
            $barangay = $barangays[$i % count($barangays)];
            $plan = $plans[$i % count($plans)];
            $status = $statuses[$i % count($statuses)];
            $createdDaysAgo = 20 - $i;

            $records[] = [
                'timestamp' => Carbon::now()->subDays($createdDaysAgo),
                'email_address' => $email,
                'first_name' => $firstName,
                'middle_initial' => chr(65 + ($i % 26)), // A-Z
                'last_name' => $lastName,
                'mobile_number' => '0917' . str_pad($i * 47, 7, '0', STR_PAD_LEFT),
                'secondary_mobile_number' => null,
                'installation_address' => 'House #' . ($i + 1) . ', Street ' . ($i + 1) . ', Barangay ' . $barangay,
                'landmark' => 'Near Barangay Hall',
                'region' => 'Region IV-A',
                'city' => 'Calamba',
                'barangay' => $barangay,
                'location' => 'Calamba, Laguna',
                'desired_plan' => $plan,
                'promo' => $i % 3 === 0 ? 'Free installation' : null,
                'referrer_account_id' => null,
                'referred_by' => null,
                'proof_of_billing_url' => 'https://example.com/billing.jpg',
                'government_valid_id_url' => 'https://example.com/id.jpg',
                'second_government_valid_id_url' => null,
                'house_front_picture_url' => 'https://example.com/house.jpg',
                'document_attachment_url' => null,
                'other_isp_bill_url' => null,
                'terms_agreed' => '1',
                'status' => $status,
                'created_by_user_id' => 1,
                'updated_by' => 'superadmin@localhost.com',
                'promo_url' => null,
                'nearest_landmark1_url' => null,
                'nearest_landmark2_url' => null,
                'long_lat' => '14.21' . $i . ',121.16' . $i,
                'remarks' => 'Seeded record #' . ($i + 1),
                'organization_id' => null,
                'created_at' => Carbon::now()->subDays($createdDaysAgo),
                'updated_at' => Carbon::now()->subDays($createdDaysAgo),
            ];
        }

        DB::table('applications')->insert($records);
    }
}
