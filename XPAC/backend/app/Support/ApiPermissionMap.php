<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * What the API requires of a caller, endpoint by endpoint.
 *
 * The routes file has ~740 endpoints of which only a handful sit behind
 * `auth:sanctum`; the rest answer anyone who can reach the host. Rather
 * than annotate 700-odd route definitions — and lose the next one that gets
 * added without an annotation — the requirement is declared here in one table
 * and applied by App\Http\Middleware\ApiAccessControl to every request in the
 * `api` group.
 *
 * Three kinds of requirement:
 *
 *   PUBLIC_ACCESS  no credentials at all. Sign-in, the payment provider's
 *                  webhook, and the handful of branding endpoints the login
 *                  screen paints itself with before anyone has signed in.
 *
 *   null           any signed-in user. Reference and lookup data — regions,
 *                  plans, LCP/NAP, status remarks — which every role needs to
 *                  fill in the forms its own pages own. Reading the list of
 *                  barangays is not what authorization is for; writing to it
 *                  is, and the write side of each of those carries a key.
 *
 *   key | [keys]   a permission key from App\Support\Permissions. An array
 *                  means "any one of these", for endpoints that legitimately
 *                  serve two audiences — an invoice is read both from the admin
 *                  Invoice page and from the customer's own Bills page.
 *
 * Rules are matched in order and the first hit wins, so a specific path is
 * listed above the prefix that would otherwise swallow it. Patterns use `*`
 * (Str::is), matched against the path with the leading `api/` removed.
 *
 * A path that matches nothing falls through to DEFAULT_REQUIREMENT — signed in,
 * any role — so a newly added route is never anonymous by accident.
 * ApiPermissionCoverageTest fails on any route that is not matched by a rule
 * here, which is what stops that default from quietly becoming the norm.
 *
 * Whether a refusal is applied, only logged, or skipped is the rollout mode in
 * config/permissions.php — see App\Http\Middleware\ApiAccessControl.
 */
final class ApiPermissionMap
{
    /** No credentials required. */
    public const PUBLIC_ACCESS = 'public';

    /** Applied to any path no rule matches: signed in, no particular key. */
    public const DEFAULT_REQUIREMENT = null;

    /**
     * Keys whose holders open other pages' records read-only, as overlays.
     *
     * JobOrderDetails, the Service Order pane, Application Management and the
     * LCP/NAP Location map open CustomerDetails, TransactionListDetails,
     * SOADetails, InvoiceDetails, PaymentPortalDetails, InventoryDetails,
     * ApplicationDetails and PlanListDetails as overlays — for the Technician
     * (2), OSP (6) and Head Technician (8) as much as for an administrator — and
     * those panes load their data straight from the owning page's endpoints.
     * They worked before this table existed, so the READ side of exactly those
     * endpoints (and the SOA PDF render) accepts these keys as well. The write
     * side of every one of them is unchanged: an overlay that can be read is not
     * a licence to post transactions or edit accounts from it.
     *
     * Job Order is represented by its working actions rather than by the bare
     * page key. The Agent (4) holds the `job-order` page to follow their own
     * referrals and never opens these panes; with the page key here an agent
     * could read the billing table, every transaction, every payment-portal log
     * and every statement. Every role that does open them works job orders
     * (2: tech-edit, 8: admin-edit, 1/7: all) or holds one of the other three
     * pages, so nothing the clients do is refused. Rules that already accepted
     * the `job-order` page (job-orders/{id}, applications/{id}) still list it.
     */
    private const OVERLAY_READERS = [
        'job-order.tech-edit', 'job-order.admin-edit', 'job-order.approve', 'job-order.failed', 'job-order.attachment',
        'service-order', 'application-management', 'lcp-nap-location',
    ];

