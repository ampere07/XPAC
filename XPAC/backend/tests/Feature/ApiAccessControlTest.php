<?php

namespace Tests\Feature;

use App\Http\Middleware\ApiAccessControl;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

/**
 * The middleware itself, in each of its three rollout modes.
 *
 * ApiPermissionCoverageTest checks the table; this checks that the table is
 * actually consulted — refused before a controller in `enforce`, only logged in
 * `log`, ignored in `off`. Only refusals and anonymous reads go over real HTTP,
 * because those stop short of the database; everything else drives the
 * middleware directly with a closure standing in for the rest of the stack.
 */
class ApiAccessControlTest extends TestCase
{
    private function setMode(string $mode): void
    {
        config(['permissions.api_access_control' => $mode]);
    }

    /** An in-memory user of the given role. Never saved; nothing here needs it. */
    private function makeUser(int $roleId): User
    {
        $user = new User();
        $user->id = 1;
        $user->role_id = $roleId;
        $user->setRelation('role', null);

        return $user;
    }

    private function actingAsRole(int $roleId, string $guard = 'sanctum'): self
    {
        $this->actingAs($this->makeUser($roleId), $guard);

        return $this;
    }

    /** Run the middleware on a request; report whether $next was reached. */
    private function runGate(string $method, string $uri): array
    {
        $reached = false;

        $response = (new ApiAccessControl())->handle(
            Request::create($uri, $method),
            function () use (&$reached) {
                $reached = true;
                return new JsonResponse(['ok' => true]);
            }
        );

        return [$reached, $response->getStatusCode()];
    }

    // ── Wiring and mode ──────────────────────────────────────────────────────

    public function test_the_gate_is_in_the_api_middleware_group(): void
    {
        $groups = $this->app->make(\Illuminate\Contracts\Http\Kernel::class)->getMiddlewareGroups();

        $this->assertContains(ApiAccessControl::class, $groups['api']);
    }

    public function test_the_default_mode_is_log(): void
    {
        $this->assertSame('log', config('permissions.api_access_control'));
        $this->assertSame(ApiAccessControl::MODE_LOG, ApiAccessControl::mode());

        // Anything unrecognised is read as the safe default, not as enforce.
        $this->setMode('bogus');
        $this->assertSame(ApiAccessControl::MODE_LOG, ApiAccessControl::mode());
        $this->setMode(' ENFORCE ');
        $this->assertSame(ApiAccessControl::MODE_ENFORCE, ApiAccessControl::mode());
    }

    // ── enforce ──────────────────────────────────────────────────────────────

    /**
     * @dataProvider protectedEndpoints
     *
     * Only the status is asserted: a route that carries its own `auth:sanctum`
     * answers with Laravel's stock body, one relying on the gate with its own.
     */
    public function test_enforce_refuses_anonymous_requests(string $method, string $uri): void
    {
        $this->setMode('enforce');

        $this->json($method, $uri)->assertStatus(401);
    }

    public static function protectedEndpoints(): array
    {
        return [
            'customer list'      => ['GET', '/api/customers'],
            'transactions'       => ['GET', '/api/transactions'],
            'job orders'         => ['GET', '/api/job-orders'],
            'work orders'        => ['GET', '/api/work-orders'],
            'users'              => ['GET', '/api/users'],
            'system logs'        => ['GET', '/api/logs'],
            'delete a plan'      => ['DELETE', '/api/plans/1'],
            'create a user'      => ['POST', '/api/users'],
            'approve a payment'  => ['POST', '/api/transactions/1/approve'],
            'debug users table'  => ['GET', '/api/debug/users-table'],
            'password reset aid' => ['POST', '/api/fix-customer-password'],
            'expenses'           => ['GET', '/api/expenses-logs'],
            'prepaid overrides'  => ['GET', '/api/prepaid-overrides'],
            'monthly payables'   => ['GET', '/api/monthly-payables'],
        ];
    }

    /** The endpoints the sign-in screen needs before anyone has signed in. */
    public function test_enforce_answers_public_endpoints_without_credentials(): void
    {
        $this->setMode('enforce');

        $this->getJson('/api/health')->assertStatus(200);
        $this->getJson('/api/auth/session')->assertStatus(200)->assertJson(['authenticated' => false]);
    }

    public function test_enforce_refuses_a_technician_billing_endpoints(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::TECHNICIAN);

