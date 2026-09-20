<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\DB;

Route::get('/debug-service-order/{id}', function($id) {
    try {
        // Test the exact query from ServiceOrderController
        $result = DB::selectOne("
            SELECT 
                so.id,
                so.account_no,
                ba.id as billing_account_id,
                ba.account_no as ba_account_no,
                c.first_name,
                c.last_name,
                c.email_address,
                td.id as tech_id,
                td.account_id as td_account_id,
                td.username,
                td.lcp,
                td.nap,
                td.port,
                td.vlan,
                td.connection_type,
                td.router_modem_sn
            FROM service_orders so
            LEFT JOIN billing_accounts ba ON so.account_no = ba.account_no
            LEFT JOIN customers c ON ba.customer_id = c.id
            LEFT JOIN technical_details td ON ba.id = td.account_id
            WHERE so.id = ?
        ", [$id]);
        
        // Also check the raw data
        $serviceOrder = DB::table('service_orders')->where('id', $id)->first();
        $billingAccount = null;
        $technicalDetail = null;
        
        if ($serviceOrder && $serviceOrder->account_no) {
            $billingAccount = DB::table('billing_accounts')
                ->where('account_no', $serviceOrder->account_no)
                ->first();
                
            if ($billingAccount) {
                $technicalDetail = DB::table('technical_details')
                    ->where('account_id', $billingAccount->id)
                    ->first();
            }
        }
        
        return response()->json([
            'success' => true,
            'joined_result' => $result,
            'raw_data' => [
                'service_order' => $serviceOrder,
                'billing_account' => $billingAccount,
                'technical_detail' => $technicalDetail
            ],
            'join_analysis' => [
                'so_account_no' => $serviceOrder->account_no ?? 'NULL',
                'ba_found' => $billingAccount ? 'YES' : 'NO',
                'ba_id' => $billingAccount->id ?? 'NULL',
                'td_found' => $technicalDetail ? 'YES' : 'NO',
                'td_account_id' => $technicalDetail->account_id ?? 'NULL'
            ]
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ], 500);
    }
});
