const mysql = require('mysql2/promise');

async function fixDcNotices() {
    console.log('Starting DC Notice data fix...');

    // Database connection using the credentials from your .env file
    const connection = await mysql.createConnection({
        host: '15.235.167.58',
        port: 3306,
        user: 'atsscbms_sync_db1',
        password: 'Sync2026!',
        database: 'atsscbms_sync_db1'
    });

    try {
        console.log('Connected to the database.');

        // 1. Find all DC notices where account_id is null or 0
        const [notices] = await connection.execute(
            `SELECT id, invoice_id, account_id 
             FROM dc_notice 
             WHERE account_id IS NULL OR account_id = 0`
        );

        if (notices.length === 0) {
            console.log('No DC Notice records found with missing account_id. Everything looks good!');
            return;
        }

        console.log(`Found ${notices.length} records to fix.`);

        let successCount = 0;
        let failedCount = 0;

        for (const notice of notices) {
            try {
                let accountNo = notice.account_no;

                // 2. If no account_no on the notice, fetch it from the invoices table
                if (!accountNo && notice.invoice_id) {
                    const [invoices] = await connection.execute(
                        'SELECT account_no FROM invoices WHERE id = ?',
                        [notice.invoice_id]
                    );

                    if (invoices.length > 0) {
                        accountNo = invoices[0].account_no;
                    }
                }

                if (!accountNo) {
                    console.log(`   Notice ID ${notice.id}: Could not determine account_no (No valid Invoice found). Skipping.`);
                    failedCount++;
                    continue;
                }

                // 3. Find the billing account by account_no to get its ID
                const [billingAccounts] = await connection.execute(
                    'SELECT id FROM billing_accounts WHERE account_no = ?',
                    [accountNo]
                );

                if (billingAccounts.length === 0) {
                    console.log(`   Notice ID ${notice.id}: BillingAccount not found for account_no ${accountNo}. Skipping.`);
                    failedCount++;
                    continue;
                }

                const accountId = billingAccounts[0].id;

                // 4. Update the dc_notice record
                await connection.execute(
                    'UPDATE dc_notice SET account_id = ?, updated_at = NOW() WHERE id = ?',
                    [accountId, notice.id]
                );

                console.log(`   Notice ID ${notice.id}: Fixed! Assigned account_id ${accountId} (matched via account_no ${accountNo}).`);
                successCount++;

            } catch (err) {
                console.error(`   Notice ID ${notice.id}: Error - ${err.message}`);
                failedCount++;
            }
        }

        console.log('\nFix DC Notices completed!');
        console.log(`Successfully fixed: ${successCount}`);
        console.log(`Failed/Skipped: ${failedCount}`);

    } catch (error) {
        console.error('Database error:', error);
    } finally {
        await connection.end();
        console.log('Database connection closed.');
    }
}

fixDcNotices();
