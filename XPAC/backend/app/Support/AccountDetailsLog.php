<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The single writer for details_update_logs.
 *
 * Rows keep the shape the Customer Details and Service Order screens already
 * write — a `{type, ...context, data}` JSON object in old_details and
 * new_details — so entries recorded automatically sit beside the ones recorded
 * by hand and the Data Logs viewer renders them without changes. The `type`
 * values used here (customer_details, billing_details, technical_details) are
 * the ones its typeMap already knows.
 *
 * Two rules hold for every caller:
 *
 *  - A write with nothing changed is not written at all.
 *  - A write that fails never reaches the caller. Audit is a record OF the work,
 *    not part of it: a logging error must not roll back or fail the update that
 *    has already happened.
 */
class AccountDetailsLog
{
    /**
     * Columns that say when or by whom a row was written rather than what it
     * holds. They change on every save and describe the bookkeeping, not the
     * account, so logging them would bury the real edit in noise.
     */
    public const BOOKKEEPING_COLUMNS = [
        'created_at',
        'updated_at',
        'deleted_at',
        'created_by',
        'updated_by',
        'created_by_user_id',
        'updated_by_user_id',
        'remember_token',
    ];

    /**
     * Columns whose value must never be written to an audit table. The fact that
     * one changed is recorded; the value is not.
     */
    public const SECRET_COLUMNS = [
        'password',
        'pppoe_password',
        'portal_password',
        'api_password',
    ];

    /**
     * Write one entry describing a change to an account.
     *
     * @param string $type     One of customer_details, billing_details, technical_details.
     * @param int|null $accountId The billing account the change belongs to.
     * @param array<string, mixed> $old Values before, keyed by column.
     * @param array<string, mixed> $new Values after, keyed by the same columns.
     * @param array<string, mixed> $context Extra keys stored alongside `type`.
     * @param int|null $userId The user to credit, when it is not the signed-in one.
     * @param int|null $organizationId
     */
    public static function record(
        string $type,
        ?int $accountId,
        array $old,
        array $new,
        array $context = [],
        ?int $userId = null,
        ?int $organizationId = null
    ): void {
        try {
            if ($old === [] && $new === []) {
                return;
            }

            $envelope = ['type' => $type] + $context;

            DB::table('details_update_logs')->insert([
                'organization_id'    => $organizationId,
                'account_id'         => $accountId,
                'old_details'        => json_encode($envelope + ['data' => $old]),
                'new_details'        => json_encode($envelope + ['data' => $new]),
                'created_by_user_id' => $userId,
                'updated_by_user_id' => $userId,
                'created_at'         => now(),
                'updated_at'         => now(),
            ]);
        } catch (Throwable $e) {
            // Never fatal, by design. See the class docblock.
            Log::warning('details_update_logs entry could not be written', [
                'type'       => $type,
                'account_id' => $accountId,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /**
     * The changed fields of an update, as an old/new pair ready for record().
     *
     * Bookkeeping columns are dropped, secrets are reduced to a marker, and a
     * value that is only superficially different — null against '', 1 against
     * '1', which is how the same value looks coming back from PDO — is not a
     * change at all.
     *
     * @param array<string, mixed> $original The row as it was.
     * @param array<string, mixed> $changes  The columns that were written.
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    public static function diff(array $original, array $changes): array
    {
        $old = [];
        $new = [];

        foreach ($changes as $column => $newValue) {
            if (in_array($column, self::BOOKKEEPING_COLUMNS, true)) {
                continue;
            }

            $oldValue = $original[$column] ?? null;

            if (self::sameValue($oldValue, $newValue)) {
                continue;
            }

            if (in_array($column, self::SECRET_COLUMNS, true)) {
                $old[$column] = '(previous value)';
                $new[$column] = '(changed)';
                continue;
            }

            $old[$column] = self::readable($oldValue);
            $new[$column] = self::readable($newValue);
        }

        return [$old, $new];
    }

    /**
     * Are these two the same value for audit purposes?
     *
     * An empty string and NULL both mean "nothing here", and PDO hands numbers
     * back as strings, so a strict comparison would report edits that nobody
     * made — which is exactly the empty log entry the caller must not write.
     */
    private static function sameValue($old, $new): bool
    {
        $oldEmpty = $old === null || $old === '';
        $newEmpty = $new === null || $new === '';

        if ($oldEmpty || $newEmpty) {
            return $oldEmpty && $newEmpty;
        }

        if (is_scalar($old) && is_scalar($new)) {
            if (is_numeric($old) && is_numeric($new)) {
                return (string) $old === (string) $new
                    || abs((float) $old - (float) $new) < 0.00001;
            }

            return (string) $old === (string) $new;
        }

        return $old == $new;
    }

    /** A value the log table can hold and a person can read. */
    private static function readable($value)
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        if (is_object($value) && method_exists($value, '__toString')) {
            return (string) $value;
        }

        return $value;
    }
}
