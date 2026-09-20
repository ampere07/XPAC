<?php
/**
 * Billing Cron Job Verification Script
 * 
 * Upload this file to: backend/public/billing-check.php
 * Access: https://backend.atssfiber.ph/billing-check.php?key=YOUR_SECRET_KEY
 * 
 * Security: Change the SECRET_KEY below before uploading
 */

define('SECRET_KEY', '@tss2025billing');

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

use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

?>
<!DOCTYPE html>
<html>
<head>
    <title>Billing System Status</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
        h2 { color: #1e40af; margin-top: 30px; border-left: 4px solid #2563eb; padding-left: 10px; }
        .status-box { background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin: 15px 0; border-radius: 4px; }
        .success { background: #f0fdf4; border-left-color: #22c55e; }
        .warning { background: #fefce8; border-left-color: #eab308; }
        .error { background: #fef2f2; border-left-color: #ef4444; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background: #2563eb; color: white; padding: 12px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #ddd; }
        tr:hover { background: #f9fafb; }
        .metric { display: inline-block; background: #dbeafe; padding: 10px 20px; margin: 5px; border-radius: 4px; font-weight: bold; }
        .refresh-btn { background: #2563eb; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
        .refresh-btn:hover { background: #1d4ed8; }
        code { background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Billing System Status Check</h1>
        <p><strong>Last Check:</strong> <?php echo date('Y-m-d H:i:s'); ?> (Server Time)</p>
        <p><strong>Current Day:</strong> <?php echo date('j'); ?> | <strong>Current Month:</strong> <?php echo date('F Y'); ?></p>
        
        <a href="?key=<?php echo SECRET_KEY; ?>" class="refresh-btn">🔄 Refresh Data</a>

        <?php
        $today = Carbon::today();
        $currentDay = $today->day;
        $isLastDay = $today->isLastOfMonth();
        
        echo "<h2>⚙️ System Configuration</h2>";
        echo "<div class='status-box'>";
        echo "<p><strong>Laravel Version:</strong> " . app()->version() . "</p>";
        echo "<p><strong>PHP Version:</strong> " . PHP_VERSION . "</p>";
        echo "<p><strong>Database:</strong> " . config('database.default') . "</p>";
        echo "<p><strong>Timezone:</strong> " . config('app.timezone') . "</p>";
        echo "</div>";

        echo "<h2>🔌 Database Connection</h2>";
        try {
            DB::connection()->getPdo();
            echo "<div class='status-box success'>";
            echo "✅ <strong>Database Connected</strong>";
            echo "</div>";
        } catch (\Exception $e) {
            echo "<div class='status-box error'>";
            echo "❌ <strong>Database Connection Failed:</strong> " . $e->getMessage();
            echo "</div>";
        }

        echo "<h2>📊 Today's Generation Statistics</h2>";
        try {
            $todayInvoices = DB::table('invoices')
                ->whereDate('created_at', $today)
                ->count();
            
            $todaySOA = DB::table('statement_of_accounts')
                ->whereDate('created_at', $today)
                ->count();
            
            $todayTotal = DB::table('invoices')
                ->whereDate('created_at', $today)
                ->sum('total_amount');

            echo "<div class='status-box'>";
            echo "<span class='metric'>📄 Invoices: {$todayInvoices}</span>";
            echo "<span class='metric'>📋 SOA: {$todaySOA}</span>";
            echo "<span class='metric'>💰 Total Amount: ₱" . number_format($todayTotal, 2) . "</span>";
            echo "</div>";

            if ($todayInvoices == 0 && $todaySOA == 0) {
                echo "<div class='status-box warning'>";
                echo "⚠️ <strong>No documents generated today yet.</strong> ";
                echo "Billing runs daily at 1:00 AM. Current time: " . date('H:i:s');
                echo "</div>";
            }
        } catch (\Exception $e) {
            echo "<div class='status-box error'>Error fetching today's statistics: " . $e->getMessage() . "</div>";
        }

        echo "<h2>📅 Accounts Scheduled for Today (Day {$currentDay})</h2>";
        try {
            $scheduledToday = DB::table('billing_accounts')
                ->where('billing_status_id', 2)
                ->whereNotNull('date_installed')
                ->where('billing_day', $currentDay)
                ->count();

            $scheduledEndOfMonth = 0;
            if ($isLastDay) {
                $scheduledEndOfMonth = DB::table('billing_accounts')
                    ->where('billing_status_id', 2)
                    ->whereNotNull('date_installed')
                    ->where('billing_day', 0)
                    ->count();
            }

            $totalScheduled = $scheduledToday + $scheduledEndOfMonth;

            echo "<div class='status-box'>";
            echo "<p><strong>Regular Day {$currentDay}:</strong> {$scheduledToday} accounts</p>";
            if ($isLastDay) {
                echo "<p><strong>End of Month (0):</strong> {$scheduledEndOfMonth} accounts</p>";
                echo "<p><strong>Total for Today:</strong> {$totalScheduled} accounts</p>";
            }
            echo "</div>";

            if ($totalScheduled > 0) {
                $sample = DB::table('billing_accounts as ba')
                    ->join('customers as c', 'ba.customer_id', '=', 'c.id')
                    ->where('ba.billing_status_id', 2)
                    ->whereNotNull('ba.date_installed')
                    ->where(function($query) use ($currentDay, $isLastDay) {
                        $query->where('ba.billing_day', $currentDay);
                        if ($isLastDay) {
                            $query->orWhere('ba.billing_day', 0);
                        }
                    })
                    ->select('ba.account_no', 'c.last_name', 'c.first_name', 'ba.billing_day', 'ba.account_balance')
                    ->limit(10)
                    ->get();

                echo "<table>";
                echo "<tr><th>Account No</th><th>Customer</th><th>Billing Day</th><th>Current Balance</th></tr>";
                foreach ($sample as $account) {
                    $billingDayLabel = $account->billing_day == 0 ? 'End of Month' : 'Day ' . $account->billing_day;
                    echo "<tr>";
                    echo "<td><code>{$account->account_no}</code></td>";
                    echo "<td>{$account->last_name}, {$account->first_name}</td>";
                    echo "<td>{$billingDayLabel}</td>";
                    echo "<td>₱" . number_format($account->account_balance, 2) . "</td>";
                    echo "</tr>";
                }
                echo "</table>";
                
                if ($totalScheduled > 10) {
                    echo "<p><em>Showing 10 of {$totalScheduled} accounts</em></p>";
                }
            } else {
                echo "<div class='status-box warning'>";
                echo "⚠️ <strong>No accounts scheduled for generation today.</strong>";
                echo "</div>";
            }
        } catch (\Exception $e) {
            echo "<div class='status-box error'>Error fetching scheduled accounts: " . $e->getMessage() . "</div>";
        }

        echo "<h2>📈 Recent Generations (Last 7 Days)</h2>";
        try {
            $recentStats = DB::table('invoices')
                ->select(DB::raw('DATE(created_at) as date'), 
                        DB::raw('COUNT(*) as count'),
                        DB::raw('SUM(total_amount) as total'))
                ->where('created_at', '>=', $today->copy()->subDays(7))
                ->groupBy(DB::raw('DATE(created_at)'))
                ->orderBy('date', 'desc')
                ->get();

            if ($recentStats->count() > 0) {
                echo "<table>";
                echo "<tr><th>Date</th><th>Invoices Generated</th><th>Total Amount</th></tr>";
                foreach ($recentStats as $stat) {
                    echo "<tr>";
                    echo "<td>{$stat->date}</td>";
                    echo "<td>{$stat->count}</td>";
                    echo "<td>₱" . number_format($stat->total, 2) . "</td>";
                    echo "</tr>";
                }
                echo "</table>";
            } else {
                echo "<div class='status-box warning'>";
                echo "⚠️ No invoices generated in the last 7 days.";
                echo "</div>";
            }
        } catch (\Exception $e) {
            echo "<div class='status-box error'>Error fetching recent statistics: " . $e->getMessage() . "</div>";
        }

        echo "<h2>📄 Latest 10 Invoices</h2>";
        try {
            $latestInvoices = DB::table('invoices as i')
                ->join('billing_accounts as ba', 'i.account_id', '=', 'ba.id')
                ->join('customers as c', 'ba.customer_id', '=', 'c.id')
                ->select('i.invoice_date', 'ba.account_no', 'c.last_name', 'c.first_name', 
                        'i.total_amount', 'i.status', 'i.created_at')
                ->orderBy('i.created_at', 'desc')
                ->limit(10)
                ->get();

            if ($latestInvoices->count() > 0) {
                echo "<table>";
                echo "<tr><th>Invoice Date</th><th>Account No</th><th>Customer</th><th>Amount</th><th>Status</th><th>Created At</th></tr>";
                foreach ($latestInvoices as $invoice) {
                    $statusClass = $invoice->status === 'Paid' ? 'success' : '';
                    echo "<tr class='{$statusClass}'>";
                    echo "<td>{$invoice->invoice_date}</td>";
                    echo "<td><code>{$invoice->account_no}</code></td>";
                    echo "<td>{$invoice->last_name}, {$invoice->first_name}</td>";
                    echo "<td>₱" . number_format($invoice->total_amount, 2) . "</td>";
                    echo "<td><strong>{$invoice->status}</strong></td>";
                    echo "<td>" . date('Y-m-d H:i', strtotime($invoice->created_at)) . "</td>";
                    echo "</tr>";
                }
                echo "</table>";
            } else {
                echo "<div class='status-box warning'>No invoices found in database.</div>";
            }
        } catch (\Exception $e) {
            echo "<div class='status-box error'>Error fetching latest invoices: " . $e->getMessage() . "</div>";
        }

        echo "<h2>📊 Billing Day Distribution</h2>";
        try {
            $distribution = DB::table('billing_accounts')
                ->select('billing_day', DB::raw('COUNT(*) as count'))
                ->where('billing_status_id', 2)
                ->whereNotNull('date_installed')
                ->groupBy('billing_day')
                ->orderBy('billing_day')
                ->get();

            echo "<table>";
            echo "<tr><th>Billing Day</th><th>Active Accounts</th><th>Percentage</th></tr>";
            
            $totalAccounts = $distribution->sum('count');
            
            foreach ($distribution as $dist) {
                $percentage = $totalAccounts > 0 ? ($dist->count / $totalAccounts) * 100 : 0;
                $billingDayLabel = $dist->billing_day == 0 ? 'End of Month' : 'Day ' . $dist->billing_day;
                echo "<tr>";
                echo "<td><strong>{$billingDayLabel}</strong></td>";
                echo "<td>{$dist->count}</td>";
                echo "<td>" . number_format($percentage, 1) . "%</td>";
                echo "</tr>";
            }
            
            echo "<tr style='background: #f3f4f6; font-weight: bold;'>";
            echo "<td>Total</td>";
            echo "<td>{$totalAccounts}</td>";
            echo "<td>100%</td>";
            echo "</tr>";
            echo "</table>";
        } catch (\Exception $e) {
            echo "<div class='status-box error'>Error fetching billing distribution: " . $e->getMessage() . "</div>";
        }

        echo "<h2>🔧 Cron Job Command Reference</h2>";
        echo "<div class='status-box'>";
        echo "<p><strong>Recommended Command for Hostinger:</strong></p>";
        echo "<code>cd /home/u450636736/domains/atssfiber.ph/public_html/backend && /usr/bin/php artisan schedule:run >> /dev/null 2>&1</code>";
        echo "<p style='margin-top: 15px;'><strong>Schedule:</strong> Every minute (* * * * *)</p>";
        echo "<p><strong>Actual Execution:</strong> Daily at 1:00 AM</p>";
        echo "</div>";

        echo "<h2>💚 System Health Check</h2>";
        $healthChecks = [];
        
        try {
            $canCache = \Illuminate\Support\Facades\Cache::has('test_key');
            $healthChecks[] = ['name' => 'Cache System', 'status' => true];
        } catch (\Exception $e) {
            $healthChecks[] = ['name' => 'Cache System', 'status' => false, 'error' => $e->getMessage()];
        }

        try {
            $tables = ['billing_accounts', 'invoices', 'statement_of_accounts', 'customers', 'technical_details'];
            foreach ($tables as $table) {
                $exists = DB::getSchemaBuilder()->hasTable($table);
                $healthChecks[] = ['name' => "Table: {$table}", 'status' => $exists];
            }
        } catch (\Exception $e) {
            $healthChecks[] = ['name' => 'Database Tables', 'status' => false, 'error' => $e->getMessage()];
        }

        echo "<table>";
        echo "<tr><th>Component</th><th>Status</th><th>Details</th></tr>";
        foreach ($healthChecks as $check) {
            $statusIcon = $check['status'] ? '✅' : '❌';
            $statusText = $check['status'] ? 'OK' : 'FAILED';
            $details = $check['status'] ? '-' : ($check['error'] ?? 'Check failed');
            echo "<tr>";
            echo "<td>{$check['name']}</td>";
            echo "<td>{$statusIcon} {$statusText}</td>";
            echo "<td>{$details}</td>";
            echo "</tr>";
        }
        echo "</table>";

        ?>

        <div style="margin-top: 40px; padding: 20px; background: #f8fafc; border-radius: 8px; text-align: center;">
            <p><strong>📚 Documentation:</strong> See <code>CRON_JOB_SETUP_BILLING.md</code> for detailed setup instructions</p>
            <p><strong>⏰ Next Generation:</strong> Tomorrow at 1:00 AM (Server Time: <?php echo date('Y-m-d 01:00:00'); ?>)</p>
            <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
                <em>Keep this URL secret. Anyone with the key can view your billing data.</em>
            </p>
        </div>
    </div>
</body>
</html>
