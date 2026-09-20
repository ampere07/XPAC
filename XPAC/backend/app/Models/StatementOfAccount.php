<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StatementOfAccount extends Model
{
    protected $table = 'statement_of_accounts';

    protected $fillable = [
        'account_no',
        'statement_date',
        'balance_from_previous_bill',
        'payment_received_previous',
        'remaining_balance_previous',
        'monthly_service_fee',
        'others_and_basic_charges',
        'pro_rate',
        'pro_rate_start',
        'service_charge',
        'rebate',
        'discounts',
        'staggered',
        'vat',
        'due_date',
        'amount_due',
        'total_amount_due',
        'print_link',
        'created_by',
        'updated_by',
        'organization_id'
    ];

    protected $casts = [
        'statement_date' => 'datetime',
        'due_date' => 'datetime',
        'balance_from_previous_bill' => 'decimal:2',
        'payment_received_previous' => 'decimal:2',
        'remaining_balance_previous' => 'decimal:2',
        'monthly_service_fee' => 'decimal:2',
        'others_and_basic_charges' => 'decimal:2',
        'pro_rate' => 'decimal:2',
        'pro_rate_start' => 'date',
        'service_charge' => 'decimal:2',
        'rebate' => 'decimal:2',
        'discounts' => 'decimal:2',
        'staggered' => 'decimal:2',
        'vat' => 'decimal:2',
        'amount_due' => 'decimal:2',
        'total_amount_due' => 'decimal:2'
    ];

    protected $with = [];

    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class, 'account_no', 'account_no');
    }

    public function discounts(): HasMany
    {
        return $this->hasMany(Discount::class, 'account_no', 'account_no');
    }

    public function staggeredInstallations(): HasMany
    {
        return $this->hasMany(StaggeredInstallation::class, 'account_no', 'account_no');
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'account_no', 'account_no');
    }

    public function advancedPayments(): HasMany
    {
        return $this->hasMany(AdvancedPayment::class, 'account_no', 'account_no');
    }

    public function serviceCharges(): HasMany
    {
        return $this->hasMany(ServiceChargeLog::class, 'account_no', 'account_no');
    }

    public function scopeWithCompleteData($query)
    {
        return $query->with([
            'billingAccount.customer',
            'billingAccount.technicalDetails',
            'billingAccount.plan',
            'discounts',
            'staggeredInstallations',
            'transactions'
        ]);
    }

    public function scopeByAccount($query, $accountNo)
    {
        return $query->where('account_no', $accountNo);
    }

    public function scopeByDateRange($query, $startDate, $endDate)
    {
        return $query->whereBetween('statement_date', [$startDate, $endDate]);
    }

    public function scopeRecent($query, $limit = 10)
    {
        return $query->orderBy('statement_date', 'desc')->limit($limit);
    }

    public function getAccountNumberAttribute()
    {
        return $this->account_no;
    }

    public function getCustomerNameAttribute()
    {
        return $this->billingAccount?->customer?->full_name;
    }

    public function getCustomerAddressAttribute()
    {
        return $this->billingAccount?->customer?->address;
    }

    public function getCustomerContactAttribute()
    {
        return $this->billingAccount?->customer?->contact_number_primary;
    }

    public function getCustomerPlanAttribute()
    {
        return $this->billingAccount?->customer?->desired_plan;
    }

    public function getTechnicalDetailsAttribute()
    {
        return $this->billingAccount?->technicalDetails->first();
    }

    public function getActiveDiscountsAttribute()
    {
        return $this->discounts()->where('status', 'Unused')->get();
    }

    public function getActiveStaggeredInstallationsAttribute()
    {
        return $this->staggeredInstallations;
    }

    public function toArray()
    {
        $array = parent::toArray();
        
        if ($this->relationLoaded('billingAccount')) {
            $account = $this->billingAccount;
            
            $array['account'] = [
                'id' => $account->id,
                'account_no' => $account->account_no,
                'date_installed' => $account->date_installed?->format('Y-m-d'),
                'billing_day' => $account->billing_day,
                'billing_status_id' => $account->billing_status_id,
                'account_balance' => $account->account_balance,
            ];

            $array['account_no'] = $this->account_no;

            if ($account->relationLoaded('customer')) {
                $customer = $account->customer;
                $array['account']['customer'] = [
                    'id' => $customer->id,
                    'full_name' => $customer->full_name,
                    'first_name' => $customer->first_name,
                    'middle_initial' => $customer->middle_initial,
                    'last_name' => $customer->last_name,
                    'email_address' => $customer->email_address,
                    'contact_number_primary' => $customer->contact_number_primary,
                    'contact_number_secondary' => $customer->contact_number_secondary,
                    'address' => $customer->address,
                    'barangay' => $customer->barangay,
                    'city' => $customer->city,
                    'region' => $customer->region,
                    'desired_plan' => $customer->desired_plan,
                    'housing_status' => $customer->housing_status,
                    'referred_by' => \App\Support\AgentReferral::displayName($customer->referred_by),
                    'group_name' => $customer->group_name,
                ];
            }

            if ($account->relationLoaded('technicalDetails')) {
                $technicalDetails = $account->technicalDetails->first();
                if ($technicalDetails) {
                    $array['account']['technical_details'] = [
                        'id' => $technicalDetails->id,
                        'username' => $technicalDetails->username,
                        'username_status' => $technicalDetails->username_status,
                        'connection_type' => $technicalDetails->connection_type,
                        'router_model' => $technicalDetails->router_model,
                        'router_modem_sn' => $technicalDetails->router_modem_sn,
                        'ip_address' => $technicalDetails->ip_address,
                        'lcp' => $technicalDetails->lcp,
                        'nap' => $technicalDetails->nap,
                        'port' => $technicalDetails->port,
                        'vlan' => $technicalDetails->vlan,
                        'lcpnap' => $technicalDetails->lcpnap,
                        'usage_type_id' => $technicalDetails->usage_type_id,
                    ];
                }
            }
        }

        return $array;
    }
}
