<?php

namespace Tests\Feature;

use App\Http\Middleware\ApiAccessControl;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * The middleware itself, exercised over real HTTP.
 *
 * ApiPermissionCoverageTest checks the table; this checks that the table is
 * actually consulted — that a request really is refused before it reaches a
 * controller. Only refusals and anonymous reads are asserted, because those are
 * the paths that stop short of the database and so run without a fixture.
 */
class ApiAccessControlTest extends TestCase
{
    /** An in-memory user of the given role. Never saved; nothing here needs it. */
    private function actingAsRole(int $roleId): self
    {
        $user = new User();
        $user->id = 1;
        $user->role_id = $roleId;

        $this->actingAs($user, 'sanctum');

        return $this;
    }

    /**
     * @dataProvider protectedEndpoints
     *
     * Only the status is asserted. A route that already carried its own
     * `auth:sanctum` answers with Laravel's stock `{"message":"Unauthenticated."}`
     * because Authenticate outranks this middleware in the framework's priority
     * order; a route relying on the group answers with this middleware's own
     * `{"success":false,...}`. Both are 401 and both are handled by the clients.
     */
    public function test_anonymous_requests_are_refused(string $method, string $uri): void
    {
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
            'reports'            => ['GET', '/api/reports'],
            'system logs'        => ['GET', '/api/logs'],
            'delete a plan'      => ['DELETE', '/api/plans/1'],
            'create a user'      => ['POST', '/api/users'],
            'approve a payment'  => ['POST', '/api/transactions/1/approve'],
            'debug users table'  => ['GET', '/api/debug/users-table'],
            'password reset aid' => ['POST', '/api/fix-customer-password'],
        ];
    }

    /** The endpoints the sign-in screen needs before anyone has signed in. */
    public function test_public_endpoints_answer_without_credentials(): void
    {
        $this->getJson('/api/health')->assertStatus(200);
    }

    /** A signed-in user without the key is refused, not merely hidden from. */
    public function test_technician_is_refused_billing_endpoints(): void
    {
        $this->actingAsRole(Role::TECHNICIAN);

        $this->getJson('/api/transactions')->assertStatus(403);
        $this->getJson('/api/reports')->assertStatus(403);
        $this->postJson('/api/users', [])->assertStatus(403);
        $this->getJson('/api/logs')->assertStatus(403);
    }

    /** An agent cannot reach the pages the admin portal keeps from them. */
    public function test_agent_is_refused_administrative_endpoints(): void
    {
        $this->actingAsRole(Role::AGENT);

        $this->getJson('/api/service-orders')->assertStatus(403);
        $this->getJson('/api/transactions')->assertStatus(403);
        $this->postJson('/api/agent-invoices/generate', [])->assertStatus(403);
        // The Work Order page is theirs to read, not to write.
        $this->postJson('/api/work-orders', [])->assertStatus(403);
    }

    /** A customer's session reaches the portal and nothing else. */
    public function test_customer_is_refused_staff_endpoints(): void
    {
        $this->actingAsRole(Role::CUSTOMER);

        $this->getJson('/api/job-orders')->assertStatus(403);
        $this->getJson('/api/users')->assertStatus(403);
        $this->getJson('/api/dashboard/counts')->assertStatus(403);
        $this->getJson('/api/commissions')->assertStatus(403);
    }

    /** An administrator does not inherit the SuperAdmin's configuration pages. */
    public function test_administrator_is_refused_superadmin_endpoints(): void
    {
        $this->actingAsRole(Role::ADMINISTRATOR);

        $this->postJson('/api/plans', [])->assertStatus(403);
        $this->postJson('/api/roles', [])->assertStatus(403);
        $this->getJson('/api/logs')->assertStatus(403);
        $this->getJson('/api/debug/users-table')->assertStatus(403);
    }

    /**
     * The other half: a permitted request is let through.
     *
     * Without this the suite would still pass if the middleware refused
     * everybody — every assertion above is a refusal.
     *
     * The middleware is driven directly rather than through a route, so nothing
     * downstream of the gate runs: these paths belong to real endpoints, and
     * dispatching them would put a test suite on the application's database.
     * What is asserted is exactly the thing in question — that the request
     * reaches `$next`.
     *
     * @dataProvider permittedRequests
     */
    public function test_permitted_requests_are_not_refused(int $roleId, string $method, string $uri): void
    {
        $this->actingAsRole($roleId);

        $reached = false;

        $response = (new ApiAccessControl())->handle(
            Request::create($uri, $method),
            function () use (&$reached) {
                $reached = true;
                return new JsonResponse(['ok' => true]);
            }
        );

        $this->assertTrue($reached, "role $roleId was refused $method $uri, which it should be allowed");
        $this->assertSame(200, $response->getStatusCode());
    }

    public static function permittedRequests(): array
    {
        return [
            'technician: job orders'      => [Role::TECHNICIAN, 'GET', '/api/job-orders'],
            'technician: edits one'       => [Role::TECHNICIAN, 'PUT', '/api/job-orders/5'],
            'technician: service orders'  => [Role::TECHNICIAN, 'GET', '/api/service-orders'],
            'technician: fibre map'       => [Role::TECHNICIAN, 'GET', '/api/lcpnap'],
            'technician: reference data'  => [Role::TECHNICIAN, 'GET', '/api/plans'],
            'technician: posts location'  => [Role::TECHNICIAN, 'POST', '/api/technician-location'],
            'agent: commissions'          => [Role::AGENT, 'GET', '/api/commissions'],
            'agent: their invoices'       => [Role::AGENT, 'GET', '/api/agent-invoices'],
            'agent: work orders'          => [Role::AGENT, 'GET', '/api/work-orders'],
            'technician: work orders'     => [Role::TECHNICIAN, 'GET', '/api/work-orders'],
            'osp: raises a work order'    => [Role::OSP, 'POST', '/api/work-orders'],
            'agent: submits application'  => [Role::AGENT, 'POST', '/api/applications'],
            'osp: work orders'            => [Role::OSP, 'GET', '/api/work-orders'],
            'inventory staff: stock'      => [Role::INVENTORY_STAFF, 'GET', '/api/inventory'],
            'inventory staff: adds stock' => [Role::INVENTORY_STAFF, 'POST', '/api/inventory'],
            'administrator: customers'    => [Role::ADMINISTRATOR, 'GET', '/api/customers'],
            'administrator: transactions' => [Role::ADMINISTRATOR, 'GET', '/api/transactions'],
            'administrator: batch approve' => [Role::ADMINISTRATOR, 'POST', '/api/transactions/batch-approve'],
            'administrator: reports'      => [Role::ADMINISTRATOR, 'GET', '/api/reports'],
            'administrator: dashboard'    => [Role::ADMINISTRATOR, 'GET', '/api/dashboard/counts'],
            'head tech: applications'     => [Role::HEAD_TECH, 'GET', '/api/applications'],
            'head tech: approves a JO'    => [Role::HEAD_TECH, 'POST', '/api/job-orders/5/approve'],
            'super admin: system logs'    => [Role::SUPER_ADMIN, 'GET', '/api/logs'],
            'super admin: writes a plan'  => [Role::SUPER_ADMIN, 'POST', '/api/plans'],
            'super admin: diagnostics'    => [Role::SUPER_ADMIN, 'GET', '/api/debug/users-table'],
            'customer: their statements'  => [Role::CUSTOMER, 'GET', '/api/statement-of-accounts/12'],
            'customer: pays a bill'       => [Role::CUSTOMER, 'POST', '/api/payments/create'],
        ];
    }
}