    /**
     * [pattern, GET requirement, write requirement] with an optional fourth
     * element: per-method requirements that override the write one.
     *
     * "write" covers POST, PUT, PATCH and DELETE. Where a single value is given
     * for both read and write it is repeated rather than defaulted, so each line
     * reads on its own.
     *
     * The fourth element exists for the handful of endpoints where one verb is
     * heavier than its neighbours — deleting a report is not the same act as
     * editing one — and is written `['DELETE' => 'reports.delete']`.
     *
     * It may also be a plain string naming a page, which is shorthand for that
     * page's standard verbs:
     *
     *     ['plans*', null, 'plan-list', 'plan-list'],
     *
     * reads as "anyone signed in may read the plan list; creating needs
     * plan-list.create, updating plan-list.edit, deleting plan-list.delete".
     * The third element stays the page key, so a write method outside those
     * four still requires the page rather than falling through to nothing.
     * Writing the four out by hand twenty-five times would bury the handful of
     * rows that genuinely differ.
     */
    private const RULES = [
        // ── Anonymous ────────────────────────────────────────────────────────
        // Sign-in and the pieces the sign-in screen itself renders.
        ['login',                        self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['forgot-password',              self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['health',                       self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        // "Is my session still good?" The web app asks on boot, signed in or
        // not, and it answers 200 {authenticated:false} to a stranger.
        ['auth/session',                 self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['cors-test',                    self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['locations-ping',               self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        // Read by the mobile app before anyone signs in, to decide whether the
        // installed build is still supported. Writing it is a setting.
        ['app-version/config',           self::PUBLIC_ACCESS, 'settings'],
        ['form-ui/config',               self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['settings-color-palette/active', self::PUBLIC_ACCESS, 'settings'],
        ['settings-image-size/active',   self::PUBLIC_ACCESS, 'settings'],
        ['system-config/logo',           self::PUBLIC_ACCESS, 'settings'],
        // Xendit calls these; there is no user to authenticate. The controller
        // verifies the provider's callback token.
        ['xendit-webhook',               self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['payments/webhook',             self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['payments/webhook-info',        self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        // Rendered by <img src>, which sends no Authorization header.
        ['proxy/image',                  self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],

        // ── Diagnostics and one-off maintenance ──────────────────────────────
        // Listed first so a specific diagnostic beats the prefix rule for its
        // section further down. None of these is called by any client.
        //
        // `login-debug` is superadmin rather than public because it reports
        // whether an account exists and whether a password matches, which is an
        // account-enumeration oracle if left open.
        ['login-debug',                  'settings', 'settings'],
        ['debug/*',                      'settings', 'settings'],
        ['fix-customer-password',        'settings', 'settings'],
        ['emergency/*',                  'settings', 'settings'],
        ['setup/*',                      'settings', 'settings'],
        ['locations/mock',               'settings', 'settings'],
        ['locations/test',               'settings', 'settings'],
        ['locations/all-debug',          'settings', 'settings'],
        ['locations/locations/debug',    'settings', 'settings'],
        ['plans-test',                   'settings', 'settings'],
        ['plans-direct',                 'settings', 'settings'],
        ['job-order-items-test',         'settings', 'settings'],
        ['reports-migrate-pdf',          'settings', 'settings'],
        ['inventory/debug',              'settings', 'settings'],
        ['user-preferences/debug',       'settings', 'settings'],
        ['mass-rebates/test',            'mass-rebate', 'mass-rebate'],
        ['mass-rebates/test-connection', 'mass-rebate', 'mass-rebate'],
        ['monitor/debug',                'live-monitor', 'live-monitor'],
        ['notifications/debug-timezone', null, null],

        // ── The signed-in user's own account ─────────────────────────────────
        ['user',                         null, null],
        // Deliberately anonymous, like the route itself: logging out must
        // succeed when the session has already lapsed, or the client gets a
        // 401 while trying to clean up (see the route in routes/api.php).
        ['logout',                       self::PUBLIC_ACCESS, self::PUBLIC_ACCESS],
        ['me/permissions',               null, null],
        ['user-preferences/*',           null, null],
        ['user-settings/*',              null, null],
        ['broadcasting/auth',            null, null],
        ['tech-in-out/*',                null, null],
        // A technician's device posts its own position; who may read the trail
        // is the restricted half.
        ['technician-location',          null, null],
        // Read by Monitoring and by the Head Technician's screens. The
        // controller itself admits only Administrator, SuperAdmin and Head
        // Technician, so signed in is all this table adds.
        ['technician-locations*',        null, null],

        // ── Presence pings ───────────────────────────────────────────────────
        // "who else is looking at this record" — no data returned, and every
        // list page that has a detail pane sends them.
        ['*/broadcast-viewing',          null, null],

        // ── Dashboards ───────────────────────────────────────────────────────
        ['dashboard/counts',             'dashboard', 'dashboard'],
        ['monitor/*',                    'live-monitor', 'live-monitor'],

        // ── Reference data ───────────────────────────────────────────────────
        // Read by everyone (form dropdowns, detail panes); written from the
        // Configurations page that owns the list.
        //
        // The fourth column is the page whose standard verbs govern the write:
        // POST needs `<page>.create`, PUT and PATCH `<page>.edit`, DELETE
        // `<page>.delete`. See the block comment above RULES.
        ['locations/{type}/*/related',   null, null],
        ['locations*',                   null, 'location-list', 'location-list'],
        ['location-details*',            null, 'location-list', 'location-list'],
        ['regions*',                     null, 'location-list', 'location-list'],
        ['region_list*',                 null, 'location-list', 'location-list'],
        ['cities*',                      null, 'location-list', 'location-list'],
        ['city_list*',                   null, 'location-list', 'location-list'],
        ['barangays*',                   null, 'location-list', 'location-list'],
        ['barangay_list*',               null, 'location-list', 'location-list'],
        ['villages*',                    null, 'location-list', 'location-list'],
        ['plans*',                       null, 'plan-list', 'plan-list'],
        ['promos*',                      null, 'promo-list', 'promo-list'],
        ['lcp-nap-locations',            null, 'lcp-nap-location'],
        ['lcpnap*',                      null, ['lcp', 'nap', 'lcp-nap-location']],
        ['lcp*',                         null, 'lcp', 'lcp'],
        ['nap*',                         null, 'nap', 'nap'],
        ['ports*',                       null, 'ports', 'ports'],
        ['port*',                        null, 'ports', 'ports'],
        ['vlans*',                       null, 'vlan-config', 'vlan-config'],
        ['vlan*',                        null, 'vlan-config', 'vlan-config'],
        ['usage-types*',                 null, 'usage-type', 'usage-type'],
        ['payment-methods*',             null, 'payment-method', 'payment-method'],
        // The bare list is read without credentials by both clients' Assign
        // Work Order dropdown (a plain fetch), and the controller scopes it by
        // caller: signed out it returns the shared categories, signed in only
        // the caller's organisation's. Keeping it anonymous keeps that dropdown
        // exactly as it was once the gate enforces; the writes keep their keys.
        ['work-categories',              self::PUBLIC_ACCESS, 'work-category', 'work-category'],
        ['work-categories*',             null, 'work-category', 'work-category'],
        ['router-models*',               null, 'router-models', 'router-models'],
        ['status-remarks*',              null, 'status-remarks-list', 'status-remarks-list'],
        ['concerns*',                    null, 'concern-config', 'concern-config'],
        ['sms-templates*',               null, 'sms-template', 'sms-template'],
        ['email-templates*',             null, 'email-templates', 'email-templates'],
        ['billing-statuses*',            null, 'billing-config', 'billing-config'],
        ['custom-account-number*',       null, ['customer.details-edit', 'user-management']],
        ['settings-color-palette*',      null, 'settings'],
        ['settings-image-size*',         null, 'settings'],
        // The same rows as settings-image-size above, under the second path the
        // upload forms actually call. This is the compression ratio the browser
        // applies to a photo before posting it, so it is read by every
        // attachment form in the app — job order, service order, customer,
        // application, inventory, transaction, LCP/NAP — and by the mobile app.
        // Reading it is not an act of configuration; writing it is, and
        // settings-image-size owns that side.
        ['settings/image-size',          null, 'settings'],
        ['settings/*',                   'settings', 'settings'],
        ['system-config/*',              null, 'settings'],
        ['app-version/*',                null, 'settings'],
        ['form-ui/*',                    null, 'settings'],
        ['lookup/*',                     null, null],
        ['google-drive/upload',          null, null],
        ['notifications/*',              null, null],
        ['job-order-notifications*',     null, null],
        ['audit-trail-logs/*',           null, null],
        ['plan-change-logs/*',           null, null],
        ['details-update-logs/*',        null, null],
        ['change-due-logs/*',            null, null],
        ['security-deposits/*',          null, null],

        // ── People ───────────────────────────────────────────────────────────
        // The account list is read wherever a record has to be assigned to
        // somebody — a job order to a technician, a work order to a crew — so
        // the read side names those pages rather than being open to anyone
        // signed in. A customer signing in to pay a bill has no reason to
        // enumerate staff accounts.
        //
        // roles/* stays open to any signed-in user because the client fetches
        // its own role at sign-in to learn what its menu should contain.
        // 'inventory' is here because an inventory log records who took an item
        // out and who brought it back, so the log form has to offer the account
        // list — the same reason a job order has to offer technicians.
        // Written from User Management, Tech Users and Agent Management, which
        // all post to the same collection; each page's own verb is enough.
        ['users*', [
            'user-management', 'tech-users', 'agent-management', 'team-agent',
            'job-order', 'service-order', 'work-order', 'application-management',
            'inventory', 'commission', 'bonus-history', 'agent-payout', 'agent-invoices',
        ], ['user-management', 'tech-users', 'agent-management'], [
            'POST'   => ['user-management.create', 'tech-users.create', 'agent-management'],
            'PUT'    => ['user-management.edit', 'tech-users.edit', 'agent-management'],
            'PATCH'  => ['user-management.edit', 'tech-users.edit', 'agent-management'],
            'DELETE' => ['user-management.delete', 'tech-users.delete', 'agent-management'],
        ]],
        ['technicians*', [
            'tech-users', 'user-management',
            'job-order', 'service-order', 'work-order', 'application-management',
        ], 'tech-users', 'tech-users'],
        ['agents*', [
            'agent-management', 'team-agent', 'bonus-history', 'agent-payout', 'commission',
            'agent-invoices', 'agent-dashboard', 'agent-application',
            'job-order', 'work-order', 'application-management',
        ], ['agent-management', 'team-agent']],
        ['roles*',                       null, 'roles', 'roles'],
        ['groups*',                      null, ['group-management', 'user-management'], 'group-management'],
        ['organizations*',               null, 'organization', 'organization'],
        ['email-queue/send-credentials/*', 'user-management', 'user-management'],

        // ── Applications ─────────────────────────────────────────────────────
        // An agent submits an application from the portal's own form, so the
        // write side accepts the agent key as well as the admin page key.
        // Signed in is enough. The controller matches on the caller and answers
        // with a single number about them, so there is nothing here to gate by
        // page: an account that cannot see the applications list still knows how
        // many of the rows are its own. Gating it on 'agent-application' meant an
        // agent on a custom role that had not been ticked for that page was
        // refused their own total.
        ['applications/my-count',        null, null],
        // One application, as opposed to the list of them. A job order *is* an
        // application that was scheduled, and both the job order pane and the
        // technician's Done form read the original submission back, so the read
        // side names those pages too — and the LCP/NAP map, whose pins open the
        // same ApplicationDetails / CustomerDetails panes (OVERLAY_READERS).
        //
        // The Job Order Done forms (technician and administrator) write the
        // application behind the order back, so their keys are on the write
        // side of the single-record rule too. Uploading from the LCP/NAP pane
        // is NOT on it: see the audit notes (a write reached only through an
        // overlay is not widened here).
        ['applications/*',               ['job-order', 'agent-application', ...self::OVERLAY_READERS], ['application-management', 'agent-application', 'job-order.tech-edit', 'job-order.admin-edit']],
        // The collection itself. ApplicationDetails, opened from a job order,
        // a service order or the LCP/NAP map, looks the record up through the
        // list endpoint (applicationService), so those pages read it too.
        // Writing (a new application) stays the Application page's and the
        // agent form's.
        ['applications',                 ['agent-application', ...self::OVERLAY_READERS], ['application-management', 'agent-application']],
        ['applications*',                ['application-management', 'agent-application'], ['application-management', 'agent-application']],
        ['application-visits*',          'application-management', 'application-management'],

        // ── Job orders ───────────────────────────────────────────────────────
        ['job-orders/*/approve',         'job-order.approve', 'job-order.approve'],
        ['job-orders/*/create-radius-account', ['job-order.approve', 'radius-config'], ['job-order.approve', 'radius-config']],
        ['job-orders/*/upload-images',   'job-order.attachment', 'job-order.attachment'],
        ['job-orders/by-account/*',      null, 'job-order'],
        ['job-orders/by-item/*',         null, 'job-order'],
        ['job-orders/lookup/*',          'job-order', 'job-order'],
        ['job-orders/validate-sn',       'job-order', 'job-order'],
        // One job order (GET job-orders/{id}), read by the overlays in
        // OVERLAY_READERS — PlanListDetails on the LCP/NAP map, for one. Every
        // other GET under job-orders/ has its own rule above, so this widens
        // the single-record read and nothing else. The write side is the
        // collection's, unchanged.
        ['job-orders/*',                 ['job-order', ...self::OVERLAY_READERS], ['job-order.tech-edit', 'job-order.admin-edit', 'application-management.move-to-jo']],
        ['job-orders*',                  'job-order', ['job-order.tech-edit', 'job-order.admin-edit', 'application-management.move-to-jo']],
        ['job-order-items*',             'job-order', ['job-order.tech-edit', 'job-order.admin-edit']],

        // ── Service orders ───────────────────────────────────────────────────
        // Both spellings of the prefix are registered in routes/api.php.
        ['service-orders/by-account/*',  null, 'service-order'],
        ['service-orders/by-item/*',     null, 'service-order'],
        // The customer portal's Support page: a customer lists their tickets
        // and files a new one. NOTE (GOWISER): ServiceOrderApiController does
        // NOT pin a customer to their own account_no — a customer carries no
        // organization, so its org filter does not scope them either. This
        // table only decides who may call the endpoint; row scoping for the
        // portal is a separate, pre-existing gap (it was fully open before).
        //
        // These sit on the bare collection path deliberately. The wildcard rules
        // beneath cover service-orders/{id}, so reading someone else's ticket,
        // editing one and deleting one all stay closed to 'customer-support'.
        ['service-orders',               ['service-order', 'customer-support'], ['service-order.tech-edit', 'service-order.admin-edit', 'customer.so-request', 'customer-support']],
        ['service_orders',               ['service-order', 'customer-support'], ['service-order.tech-edit', 'service-order.admin-edit', 'customer.so-request', 'customer-support']],
        // One service order (GET service-orders/{id}), read by the overlays in
        // OVERLAY_READERS (CustomerDetails' related-records tabs). by-account and
        // by-item have their own rules above; the write side is unchanged.
        ['service-orders/*',             self::OVERLAY_READERS, ['service-order.tech-edit', 'service-order.admin-edit', 'customer.so-request']],
        ['service-orders*',              'service-order', ['service-order.tech-edit', 'service-order.admin-edit', 'customer.so-request']],
        ['service_orders*',              'service-order', ['service-order.tech-edit', 'service-order.admin-edit', 'customer.so-request']],
        ['service-order-items*',         'service-order', ['service-order.tech-edit', 'service-order.admin-edit']],
        ['service_order_items*',         'service-order', ['service-order.tech-edit', 'service-order.admin-edit']],

        // ── Work orders ──────────────────────────────────────────────────────
        // Anyone who holds the page reads and works (edits, uploads to) the
        // orders in front of them — Edit was never gated on either client.
        // Raising one (Add Work Order) and deleting one is work-order.manage.
        ['work-orders',                  'work-order', 'work-order.manage'],
        ['work-orders*',                 'work-order', 'work-order', ['DELETE' => 'work-order.manage']],

        // ── Customers and their billing ──────────────────────────────────────
        // The customer portal reads the same records for the account it belongs
        // to, so the customer keys sit alongside the admin ones. NOTE
        // (GOWISER): there is no CustomerScope here — the account_no a portal
        // caller sends is not checked against their own account by these
        // controllers. That predates this table (the routes were open to
        // anyone); the keys below narrow who can call, not which rows.
        // The subscriber list and the detail pane behind it. Named page by page
        // rather than left open to any signed-in user: a technician's work is
        // the job order in front of them, not the subscriber book, and an agent
        // sees their own referrals through the Job Order page instead.
        ['customers/*/upload-images',    'customer.attachment', 'customer.attachment'],
        // Staff only. The customer portal never reads this collection — it reads
        // its own record through customer-detail/{accountNo} — so listing the
        // portal's keys here would have handed a signed-in subscriber the whole
        // subscriber book.
        ['customers*', [
            'customer', 'customer.details-edit',
            'application-management', 'transaction-list', 'payment-portal',
            'soa', 'invoice', 'overdue', 'dc-notice', 'so-charge',
            'mass-rebate', 'discounts', 'staggered-payment',
        ], ['customer.details-edit', 'application-management']],
        // Also opened from the job order, service order, application and LCP/NAP
        // panes (OVERLAY_READERS), which are the technicians' screens.
        ['customer-detail/*', [
            'customer', 'customer-dashboard', 'customer-bills', 'customer.details-edit',
            'transaction-list',
            'payment-portal', 'soa', 'invoice', 'overdue', 'dc-notice',
            'so-charge', 'mass-rebate', 'discounts', 'staggered-payment',
            ...self::OVERLAY_READERS,
        // Editing is the Customer page's own key alone. Job Order's admin-edit
        // is a different job: holding it should not carry the right to rewrite
        // a subscriber's record.
        ], 'customer.details-edit'],
        // The Billing Reconcile tool — first in this block because the `billing*`
        // rule at the end of it would otherwise claim it. Its three sibling
        // tools live in the reconciliation section further down; this one is
        // separated only by that prefix collision.
        ['billing-reconciliation/*',     'billing-reconcile-tool', 'billing-reconcile-tool'],
        ['billing-generation/invoices',  ['invoice', 'soa', 'customer', 'customer-bills', 'customer-dashboard'], 'billing-config'],
        ['billing-generation/statements', ['invoice', 'soa', 'customer', 'customer-bills', 'customer-dashboard'], 'billing-config'],
        ['billing-generation/*',         ['customer', 'billing-config'], ['customer', 'billing-config']],
        ['billing-notifications/*',      ['customer', 'billing-config'], ['customer', 'billing-config']],
        ['billing-config*',              'billing-config', 'billing-config', 'billing-config'],
        ['billing-details*',             ['customer', 'customer-bills', 'customer-dashboard'], 'customer.details-edit'],
        ['billing_details*',             ['customer', 'customer-bills', 'customer-dashboard'], 'customer.details-edit'],
        // One account's billing record, read from the service order edit form to
        // show the balance the order is being raised against, and by the
        // overlays in OVERLAY_READERS (LcpNapLocationDetails, PlanListDetails).
        //
        // The two helpers are listed first, unchanged, so that widening applies
        // to billing/{accountNo} alone: `*` spans slashes, and a technician has
        // no reason to page the active-account list through them.
        //
        // The bare collection (GET billing) is read by TransactionListDetails,
        // which the overlays open, so it carries OVERLAY_READERS as well — the
        // same reach those roles had before this table existed.
        ['billing',                      ['customer', 'soa', 'invoice', 'overdue', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], ['customer.transact', 'billing-config']],
        ['billing/accounts/*',           ['customer', 'soa', 'invoice', 'overdue', 'customer-bills', 'customer-dashboard'], ['customer.transact', 'billing-config']],
        ['billing/check-updates',        ['customer', 'soa', 'invoice', 'overdue', 'customer-bills', 'customer-dashboard'], ['customer.transact', 'billing-config']],
        ['billing/*',                    ['customer', 'soa', 'invoice', 'overdue', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], ['customer.transact', 'billing-config']],
        ['billing*',                     ['customer', 'soa', 'invoice', 'overdue', 'customer-bills', 'customer-dashboard'], ['customer.transact', 'billing-config']],
        ['cron-test/*',                  ['customer', 'settings'], ['customer', 'settings']],

        ['transactions/batch-approve',   'transaction-list.batch-approve', 'transaction-list.batch-approve'],
        ['transactions/*/approve',       'transaction-list.approve', 'transaction-list.approve'],
        ['transactions/*/revert',        'transaction-list.revert-request', 'transaction-list.revert-request'],
        // Mark as Failed is an ungated button on the transaction pane.
        ['transactions/*/status',        'transaction-list', ['transaction-list.approve', 'transaction-list']],
        ['transactions/upload-images',   'customer.transact', 'customer.transact'],
        ['transactions/by-account/*',    ['transaction-list', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], 'customer.transact'],
        // Kept exactly as it was: no overlay reads it, so OVERLAY_READERS below
        // does not reach it.
        ['transactions/*/details',       ['transaction-list', 'customer'], ['customer.transact', 'transaction-list'], ['DELETE' => 'transaction-list.delete']],
        // Staff only, for the same reason as the subscriber collection: the
        // portal reads transactions/by-account/{accountNo}, which is the rule
        // directly above and does carry the portal's keys. One transaction and
        // its receipt are also read by the overlays (TransactionListDetails).
        // Edit Transaction is ungated on the pane; deleting one is SuperAdmin's.
        ['transactions/*',               ['transaction-list', 'customer', ...self::OVERLAY_READERS], ['customer.transact', 'transaction-list'], ['DELETE' => 'transaction-list.delete']],
        ['transactions*',                ['transaction-list', 'customer'], 'customer.transact'],
        ['transaction-reverts/*/status', 'transactions-revert', 'transactions-revert.approve'],
        ['transaction-reverts*',         'transactions-revert', ['transactions-revert', 'transaction-list.revert-request']],

        // Prepaid Override: raised from the customer pane, decided on the
        // Prepaid Override page (SuperAdmin alone today).
        ['prepaid-overrides/*/status',   ['prepaid-override', 'customer.prepaid-override'], 'prepaid-override.approve'],
        ['prepaid-overrides*',           ['prepaid-override', 'customer.prepaid-override', 'customer'], ['customer.prepaid-override', 'prepaid-override.approve']],

        // The mobile customer Bills screen renders its statement PDF through
        // this path (the web app uses soa/{id}/generate-pdf below), so the
        // portal's keys are on its write side. Only renders a PDF.
        ['statement-of-accounts/*/generate-pdf', ['soa', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], ['soa', 'customer-bills', 'customer-dashboard']],
        ['statement-of-accounts*',       ['soa', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], 'soa'],
        ['soa-records',                  ['soa', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], ['soa', 'soa-generation.manage']],
        // soa/{id}/generate-pdf is the only route here, and it is a POST that a
        // customer makes for their own statement from the portal's Bills page —
        // so the portal's keys are on the write side, not just the read one.
        // SOADetails, opened from the overlays, renders the same PDF. It only
        // renders; nothing is written.
        // (No per-account check on this route in GOWISER; see the note at the
        // top of this block.)
        ['soa/*/generate-pdf',           ['soa', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], ['soa', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS]],
        ['soa/*',                        ['soa', 'customer', 'customer-bills', 'customer-dashboard'], ['soa', 'customer-bills', 'customer-dashboard']],
        ['invoice-records',              ['invoice', 'customer', 'customer-bills', 'customer-dashboard'], 'invoice'],
        // invoices/by-account/{accountNo} and invoices/{id} — both read by the
        // overlays' CustomerDetails / InvoiceDetails panes.
        ['invoices/*',                   ['invoice', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], 'invoice'],
        ['overdues*',                    ['overdue', 'customer', 'customer-bills', 'customer-dashboard'], 'overdue'],
        ['dc-notices*',                  'dc-notice', 'dc-notice'],
        // The customer portal's Dashboard and Bills pages both read the signed-in
        // customer's own charges, filtered by the account_no they send (a filter,
        // not a boundary — see the note at the top of this block).
        ['service-charges*',             ['so-charge', 'customer', 'customer-dashboard', 'customer-bills'], 'so-charge'],
        // CustomerDetails' related-records tabs, one account at a time. The
        // overlays (OVERLAY_READERS) open CustomerDetails, so they read these;
        // the rest of each family keeps its own page.
        ['service-charge-logs/by-account/*', ['so-charge', 'customer', ...self::OVERLAY_READERS], 'so-charge'],
        ['service-charge-logs/*',        ['so-charge', 'customer'], 'so-charge'],
        ['discounts/by-account/*',       ['discounts', ...self::OVERLAY_READERS], 'discounts.add'],
        ['discounts*',                   'discounts', 'discounts.add'],
        ['mass-rebates*',                'mass-rebate', 'mass-rebate.add'],
        ['rebates*',                     ['mass-rebate', 'customer'], 'mass-rebate.add'],
        ['staggered-installations/by-account/*', ['staggered-payment', ...self::OVERLAY_READERS], 'staggered-payment.add'],
        ['staggered-installations*',     'staggered-payment', 'staggered-payment.add'],
        ['installment-schedules*',       ['staggered-payment', 'customer', 'customer-bills'], 'staggered-payment.add'],
        ['installments*',                ['staggered-payment', 'customer', 'customer-bills'], 'staggered-payment.add'],
        ['advanced-payments*',           ['customer', 'payment-portal', 'customer-bills', 'customer-dashboard'], ['customer.transact', 'payment-portal']],
        // Every read here is a pane CustomerDetails / PaymentPortalDetails opens.
        ['payment-portal-logs*',         ['payment-portal', 'customer', 'customer-bills', 'customer-dashboard', ...self::OVERLAY_READERS], 'payment-portal'],
        // A customer pays their own bill from the portal; an administrator
        // takes a payment from the Payment Portal page. Both are signed in.
        ['payments/*',                   null, null],

        // ── Network operations ───────────────────────────────────────────────
        ['smart-olt/validate-sn',        null, null],
        ['smart-olt*',                   ['smart-olt', 'job-order'], ['smart-olt', 'job-order.admin-edit', 'job-order.approve']],
        // ── Reconciliation tools ─────────────────────────────────────────────
        // Each of these compares what the system believes against what a
        // downstream actually holds, and writes the difference back: RADIUS
        // accounts and passwords, SmartOLT ONU profiles, settled Xendit
        // payments, the billing run's coverage. They arrived after this table
        // was written, matched no rule, and so fell through to
        // DEFAULT_REQUIREMENT — any signed-in user, a customer included, could
        // POST radius-reconciliation/delete-user.
        //
        // Listed above radius-config* and before the billing* family so the
        // prefixes there do not swallow them.
        ['radius-reconciliation/*',      'mikrotik-radius-tool', 'mikrotik-radius-tool'],
        ['smartolt-reconciliation/*',    'smartolt-tool', 'smartolt-tool'],
        ['xendit-reconciliation/*',      'xendit-reconcile-tool', 'xendit-reconcile-tool'],
        // Billing Reconcile is not here with its three siblings: `billing*`,
        // further up in the billing section, would match it first. It is listed
        // there instead, at the top of that block.

        ['radius-config*',               'radius-config', 'radius-config', 'radius-config'],
        ['radius/*',                     ['radius-config', 'job-order', 'customer'], ['radius-config', 'customer.details-edit', 'job-order.admin-edit', 'job-order.approve']],
        // The technician's Done form reads the username and password patterns to
        // build the PPPoE credentials it is about to save, so the read side names
        // Job Order alongside the page that defines them. Defining a pattern is
        // still PPPoE Setup's alone, as are the two maintenance endpoints that
        // fall through to the rule below.
        ['pppoe/patterns*',              ['pppoe-setup', 'job-order'], 'pppoe-setup', 'pppoe-setup'],
        ['pppoe/*',                      'pppoe-setup', 'pppoe-setup'],

        // ── Inventory ────────────────────────────────────────────────────────
        // Items are read from the job/service/work order forms that consume
        // them; only the Inventory pages may change stock.
        // The category list is lookup data: the job, service and work order
        // forms fill their item pickers from it (and the mobile app loads it
        // for every role at start-up). Reading it is signed-in only; changing
        // it is still the category page's.
        ['inventory-categories',         null, 'inventory-category-list'],
        ['inventory-categories*',        ['inventory', 'inventory-category-list'], 'inventory-category-list'],
        // One item's movement history, shown by InventoryDetails, which the
        // overlays (OVERLAY_READERS) open from the items on an order. Logging a
        // movement (POST inventory-logs) stays the Inventory page's.
        ['inventory-logs/by-item/*',     ['inventory', ...self::OVERLAY_READERS], 'inventory'],
        ['inventory-logs*',              'inventory', 'inventory'],
        ['inventory-items*',             ['inventory', 'job-order', 'service-order', 'work-order'], 'inventory'],
        ['inventory*',                   ['inventory', 'job-order', 'service-order', 'work-order'], 'inventory'],
        ['borrowed-logs/*',              'inventory', 'inventory'],
        ['defective-logs/by-item/*',     ['inventory', ...self::OVERLAY_READERS], 'inventory'],
        ['defective-logs/*',             'inventory', 'inventory'],

        // ── Agents ───────────────────────────────────────────────────────────
        // An agent reads their own history and invoices; issuing and settling
        // them is an administrator's job.
        ['agent-invoices/generate',      'agent-invoices.generate', 'agent-invoices.generate'],
        ['agent-invoices/*/status',      'agent-invoices.status', 'agent-invoices.status'],
        ['agent-invoices*',              'agent-invoices', 'agent-invoices.generate'],
        // Approving or rejecting: a payout on agent-payout.approve, a bonus on
        // bonus-history.payout. CommissionController checks the same keys
        // itself (App\Support\AgentAccess), in every rollout mode.
        ['commissions/bonus-history/*/approve', 'bonus-history.payout', 'bonus-history.payout'],
        ['commissions/bonus-history/*/reject',  'bonus-history.payout', 'bonus-history.payout'],
        ['commissions/history/*/approve', 'agent-payout.approve', 'agent-payout.approve'],
        ['commissions/history/*/reject', 'agent-payout.approve', 'agent-payout.approve'],
        // Claiming an achievement is the agent's own act, so the page key is
        // enough: storeAchievement() discards any agent_id a non-admin sends
        // and credits the caller.
        ['commissions/achievements',     ['bonus-history', 'agent-dashboard', 'commission'], ['bonus-history', 'agent-dashboard', 'commission']],
        // Adding a bonus: Bonus History's button, or Pay Out/In's Add Record.
        ['commissions/bonus-history',    ['bonus-history', 'commission', 'agent-payout'], ['bonus-history.payout', 'commission.create']],
        // Raising a payout: Pay Out/In, Agent Payout, Team Agents' Record
        // Payout, or an agent invoice's Pay Out.
        ['commissions/history',          ['bonus-history', 'commission', 'agent-payout', 'team-agent', 'agent-invoices'], ['agent-payout', 'commission.create', 'agent-invoices.payout']],
        // Reading is scoped by the controller — a non-admin reads their own.
        ['commissions*',                 ['bonus-history', 'commission', 'agent-payout', 'team-agent', 'agent-dashboard', 'agent-invoices'], ['commission.create', 'bonus-history.payout']],

        // ── Messaging ────────────────────────────────────────────────────────
        ['sms-blast*',                   'sms-blast', 'sms-blast'],
        ['sms/blast',                    'sms-blast', 'sms-blast'],
        ['sms/logs',                     'sms-logs', 'sms-logs'],
        ['sms/send',                     'sms-blast', 'sms-blast'],
        ['sms/test',                     'sms-config', 'sms-config'],
        ['sms-config*',                  'sms-config', 'sms-config', 'sms-config'],
        ['email-queue*',                 'email-logs', 'email-logs'],

        // ── Reports and logs ─────────────────────────────────────────────────
        ['reports/settings',             'reports', 'reports.manage'],
        ['reports*',                     'reports', 'reports.manage', ['DELETE' => 'reports.delete']],
        ['data-logs',                    'data-logs', 'data-logs'],
        // One account's history, shown on CustomerDetails, which the overlays
        // (OVERLAY_READERS) open. The log pages themselves keep their own key.
        ['disconnected-logs/by-account/*', ['disconnected-logs', ...self::OVERLAY_READERS], 'disconnected-logs'],
        ['disconnected-logs*',           'disconnected-logs', 'disconnected-logs'],
        ['disconnection-logs',           'disconnected-logs', 'disconnected-logs'],
        ['reconnection-logs/by-account/*', ['reconnection-logs', ...self::OVERLAY_READERS], 'reconnection-logs'],
        ['reconnection-logs*',           'reconnection-logs', 'reconnection-logs'],
        // ── Expenses ─────────────────────────────────────────────────────────
        // One API behind the web Expenses page and the Expenses log (web and
        // mobile). POST /{id} is the multipart update (_method=PUT arrives as
        // PUT; a bare POST to an id is still an edit).
        ['expenses-logs',                ['expenses', 'expenses-log'], 'expenses', 'expenses'],
        ['expenses-logs/*',              ['expenses', 'expenses-log'], 'expenses', [
            'POST' => 'expenses.edit', 'PUT' => 'expenses.edit', 'PATCH' => 'expenses.edit', 'DELETE' => 'expenses.delete',
        ]],
        // Categories are read by every expense and payable form.
        ['expenses-categories*',         null, 'expenses-category', 'expenses-category'],
        ['monthly-payables/generate',    'monthly-payables', 'monthly-payables.generate'],
        ['monthly-payables/*/payments*', 'monthly-payables', 'monthly-payables.pay'],
        ['monthly-payables/*',           'monthly-payables', 'monthly-payables', [
            'POST' => 'monthly-payables.edit', 'PUT' => 'monthly-payables.edit', 'PATCH' => 'monthly-payables.edit', 'DELETE' => 'monthly-payables.delete',
        ]],
        ['monthly-payables',             'monthly-payables', 'monthly-payables', 'monthly-payables'],
        ['file-logs/*',                  ['smart-olt-logs', 'radius-logs', 'system-logs'], 'system-logs'],
        ['logs*',                        'system-logs', 'system-logs'],
    ];

    /**
     * The requirement for a request.
     *
     * @return string|string[]|null  PUBLIC_ACCESS, a key, a list of keys, or
     *                               null for "any signed-in user".
     */
    public static function requirementFor(string $method, string $path): string|array|null
    {
        $path = self::normalize($path);
        $method = strtoupper($method);
        $isRead = in_array($method, ['GET', 'HEAD', 'OPTIONS'], true);

        foreach (self::RULES as $rule) {
            [$pattern, $read, $write] = $rule;

            if (!Str::is($pattern, $path)) {
                continue;
            }

            // A per-method override outranks both, so DELETE can be stricter
            // than the PUT beside it.
            $perMethod = $rule[3] ?? [];

            // A page name rather than a map: the page's standard verbs.
            if (is_string($perMethod)) {
                $perMethod = self::crudRequirements($perMethod);
            }

            if (array_key_exists($method, $perMethod)) {
                return $perMethod[$method];
            }

            return $isRead ? $read : $write;
        }

        return self::DEFAULT_REQUIREMENT;
    }

    /**
     * The standard verbs of a page, as a per-method requirement map.
     *
     * PATCH is treated as PUT: both are how a list page saves an edit, and no
     * page in the system means something different by the two.
     *
     * @return array<string, string>
     */
    private static function crudRequirements(string $page): array
    {
        return [
            'POST'   => "$page.create",
            'PUT'    => "$page.edit",
            'PATCH'  => "$page.edit",
            'DELETE' => "$page.delete",
        ];
    }

    /** Is there an explicit rule for this path, or did it fall through? */
    public static function hasRule(string $path): bool
    {
        $path = self::normalize($path);

        foreach (self::RULES as $rule) {
            if (Str::is($rule[0], $path)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Strip the `api/` prefix and any surrounding slashes.
     *
     * Route parameters are left as they are — `Str::is` treats `{id}` as
     * literal text, and every rule that needs to match past a parameter uses a
     * `*` at that position.
     */
    private static function normalize(string $path): string
    {
        $path = trim($path, '/');

        if (str_starts_with($path, 'api/')) {
            $path = substr($path, 4);
        }

        return $path === '' ? '/' : $path;
    }
}
