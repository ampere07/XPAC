#!/bin/bash

echo "==================================="
echo "Payment Worker Cron Status Check"
echo "==================================="
echo ""

# Check if log file exists
LOG_FILE="/home/atsscbms/web/backend.atssfiber.ph/public_html/storage/logs/paymentworker.log"

if [ -f "$LOG_FILE" ]; then
    echo "✓ Log file exists"
    echo "  Location: $LOG_FILE"
    echo "  Size: $(du -h $LOG_FILE | cut -f1)"
    echo "  Last modified: $(stat -c %y $LOG_FILE)"
    echo ""
    
    # Count executions today
    TODAY=$(date +%Y-%m-%d)
    COUNT=$(grep -c "Payment Worker: Starting" $LOG_FILE 2>/dev/null || echo "0")
    echo "✓ Worker executions today: $COUNT"
    echo ""
    
    # Show last 5 entries
    echo "Last 5 log entries:"
    echo "-----------------------------------"
    tail -5 $LOG_FILE
    echo ""
else
    echo "✗ Log file not found!"
    echo "  Expected location: $LOG_FILE"
    echo ""
fi

# Check cron job status
echo "Recent cron executions:"
echo "-----------------------------------"
grep "payments:process" /var/log/syslog 2>/dev/null | tail -3 || echo "No cron executions found in syslog"

echo ""
echo "==================================="
