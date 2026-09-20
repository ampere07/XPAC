<?php
/**
 * Manual Billing Generation Test
 * 
 * Upload this file to: backend/public/manual-billing-test.php
 * Access: https://backend.atssfiber.ph/manual-billing-test.php?key=YOUR_SECRET_KEY&action=preview
 * 
 * Actions:
 * - ?action=preview - Preview what will be generated (safe, no changes)
 * - ?action=generate - Actually generate invoices and SOA (makes database changes)
 * 
 * Security: Change the SECRET_KEY below before uploading
 */

define('SECRET_KEY', '@tss2025test'); // CHANGE THIS!
define('ALLOW_GENERATION', true); // Set to false to disable actual generation

if (!isset($_GET['key']) || $_GET['key'] !== SECRET_KEY) {
    http_response_code(403);
    die('Access denied. Invalid key.');
}

require __DIR__.'/../vendor/autoload.php';

try {
    $app = require_once __DIR__.'/../bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
} catch (\Exception $e) {
    die("Bootstrap error: " . $e->getMessage());
}

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

$action = $_GET['action'] ?? 'preview';
$billingDay = isset($_GET['day']) ? (int)$_GET['day'] : null;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 1;

?>
<!DOCTYPE html>
<html>
<head>
    <title>Manual Billing Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #dc2626; border-bottom: 3px solid #dc2626; padding-bottom: 10px; }
        h2 { color: #991b1b; margin-top: 30px; border-left: 4px solid #dc2626; padding-left: 10px; }
        .warning { background: #fef2f2; border: 2px solid #dc2626; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .info { background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 15px 0; border-radius: 4px; }
        .success { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 15px 0; border-radius: 4px; }
        .error { background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 15px 0; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background: #dc2626; color: white; padding: 12px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #ddd; }
        tr:hover { background: #f9fafb; }
        .btn { display: inline-block; padding: 12px 24px; margin: 5px; border-radius: 6px; text-decoration: none; font-weight: bold; text-align: center; }
        .btn-preview { background: #0ea5e9; color: white; }
        .btn-preview:hover { background: #0284c7; }
        .btn-generate { background: #dc2626; color: white; }
        .btn-generate:hover { background: #991b1b; }
        .btn-back { background: #6b7280; color: white; }
        .btn-back:hover { background: #4b5563; }
        code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
        pre { background: #1e293b; color: #f1f5f9; padding: 15px; border-radius: 8px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Manual Billing Generation Test</h1>
        
        <?php
        $today = Carbon::today();
        $currentDay = $today->day;
        $isLastDay = $today->isLastOfMonth();
        
        echo "<div class='info'>";
        echo "<p><strong>Test Date:</strong> " . $today->format('Y-m-d l') . "</p>";
        echo "<p><strong>Current Day:</strong> {$currentDay}</p>";
        echo "<p><strong>Is Last Day of Month:</strong> " . ($isLastDay ? 'Yes' : 'No') . "</p>";
        echo "<p><strong>User ID:</strong> {$userId}</p>";
        echo "</div>";

        if ($action === 'preview') {
            echo "<div class='warning'>";
            echo "<h3>PREVIEW MODE - NO CHANGES WILL BE MADE</h3>";
            echo "<p>This will show what accounts will be processed without actually generating anything.</p>";
            echo "</div>";
            
            echo "<h2>Accounts Scheduled for Today</h2>";
            
            try {
                $billingDayToCheck = $billingDay ?? $currentDay;
                
                $accounts = DB::table('billing_accounts as ba')
                    ->join('customers as c', 'ba.customer_id', '=', 'c.id')
                    ->where('ba.billing_status_id', 2)
                    ->whereNotNull('ba.date_installed')
                    ->where(function($query) use ($billingDayToCheck, $isLastDay) {
                        $query->where('ba.billing_day', $billingDayToCheck);
                        if ($isLastDay && $billingDayToCheck === $currentDay) {
                            $query->orWhere('ba.billing_day', 0);
                        }
                    })
                    ->select('ba.id', 'ba.account_no', 'c.cust_lname', 'c.cust_fname', 'c.desired_plan', 
                            'ba.billing_day', 'ba.account_balance', 'ba.date_installed')
                    ->get();

                if ($accounts->count() > 0) {
                    echo "<div class='success'>";
                    echo "<p><strong>Found {$accounts->count()} accounts to process</strong></p>";
                    echo "</div>";

                    echo "<table>";
                    echo "<tr><th>#</th><th>Account No</th><th>Customer</th><th>Plan</th><th>Billing Day</th><th>Balance</th><th>Installed</th></tr>";
                    
                    $num = 1;
                    foreach ($accounts as $account) {
                        $billingDayLabel = $account->billing_day == 0 ? 'End of Month' : 'Day ' . $account->billing_day;
                        echo "<tr>";
                        echo "<td>{$num}</td>";
                        echo "<td><code>{$account->account_no}</code></td>";
                        echo "<td>{$account->cust_lname}, {$account->cust_fname}</td>";
                        echo "<td>{$account->desired_plan}</td>";
                        echo "<td>{$billingDayLabel}</td>";
                        echo "<td>₱" . number_format($account->account_balance, 2) . "</td>";
                        echo "<td>{$account->date_installed}</td>";
                        echo "</tr>";
                        $num++;
                    }
                    echo "</table>";

                    echo "<h2>What Will Happen?</h2>";
                    echo "<div class='info'>";
                    echo "<ol>";
                    echo "<li><strong>Invoice Generation:</strong> {$accounts->count()} invoices will be created</li>";
                    echo "<li><strong>SOA Generation:</strong> {$accounts->count()} statements will be created</li>";
                    echo "<li><strong>Balance Updates:</strong> Account balances will be updated</li>";
                    echo "<li><strong>Installment Processing:</strong> Next pending installments will be marked as paid</li>";
                    echo "<li><strong>Discount Application:</strong> Unused discounts will be applied</li>";
                    echo "<li><strong>Advanced Payment:</strong> Relevant advanced payments will be used</li>";
                    echo "</ol>";
                    echo "</div>";

                    if (ALLOW_GENERATION) {
                        echo "<div class='warning'>";
                        echo "<h3>Ready to Generate?</h3>";
                        echo "<p>Click the button below to actually generate the invoices and SOA.</p>";
                        echo "<p><strong>WARNING:</strong> This will make changes to your database!</p>";
                        echo "<a href='?key=" . SECRET_KEY . "&action=generate&user_id={$userId}' class='btn btn-generate'>🚀 Generate Now</a>";
                        echo "<a href='?key=" . SECRET_KEY . "&action=preview' class='btn btn-back'>🔄 Refresh Preview</a>";
                        echo "</div>";
                    } else {
                        echo "<div class='error'>";
                        echo "<p><strong>Generation Disabled:</strong> Set ALLOW_GENERATION to true in the script to enable actual generation.</p>";
                        echo "</div>";
                    }
                } else {
                    echo "<div class='warning'>";
                    echo "<p><strong>No accounts scheduled for generation today.</strong></p>";
                    echo "<p>Billing Day: {$billingDayToCheck}</p>";
                    echo "</div>";

                    echo "<h3>Check Other Billing Days</h3>";
                    echo "<div class='info'>";
                    for ($day = 1; $day <= 31; $day++) {
                        $count = DB::table('billing_accounts')
                            ->where('billing_status_id', 2)
                            ->whereNotNull('date_installed')
                            ->where('billing_day', $day)
                            ->count();
                        
                        if ($count > 0) {
                            echo "<a href='?key=" . SECRET_KEY . "&action=preview&day={$day}' class='btn btn-preview'>Day {$day} ({$count} accounts)</a>";
                        }
                    }
                    
                    $endOfMonthCount = DB::table('billing_accounts')
                        ->where('billing_status_id', 2)
                        ->whereNotNull('date_installed')
                        ->where('billing_day', 0)
                        ->count();
                    
                    if ($endOfMonthCount > 0) {
                        echo "<a href='?key=" . SECRET_KEY . "&action=preview&day=0' class='btn btn-preview'>End of Month ({$endOfMonthCount} accounts)</a>";
                    }
                    echo "</div>";
                }
            } catch (\Exception $e) {
                echo "<div class='error'>";
                echo "<p><strong>Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
                echo "</div>";
            }

        } elseif ($action === 'generate') {
            if (!ALLOW_GENERATION) {
                echo "<div class='error'>";
                echo "<h3>Generation Disabled</h3>";
                echo "<p>Set ALLOW_GENERATION to true in the script to enable actual generation.</p>";
                echo "</div>";
            } else {
                echo "<div class='warning'>";
                echo "<h3>GENERATING INVOICES AND SOA...</h3>";
                echo "<p>Please wait while the system processes the accounts.</p>";
                echo "</div>";

                try {
                    ob_start();
                    
                    if ($billingDay !== null) {
                        Artisan::call('billing:generate-daily', [
                            '--day' => $billingDay,
                            '--user-id' => $userId
                        ]);
                    } else {
                        Artisan::call('billing:generate-daily', [
                            '--user-id' => $userId
                        ]);
                    }
                    
                    $output = Artisan::output();
                    ob_end_clean();

                    echo "<h2>Generation Complete!</h2>";
                    echo "<div class='success'>";
                    echo "<p><strong>Command executed successfully.</strong></p>";
                    echo "</div>";

                    echo "<h3>Command Output:</h3>";
                    echo "<pre>" . htmlspecialchars($output) . "</pre>";

                    echo "<h3>Verification</h3>";
                    $todayInvoices = DB::table('invoices')->whereDate('created_at', $today)->count();
                    $todaySOA = DB::table('statement_of_accounts')->whereDate('created_at', $today)->count();
                    
                    echo "<div class='info'>";
                    echo "<p><strong>Invoices generated today:</strong> {$todayInvoices}</p>";
                    echo "<p><strong>SOA generated today:</strong> {$todaySOA}</p>";
                    echo "</div>";

                    echo "<div class='info'>";
                    echo "<a href='?key=" . SECRET_KEY . "&action=preview' class='btn btn-back'>Back to Preview</a>";
                    echo "<a href='../billing-check.php?key=atss2025billing' class='btn btn-preview' target='_blank'>📊 View Full Status</a>";
                    echo "</div>";

                } catch (\Exception $e) {
                    echo "<div class='error'>";
                    echo "<h3>Generation Failed</h3>";
                    echo "<p><strong>Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
                    echo "<h4>Stack Trace:</h4>";
                    echo "<pre>" . htmlspecialchars($e->getTraceAsString()) . "</pre>";
                    echo "</div>";

                    echo "<div class='info'>";
                    echo "<a href='?key=" . SECRET_KEY . "&action=preview' class='btn btn-back'>Back to Preview</a>";
                    echo "</div>";
                }
            }
        }
        ?>

        <div style="margin-top: 40px; padding: 20px; background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px;">
            <h3 style="color: #dc2626;">Important Security Notes</h3>
            <ul>
                <li>Change the SECRET_KEY in this file before uploading to production</li>
                <li>Keep the URL private - anyone with the key can generate billings</li>
                <li>Delete this file after testing if not needed in production</li>
                <li>Always backup your database before manual generation</li>
                <li>Use preview mode first to verify what will be generated</li>
            </ul>
        </div>

        <div style="margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px; text-align: center;">
            <p style="color: #64748b; font-size: 14px;">
                <strong>Automated Billing System</strong> | 
                For automatic daily generation, ensure your cron job is set up correctly.
            </p>
        </div>
    </div>
</body>
</html>
