<?php

namespace App\Observers;

use App\Models\BillingAccount;
use App\Models\Customer;
use App\Models\TechnicalDetail;
use App\Support\AccountDetailsLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Records every edit to a customer account in details_update_logs.
 *
 * Registered against the three models that together make up an account —
 * Customer, BillingAccount and TechnicalDetail — so any code that saves one of
 * them is logged without having to remember to log: controllers, API endpoints,
 * console commands, services, and anything added later.
 *
 * Why the `updated` event rather than logging at each call site: Eloquent fires
 * it only after a write that actually changed something, and at that moment the
 * model still holds both sides of the edit — getChanges() is exactly the set of
 * columns written, getOriginal() is still the row as it was loaded (the model
 * syncs originals after the event, not before). That gives the old value, the
 * new value, and only the fields that really moved, for free and in one place.
 *
 * A save where nothing changed produces no event and therefore no log entry.
 *
 * Nothing here is allowed to disturb the update it is recording: the whole
 * handler is wrapped, and a failure is logged and dropped rather than thrown
 * into the middle of somebody's save.
 */
class AccountDetailsObserver
{
    public function updated(Model $model): void
    {
        try {
            [$old, $new] = AccountDetailsLog::diff($model->getOriginal(), $model->getChanges());

            if ($old === [] && $new === []) {
                return;
            }

            AccountDetailsLog::record(
                $this->typeFor($model),
                $this->accountIdFor($model),
                $old,
                $new,
                [
                    'account_no' => $this->accountNoFor($model),
                    'source'     => 'model',
                    'model'      => class_basename($model),
                    'record_id'  => $model->getKey(),
                ],
                $this->userIdFor($model),
                $this->organizationIdFor($model)
            );
        } catch (Throwable $e) {
            // The update itself has already succeeded and must stand.
            \Illuminate\Support\Facades\Log::warning('Account change could not be logged', [
                'model' => class_basename($model),
                'id'    => $model->getKey(),
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The log type, matching the vocabulary the Data Logs viewer already maps to
     * readable names in DataLogsController::typeMap.
     */
    private function typeFor(Model $model): string
    {
        if ($model instanceof Customer) {
            return 'customer_details';
        }

        if ($model instanceof BillingAccount) {
            return 'billing_details';
        }

        if ($model instanceof TechnicalDetail) {
            return 'technical_details';
        }

        return $model->getTable();
    }

    /**
     * The billing account the edit belongs to.
     *
     * Every entry hangs off an account id, because that is what the account
     * history screens filter on. A customer is reached through the account that
     * points at them; a technical row already carries the id.
     */
    private function accountIdFor(Model $model): ?int
    {
        if ($model instanceof BillingAccount) {
            return (int) $model->getKey();
        }

        if ($model instanceof TechnicalDetail) {
            if (!empty($model->account_id)) {
                return (int) $model->account_id;
            }

            return $this->accountIdByNumber($model->account_no ?? null);
        }

        if ($model instanceof Customer) {
            $byCustomer = DB::table('billing_accounts')
                ->where('customer_id', $model->getKey())
                ->value('id');

            if ($byCustomer) {
                return (int) $byCustomer;
            }

            return $this->accountIdByNumber($model->account_no ?? null);
        }

        return null;
    }

    private function accountIdByNumber(?string $accountNo): ?int
    {
        if (empty($accountNo)) {
            return null;
        }

        $id = DB::table('billing_accounts')->where('account_no', $accountNo)->value('id');

        return $id ? (int) $id : null;
    }

    /** The account number, kept in the entry so a log line reads on its own. */
    private function accountNoFor(Model $model): ?string
    {
        if (!empty($model->account_no)) {
            return (string) $model->account_no;
        }

        $accountId = $this->accountIdFor($model);

        if ($accountId === null) {
            return null;
        }

        $accountNo = DB::table('billing_accounts')->where('id', $accountId)->value('account_no');

        return $accountNo !== null ? (string) $accountNo : null;
    }

    /**
     * Who made the change.
     *
     * The signed-in user when there is one. Console commands, queue workers and
     * cron runs have no session, so the updated_by the caller wrote on the row
     * is used instead — but only when it is an id, since that column sometimes
     * holds an email address.
     */
    private function userIdFor(Model $model): ?int
    {
        if (Auth::check()) {
            return (int) Auth::id();
        }

        foreach ([$model->updated_by ?? null, $model->created_by ?? null] as $candidate) {
            if (is_numeric($candidate)) {
                return (int) $candidate;
            }
        }

        return null;
    }

    private function organizationIdFor(Model $model): ?int
    {
        return is_numeric($model->organization_id ?? null)
            ? (int) $model->organization_id
            : null;
    }
}
