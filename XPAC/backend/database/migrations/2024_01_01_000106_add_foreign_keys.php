<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_visits', function (Blueprint $table) {
            $table->foreign('application_id', 'application_visits_application_id_foreign')->references('id')->on('applications')->nullOnDelete();
        });

        Schema::table('applications', function (Blueprint $table) {
            $table->foreign('referrer_account_id', 'applications_referrer_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('created_by_user_id', 'applications_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('attachments', function (Blueprint $table) {
            $table->foreign('account_id', 'attachments_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('created_by', 'attachments_created_by_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('barangay', function (Blueprint $table) {
            $table->foreign('city_id', 'barangay_city_id_foreign')->references('id')->on('city')->nullOnDelete();
        });

        Schema::table('billing_accounts', function (Blueprint $table) {
            $table->foreign('customer_id', 'billing_accounts_customer_id_foreign')->references('id')->on('customers')->nullOnDelete();
            $table->foreign('plan_id', 'billing_accounts_plan_id_foreign')->references('id')->on('plan_list')->nullOnDelete();
            $table->foreign('billing_status_id', 'billing_accounts_billing_status_id_foreign')->references('id')->on('billing_status')->nullOnDelete();
        });

        Schema::table('billing_status', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'billing_status_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('change_due_logs', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'change_due_logs_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('city', function (Blueprint $table) {
            $table->foreign('region_id', 'city_region_id_foreign')->references('id')->on('region')->nullOnDelete();
        });

        Schema::table('dc_notice', function (Blueprint $table) {
            $table->foreign('account_id', 'dc_notice_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('invoice_id', 'dc_notice_invoice_id_foreign')->references('id')->on('invoices')->nullOnDelete();
            $table->foreign('created_by_user_id', 'dc_notice_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('details_update_logs', function (Blueprint $table) {
            $table->foreign('account_id', 'details_update_logs_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('created_by_user_id', 'details_update_logs_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('disconnected_logs', function (Blueprint $table) {
            $table->foreign('account_id', 'disconnected_logs_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
        });

        Schema::table('discounts', function (Blueprint $table) {
            $table->foreign('invoice_used_id', 'discounts_invoice_used_id_foreign')->references('id')->on('invoices')->nullOnDelete();
            $table->foreign('processed_by_user_id', 'discounts_processed_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
            $table->foreign('approved_by_user_id', 'discounts_approved_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by_user_id', 'discounts_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('expenses_category', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'expenses_category_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('group_list', function (Blueprint $table) {
            $table->foreign('modified_by_user_id', 'group_list_modified_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('installment_schedules', function (Blueprint $table) {
            $table->foreign('installment_id', 'installment_schedules_installment_id_foreign')->references('id')->on('installments')->nullOnDelete();
            $table->foreign('invoice_id', 'installment_schedules_invoice_id_foreign')->references('id')->on('invoices')->nullOnDelete();
            $table->foreign('created_by', 'installment_schedules_created_by_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('installments', function (Blueprint $table) {
            $table->foreign('created_by', 'installments_created_by_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('inventory_category', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'inventory_category_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('inventory_items', function (Blueprint $table) {
            $table->foreign('category_id', 'inventory_items_category_id_foreign')->references('id')->on('inventory_category')->nullOnDelete();
            $table->foreign('supplier_id', 'inventory_items_supplier_id_foreign')->references('id')->on('item_supplier_list')->nullOnDelete();
            $table->foreign('created_by_user_id', 'inventory_items_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('inventory_movements', function (Blueprint $table) {
            $table->foreign('item_id', 'inventory_movements_item_id_foreign')->references('id')->on('inventory_items')->nullOnDelete();
            $table->foreign('account_id', 'inventory_movements_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('requested_by_user_id', 'inventory_movements_requested_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by_user_id', 'inventory_movements_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('item_supplier_list', function (Blueprint $table) {
            $table->foreign('category_id', 'item_supplier_list_category_id_foreign')->references('id')->on('inventory_category')->nullOnDelete();
        });

        Schema::table('job_order_items', function (Blueprint $table) {
            $table->foreign('job_order_id', 'job_order_items_job_order_id_foreign')->references('id')->on('job_orders')->nullOnDelete();
        });

        Schema::table('job_orders', function (Blueprint $table) {
            $table->foreign('application_id', 'job_orders_application_id_foreign')->references('id')->on('applications')->nullOnDelete();
            $table->foreign('account_id', 'job_orders_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
        });

        Schema::table('lcp', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'lcp_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('location', function (Blueprint $table) {
            $table->foreign('barangay_id', 'village_barangay_id_foreign')->references('id')->on('barangay')->nullOnDelete();
        });

        Schema::table('nap', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'nap_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('overdue', function (Blueprint $table) {
            $table->foreign('invoice_id', 'overdue_invoice_id_foreign')->references('id')->on('invoices')->nullOnDelete();
            $table->foreign('created_by_user_id', 'overdue_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('plan_change_logs', function (Blueprint $table) {
            $table->foreign('account_id', 'plan_change_logs_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('old_plan_id', 'plan_change_logs_old_plan_id_foreign')->references('id')->on('plan_list')->nullOnDelete();
            $table->foreign('new_plan_id', 'plan_change_logs_new_plan_id_foreign')->references('id')->on('plan_list')->nullOnDelete();
        });

        Schema::table('plan_list', function (Blueprint $table) {
            $table->foreign('group_id', 'plan_list_group_id_foreign')->references('id')->on('group_list')->nullOnDelete();
        });

        Schema::table('promo_list', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'promo_list_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('rebates_usage', function (Blueprint $table) {
            $table->foreign('rebates_id', 'fk_rebates')->references('id')->on('rebates')->nullOnDelete();
        });

        Schema::table('reconnection_logs', function (Blueprint $table) {
            $table->foreign('account_id', 'reconnection_logs_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('plan_id', 'reconnection_logs_plan_id_foreign')->references('id')->on('plan_list')->nullOnDelete();
        });

        Schema::table('repair_category', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'repair_category_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('roles', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'roles_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('router_models', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'router_models_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('service_charge_logs', function (Blueprint $table) {
            $table->foreign('service_order_id', 'service_charge_logs_service_order_id_foreign')->references('id')->on('service_orders')->nullOnDelete();
        });

        Schema::table('service_order_items', function (Blueprint $table) {
            $table->foreign('service_order_id', 'service_order_items_service_order_id_foreign')->references('id')->on('service_orders')->nullOnDelete();
        });

        Schema::table('sms_blast', function (Blueprint $table) {
            $table->foreign('account_id', 'sms_blast_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
            $table->foreign('created_by_user_id', 'sms_blast_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('sms_blast_logs', function (Blueprint $table) {
            $table->foreign('lcpnap_id', 'sms_blast_logs_lcpnap_id_foreign')->references('id')->on('lcpnap')->nullOnDelete();
            $table->foreign('lcp_id', 'sms_blast_logs_lcp_id_foreign')->references('id')->on('lcp')->nullOnDelete();
            $table->foreign('created_by_user_id', 'sms_blast_logs_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('support_concern', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'support_concern_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('technical_details', function (Blueprint $table) {
            $table->foreign('account_id', 'technical_details_account_id_foreign')->references('id')->on('billing_accounts')->nullOnDelete();
        });

        Schema::table('usage_type', function (Blueprint $table) {
            $table->foreign('created_by_user_id', 'usage_type_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreign('organization_id', 'users_organization_id_foreign')->references('id')->on('organizations')->nullOnDelete();
            $table->foreign('role_id', 'users_role_id_foreign')->references('id')->on('roles')->nullOnDelete();
            $table->foreign('group_id', 'users_group_id_foreign')->references('id')->on('group_list')->nullOnDelete();
            $table->foreign('created_by_user_id', 'users_created_by_user_id_foreign')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('application_visits', function (Blueprint $table) {
            $table->dropForeign('application_visits_application_id_foreign');
        });

        Schema::table('applications', function (Blueprint $table) {
            $table->dropForeign('applications_referrer_account_id_foreign');
            $table->dropForeign('applications_created_by_user_id_foreign');
        });

        Schema::table('attachments', function (Blueprint $table) {
            $table->dropForeign('attachments_account_id_foreign');
            $table->dropForeign('attachments_created_by_foreign');
        });

        Schema::table('barangay', function (Blueprint $table) {
            $table->dropForeign('barangay_city_id_foreign');
        });

        Schema::table('billing_accounts', function (Blueprint $table) {
            $table->dropForeign('billing_accounts_customer_id_foreign');
            $table->dropForeign('billing_accounts_plan_id_foreign');
            $table->dropForeign('billing_accounts_billing_status_id_foreign');
        });

        Schema::table('billing_status', function (Blueprint $table) {
            $table->dropForeign('billing_status_created_by_user_id_foreign');
        });

        Schema::table('change_due_logs', function (Blueprint $table) {
            $table->dropForeign('change_due_logs_created_by_user_id_foreign');
        });

        Schema::table('city', function (Blueprint $table) {
            $table->dropForeign('city_region_id_foreign');
        });

        Schema::table('dc_notice', function (Blueprint $table) {
            $table->dropForeign('dc_notice_account_id_foreign');
            $table->dropForeign('dc_notice_invoice_id_foreign');
            $table->dropForeign('dc_notice_created_by_user_id_foreign');
        });

        Schema::table('details_update_logs', function (Blueprint $table) {
            $table->dropForeign('details_update_logs_account_id_foreign');
            $table->dropForeign('details_update_logs_created_by_user_id_foreign');
        });

        Schema::table('disconnected_logs', function (Blueprint $table) {
            $table->dropForeign('disconnected_logs_account_id_foreign');
        });

        Schema::table('discounts', function (Blueprint $table) {
            $table->dropForeign('discounts_invoice_used_id_foreign');
            $table->dropForeign('discounts_processed_by_user_id_foreign');
            $table->dropForeign('discounts_approved_by_user_id_foreign');
            $table->dropForeign('discounts_created_by_user_id_foreign');
        });

        Schema::table('expenses_category', function (Blueprint $table) {
            $table->dropForeign('expenses_category_created_by_user_id_foreign');
        });

        Schema::table('group_list', function (Blueprint $table) {
            $table->dropForeign('group_list_modified_by_user_id_foreign');
        });

        Schema::table('installment_schedules', function (Blueprint $table) {
            $table->dropForeign('installment_schedules_installment_id_foreign');
            $table->dropForeign('installment_schedules_invoice_id_foreign');
            $table->dropForeign('installment_schedules_created_by_foreign');
        });

        Schema::table('installments', function (Blueprint $table) {
            $table->dropForeign('installments_created_by_foreign');
        });

        Schema::table('inventory_category', function (Blueprint $table) {
            $table->dropForeign('inventory_category_created_by_user_id_foreign');
        });

        Schema::table('inventory_items', function (Blueprint $table) {
            $table->dropForeign('inventory_items_category_id_foreign');
            $table->dropForeign('inventory_items_supplier_id_foreign');
            $table->dropForeign('inventory_items_created_by_user_id_foreign');
        });

        Schema::table('inventory_movements', function (Blueprint $table) {
            $table->dropForeign('inventory_movements_item_id_foreign');
            $table->dropForeign('inventory_movements_account_id_foreign');
            $table->dropForeign('inventory_movements_requested_by_user_id_foreign');
            $table->dropForeign('inventory_movements_created_by_user_id_foreign');
        });

        Schema::table('item_supplier_list', function (Blueprint $table) {
            $table->dropForeign('item_supplier_list_category_id_foreign');
        });

        Schema::table('job_order_items', function (Blueprint $table) {
            $table->dropForeign('job_order_items_job_order_id_foreign');
        });

        Schema::table('job_orders', function (Blueprint $table) {
            $table->dropForeign('job_orders_application_id_foreign');
            $table->dropForeign('job_orders_account_id_foreign');
        });

        Schema::table('lcp', function (Blueprint $table) {
            $table->dropForeign('lcp_created_by_user_id_foreign');
        });

        Schema::table('location', function (Blueprint $table) {
            $table->dropForeign('village_barangay_id_foreign');
        });

        Schema::table('nap', function (Blueprint $table) {
            $table->dropForeign('nap_created_by_user_id_foreign');
        });

        Schema::table('overdue', function (Blueprint $table) {
            $table->dropForeign('overdue_invoice_id_foreign');
            $table->dropForeign('overdue_created_by_user_id_foreign');
        });

        Schema::table('plan_change_logs', function (Blueprint $table) {
            $table->dropForeign('plan_change_logs_account_id_foreign');
            $table->dropForeign('plan_change_logs_old_plan_id_foreign');
            $table->dropForeign('plan_change_logs_new_plan_id_foreign');
        });

        Schema::table('plan_list', function (Blueprint $table) {
            $table->dropForeign('plan_list_group_id_foreign');
        });

        Schema::table('promo_list', function (Blueprint $table) {
            $table->dropForeign('promo_list_created_by_user_id_foreign');
        });

        Schema::table('rebates_usage', function (Blueprint $table) {
            $table->dropForeign('fk_rebates');
        });

        Schema::table('reconnection_logs', function (Blueprint $table) {
            $table->dropForeign('reconnection_logs_account_id_foreign');
            $table->dropForeign('reconnection_logs_plan_id_foreign');
        });

        Schema::table('repair_category', function (Blueprint $table) {
            $table->dropForeign('repair_category_created_by_user_id_foreign');
        });

        Schema::table('roles', function (Blueprint $table) {
            $table->dropForeign('roles_created_by_user_id_foreign');
        });

        Schema::table('router_models', function (Blueprint $table) {
            $table->dropForeign('router_models_created_by_user_id_foreign');
        });

        Schema::table('service_charge_logs', function (Blueprint $table) {
            $table->dropForeign('service_charge_logs_service_order_id_foreign');
        });

        Schema::table('service_order_items', function (Blueprint $table) {
            $table->dropForeign('service_order_items_service_order_id_foreign');
        });

        Schema::table('sms_blast', function (Blueprint $table) {
            $table->dropForeign('sms_blast_account_id_foreign');
            $table->dropForeign('sms_blast_created_by_user_id_foreign');
        });

        Schema::table('sms_blast_logs', function (Blueprint $table) {
            $table->dropForeign('sms_blast_logs_lcpnap_id_foreign');
            $table->dropForeign('sms_blast_logs_lcp_id_foreign');
            $table->dropForeign('sms_blast_logs_created_by_user_id_foreign');
        });

        Schema::table('support_concern', function (Blueprint $table) {
            $table->dropForeign('support_concern_created_by_user_id_foreign');
        });

        Schema::table('technical_details', function (Blueprint $table) {
            $table->dropForeign('technical_details_account_id_foreign');
        });

        Schema::table('usage_type', function (Blueprint $table) {
            $table->dropForeign('usage_type_created_by_user_id_foreign');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign('users_organization_id_foreign');
            $table->dropForeign('users_role_id_foreign');
            $table->dropForeign('users_group_id_foreign');
            $table->dropForeign('users_created_by_user_id_foreign');
        });
    }
};