        $this->getJson('/api/transactions')->assertStatus(403);
        $this->postJson('/api/users', [])->assertStatus(403);
        $this->getJson('/api/logs')->assertStatus(403);
        $this->getJson('/api/monthly-payables')->assertStatus(403);
    }

    public function test_enforce_refuses_an_agent_administrative_endpoints(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::AGENT);

        $this->getJson('/api/service-orders')->assertStatus(403);
        $this->getJson('/api/transactions')->assertStatus(403);
        $this->postJson('/api/agent-invoices/generate', [])->assertStatus(403);
        $this->postJson('/api/work-orders', [])->assertStatus(403);
        $this->postJson('/api/commissions/history/1/approve', [])->assertStatus(403);
    }

    public function test_enforce_refuses_a_customer_staff_endpoints(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::CUSTOMER);

        $this->getJson('/api/job-orders')->assertStatus(403);
        $this->getJson('/api/users')->assertStatus(403);
        $this->getJson('/api/dashboard/counts')->assertStatus(403);
        $this->getJson('/api/commissions')->assertStatus(403);
    }

    /** The SuperAdmin-only buttons stay SuperAdmin's. */
    public function test_enforce_refuses_an_administrator_superadmin_endpoints(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::ADMINISTRATOR);

        $this->postJson('/api/vlans', [])->assertStatus(403);
        $this->deleteJson('/api/transactions/1')->assertStatus(403);
        $this->putJson('/api/transaction-reverts/1/status', [])->assertStatus(403);
        $this->putJson('/api/prepaid-overrides/1/status', [])->assertStatus(403);
    }

    /**
     * The other half: a permitted request is let through.
     *
     * @dataProvider permittedRequests
     */
    public function test_enforce_lets_permitted_requests_through(int $roleId, string $method, string $uri): void
    {
        $this->setMode('enforce');
        $this->actingAsRole($roleId);

        [$reached, $status] = $this->runGate($method, $uri);

        $this->assertTrue($reached, "role $roleId was refused $method $uri, which it should be allowed");
        $this->assertSame(200, $status);
    }

    public static function permittedRequests(): array
    {
        return [
            'technician: job orders'      => [Role::TECHNICIAN, 'GET', '/api/job-orders'],
            'technician: edits one'       => [Role::TECHNICIAN, 'PUT', '/api/job-orders/5'],
            'technician: its application' => [Role::TECHNICIAN, 'PUT', '/api/applications/5'],
            'technician: service orders'  => [Role::TECHNICIAN, 'GET', '/api/service-orders'],
            'technician: works a WO'      => [Role::TECHNICIAN, 'PUT', '/api/work-orders/3'],
            'technician: fibre map'       => [Role::TECHNICIAN, 'GET', '/api/lcpnap'],
            'technician: reference data'  => [Role::TECHNICIAN, 'GET', '/api/plans'],
            'technician: posts location'  => [Role::TECHNICIAN, 'POST', '/api/technician-location'],
            'agent: commissions'          => [Role::AGENT, 'GET', '/api/commissions'],
            'agent: their invoices'       => [Role::AGENT, 'GET', '/api/agent-invoices'],
            'agent: work orders'          => [Role::AGENT, 'GET', '/api/work-orders'],
            'agent: edits a work order'   => [Role::AGENT, 'PUT', '/api/work-orders/3'],
            'agent: submits application'  => [Role::AGENT, 'POST', '/api/applications'],
            'osp: raises a work order'    => [Role::OSP, 'POST', '/api/work-orders'],
            'inventory staff: adds stock' => [Role::INVENTORY_STAFF, 'POST', '/api/inventory'],
            'administrator: customers'    => [Role::ADMINISTRATOR, 'GET', '/api/customers'],
            'administrator: batch approve' => [Role::ADMINISTRATOR, 'POST', '/api/transactions/batch-approve'],
            'administrator: dashboard'    => [Role::ADMINISTRATOR, 'GET', '/api/dashboard/counts'],
            'administrator: payables'     => [Role::ADMINISTRATOR, 'POST', '/api/monthly-payables/generate'],
            'administrator: expense'      => [Role::ADMINISTRATOR, 'POST', '/api/expenses-logs'],
            'administrator: a plan'       => [Role::ADMINISTRATOR, 'POST', '/api/plans'],
            'head tech: applications'     => [Role::HEAD_TECH, 'GET', '/api/applications'],
            'head tech: customer pane'    => [Role::HEAD_TECH, 'PUT', '/api/customer-detail/ACC-1'],
            'super admin: system logs'    => [Role::SUPER_ADMIN, 'GET', '/api/logs'],
            'super admin: diagnostics'    => [Role::SUPER_ADMIN, 'GET', '/api/debug/users-table'],
            'super admin: approves prepaid' => [Role::SUPER_ADMIN, 'PUT', '/api/prepaid-overrides/1/status'],
            'customer: their statements'  => [Role::CUSTOMER, 'GET', '/api/statement-of-accounts/12'],
            'customer: pays a bill'       => [Role::CUSTOMER, 'POST', '/api/payments/create'],
        ];
    }

    public function test_enforce_makes_the_resolved_user_the_request_user(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::TECHNICIAN);

        $seen = null;
        (new ApiAccessControl())->handle(
            $request = Request::create('/api/job-orders', 'GET'),
            function (Request $r) use (&$seen) {
                $seen = $r->user();
                return new JsonResponse([]);
            }
        );

        $this->assertNotNull($seen);
        $this->assertSame(Role::TECHNICIAN, (int) $seen->role_id);
    }

    // ── log ──────────────────────────────────────────────────────────────────

    public function test_log_mode_lets_an_anonymous_request_through_and_logs_it(): void
    {
        $this->setMode('log');
        Log::spy();

        [$reached, $status] = $this->runGate('GET', '/api/customers');

        $this->assertTrue($reached);
        $this->assertSame(200, $status);
        Log::shouldHaveReceived('warning')
            ->with('API access would be denied', Mockery::on(fn ($ctx) => $ctx['status'] === 401 && $ctx['path'] === 'api/customers'))
            ->once();
    }

    public function test_log_mode_lets_a_user_without_the_key_through_and_logs_it(): void
    {
        $this->setMode('log');
        Log::spy();
        $this->actingAsRole(Role::TECHNICIAN, 'web');

        [$reached, $status] = $this->runGate('GET', '/api/transactions');

        $this->assertTrue($reached);
        $this->assertSame(200, $status);
        Log::shouldHaveReceived('warning')
            ->with('API access would be denied', Mockery::on(fn ($ctx) => $ctx['status'] === 403 && $ctx['role_id'] === Role::TECHNICIAN))
            ->once();
    }

    public function test_log_mode_is_silent_for_a_permitted_or_public_request(): void
    {
        $this->setMode('log');
        Log::spy();
        $this->actingAsRole(Role::ADMINISTRATOR, 'web');

        $this->assertTrue($this->runGate('GET', '/api/transactions')[0]);
        $this->assertTrue($this->runGate('POST', '/api/payments/webhook')[0]);

        Log::shouldNotHaveReceived('warning');
    }

    /**
     * Log mode must not change how the request is handled: no guard switch,
     * no user resolver replaced, no user logged in along the way.
     */
    public function test_log_mode_leaves_the_auth_state_untouched(): void
    {
        $this->setMode('log');
        $defaultBefore = Auth::getDefaultDriver();

        $request = Request::create('/api/transactions', 'GET');
        $request->setUserResolver($resolver = static fn () => null);

        (new ApiAccessControl())->handle($request, fn () => new JsonResponse([]));

        $this->assertSame($defaultBefore, Auth::getDefaultDriver());
        $this->assertSame($resolver, $request->getUserResolver());
        $this->assertFalse(Auth::guard('web')->hasUser());
    }

    /**
     * A custom-role user whose role row cannot be read (here: no roles table,
     * as when the database errors) — the dry run swallows it, the request goes
     * through, and the user object is left exactly as it was: no `role`
     * relation attached that would then appear wherever the user is serialised.
     */
    public function test_log_mode_survives_a_database_error_and_leaves_the_user_untouched(): void
    {
        $this->setMode('log');

        $user = new User();
        $user->id = 5;
        $user->role_id = 42;
        $this->actingAs($user, 'web');

        [$reached, $status] = $this->runGate('GET', '/api/transactions');

        $this->assertTrue($reached);
        $this->assertSame(200, $status);
        $this->assertFalse($user->relationLoaded('role'));
        $this->assertArrayNotHasKey('role', $user->toArray());
    }

    /**
     * enforce, session user: the default guard stays `web`, so the logout
     * route's Auth::logout() still exists (sanctum's RequestGuard has none).
     */
    public function test_enforce_keeps_the_web_guard_for_a_session_user(): void
    {
        $this->setMode('enforce');
        $this->actingAsRole(Role::TECHNICIAN, 'web');

        $this->assertTrue($this->runGate('GET', '/api/job-orders')[0]);
        $this->assertSame('web', Auth::getDefaultDriver());
        $this->assertTrue(method_exists(Auth::guard(), 'logout'));
    }

    /** Logging out must work on a lapsed session, in every mode. */
    public function test_enforce_lets_an_anonymous_logout_through(): void
    {
        $this->setMode('enforce');

        $this->assertTrue($this->runGate('POST', '/api/logout')[0]);
    }

    // ── off ──────────────────────────────────────────────────────────────────

    public function test_off_mode_stands_aside_entirely(): void
    {
        $this->setMode('off');
        Log::spy();

        [$reached, $status] = $this->runGate('DELETE', '/api/plans/1');
        $this->assertTrue($reached);
        $this->assertSame(200, $status);

        // Over HTTP too: the anonymous refusal that enforce gives is not given.
        $this->getJson('/api/auth/session')->assertStatus(200);

        Log::shouldNotHaveReceived('warning');
    }
}
