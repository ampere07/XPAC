# Roles Module — Guide Manual

ATSS 2.0 · Sidebar → **Users → Roles** (Role Management)

This manual covers the Role Management screen: the fields on the role form, what
a permission key means, how a role built on a system role behaves, and the rules
the server enforces when you save.

---

## 1. What a role is

A role is a named set of **permission keys**. A key either opens a page (`job-order`)
or enables one control on that page (`job-order.approve`). A user holds exactly
one role, on `users.role_id`.

There are two kinds:

| Kind | IDs | Editable here? | Where its access comes from |
|---|---|---|---|
| **System role** (seeded, "locked") | **1–8** | **No** — shown with a *System* badge and a *Locked* label | `backend/app/Support/Permissions.php → ROLE_PERMISSIONS` |
| **Custom role** | **9 and above** | Yes — Edit and Delete | its own stored `permissions` list, plus its base role if it has one |

### The eight system roles

| ID | Role | Lands on after sign-in |
|---|---|---|
| 7 | SuperAdmin | `dashboard` |
| 1 | Administrator | `dashboard` |
| 8 | Head Technician | `application-management` |
| 2 | Technician | `job-order` |
| 6 | OSP | `work-order` |
| 5 | Inventory Staff | `inventory` |
| 4 | Agent | `agent-dashboard` |
| 3 | Customer | `customer-dashboard` |

SuperAdmin holds the **wildcard** `*` — every key, including keys added later.

> The server is always the authority. Every endpoint is checked against
> `backend/app/Support/ApiPermissionMap.php` whatever the browser drew.
> `frontend/src/config/permissions.ts` is only the client's copy, kept in step so
> the UI can decide what to *draw* without a round trip. **Change the backend
> file first.**

---

## 2. Screen — Role Management (`frontend/src/pages/roles.tsx`)

### List columns

| Column | Shows |
|---|---|
| Role Name | the name, with a **System** badge for IDs 1–8 and a purple **`<Base> +`** badge for a hybrid |
| Description | `description`, or *"No description provided"* |
| Last Updated | `updated_at`, date only |
| Actions | **Edit** / **Delete** for a custom role; the word **Locked** for a system role |

Search filters on role name. Page size: 10 / 25 / 50 / 100.

### Controls and the keys they need

| Control | Permission key |
|---|---|
| Open the page | `roles` |
| **+** (Add) | `roles.create` |
| Edit (pencil) | `roles.edit` |
| Delete (trash) | `roles.delete` |

A control is only drawn when the request behind it would actually succeed.

### Organization scoping

The list shows system roles (ID ≤ 8) **plus** roles belonging to your
organization. A custom role from another organization is filtered out on the
client and refused by the server (403) on update and delete.

---

## 3. Fields — *Add / Edit Role* modal (`modals/RoleModal.tsx`)

| Field | Required | Type | Stored as | Rules |
|---|---|---|---|---|
| **Role Name** | **Yes** | text, max 255 | `roles.role_name` | Must be **unique across the whole table**, system roles included. A duplicate returns 422. |
| **Description** | No | textarea (2 rows) | `roles.description` | Free text. Shown in the list. |
| **Start From a System Role** | No | select | `roles.base_role_id` | One of the eight system roles, or *"None — pick every page by hand"* (stored as `NULL`). Nothing else is accepted — a custom role can never be a base, so roles can never chain. |
| **Permissions** | No | checkbox grid | `roles.permissions` (JSON array) | Only the keys **ticked here** are stored — see §5. |
| Organization | auto | — | `roles.organization_id` | Taken from the signed-in user on create. **Cannot be changed on update** — the API strips it. |
| Created / Updated by | auto | — | `roles.created_by_user_id`, `updated_by_user_id` | The signed-in user. |
| Permissions version | auto | — | `roles.permissions_version` | Stamped to `Permissions::CURRENT_VERSION` (**1**) on every save. Clients cannot set it. See §7. |

### The permission grid

Three columns: **Page Name · View · Actions**.

- **View** opens the page — it is the page key itself (`job-order`).
- Each **Action** beside it is one button on that page (`job-order.approve`).
  Leave an action unticked and that button is hidden for the role.
- Rows are grouped under the same section headings the sidebar uses, so a role is
  ticked in the shape it will be navigated in.
- The grid is generated from the permission catalog, so a page added to the
  catalog becomes grantable immediately — it never has to be listed twice.

#### Behaviour while ticking

| You do | What happens |
|---|---|
| Tick an action | Its page (View) is ticked automatically — unless the base role already grants it. |
| Untick a page (View) | Every action under it is unticked. |
| Tick one of an exclusive pair | The partner is cleared (see below). |
| Choose / change a base role | Every extra the new base already grants is dropped (it would be a stale duplicate), as is anything exclusive with what the base grants. |

#### The mutually exclusive pairs

These cannot both be held — one opens the technician's Done form, the other the
administrator's:

- `job-order.tech-edit` ⟷ `job-order.admin-edit`
- `service-order.tech-edit` ⟷ `service-order.admin-edit`

If a **base role** brings one of a pair in, the other is not offered at all — a
hybrid cannot un-inherit half its base.

---

## 4. Hybrid roles — "Start From a System Role"

Pick one of the eight and the new role **holds everything that role holds**, then
the ticks below only **add** to it.

- Inherited keys appear **ticked, locked, and badged *Inherited***, with a
  tooltip naming the base.
- The inheritance is **live**: it is resolved from `Permissions` on every read,
  never copied into the role's stored list. So the hybrid follows its base role
  as that role changes, including pages added to it later.
- Choosing **SuperAdmin** as the base inherits the wildcard — the modal says so,
  and there is nothing left to add; the stored `permissions` are saved empty.
- A **system role is never itself a hybrid**. Its access is the table in
  `Permissions`, so a `base_role_id` recorded against IDs 1–8 is ignored rather
  than quietly widening a seeded role.
- Clearing the base back to *None* turns the role standalone. Its own ticked keys
  are untouched — it simply loses the inherited half.

---

## 5. What is stored versus what is granted

```
effective access  =  base role's keys (live)  +  this role's stored permissions
```

Only the **extras** are written to `roles.permissions`. Storing the inherited
half would freeze a copy of the base role at the moment of saving, which is the
one thing hybrids exist to avoid.

The API returns two fields on a role:

| Field | Meaning |
|---|---|
| `permissions` | the column exactly as stored |
| `effective_permissions` | what the role actually grants, grandfathering included, **minus** the inherited half |

The modal seeds its checkboxes from `effective_permissions`. This matters: a role
saved before per-action keys existed stores only its pages, so seeding from the
raw column would show Add / Edit / Delete unticked for a role that has them — and
the first save would then silently revoke them from a screen that never showed
them ticked.

---

## 6. Permission key reference

### Naming

- Page key: the page id — `job-order`, `customer`, `agent-payout`.
- Action key: `<page>.<verb>`.
- Standard verbs (`Permissions::CRUD_VERBS`, shown in this order):
  `create` → **Add**, `edit` → **Edit**, `delete` → **Delete**.
- Anything that is not one of the three keeps a descriptive verb —
  `job-order.approve` says what it grants; `job-order.action3` would not.

### The groups shown in the grid

| Group | Pages |
|---|---|
| **Dashboards** | dashboard, agent-dashboard, live-monitor, support |
| **Billing** | customer, transaction-list, transactions-revert, payment-portal, soa, invoice, overdue, so-charge, dc-notice, mass-rebate, staggered-payment, discounts, soa-generation |
| **Operations** | application-management, job-order, service-order, radius-queue, work-order, lcp-nap-location, sms-blast, reports |
| **Agent** | bonus-history, agent-invoices, agent-payout, agent-management, team-agent |
| **Inventory** | inventory, inventory-category-list |
| **Tools** | smartolt-tool, mikrotik-radius-tool, xendit-reconcile-tool, billing-reconcile-tool |
| **Configurations** | promo-list, plan-list, location-list, lcp, nap, ports, router-models, status-remarks-list, usage-type, vlan-config, payment-method, work-category, radius-config, smart-olt, sms-config, sms-template, email-templates, pppoe-setup, concern-config, billing-config |
| **Users** | user-management, tech-users, organization, roles, group-management |
| **Logs** | disconnected-logs, reconnection-logs, sms-logs, sms-blast-logs, email-logs, data-logs, expenses-log, smart-olt-logs, radius-logs, system-logs |
| **Customer Portal** | customer-dashboard, customer-bills, customer-support, agent-application |
| **Settings** | settings |
| **Other** | any page not filed above — appended automatically so nothing is ungrantable |

### Non-standard action keys

| Page | Actions |
|---|---|
| job-order | `approve`, `failed`, `tech-edit`, `admin-edit`, `attachment`, `pre-install` |
| customer | `so-request`, `details-edit`, `attachment`, `transact` |
| transaction-list | `batch-approve`, `approve`, `revert-request` |
| application-management | `move-to-jo`, `quick-status` |
| service-order | `tech-edit`, `admin-edit` |
| work-order | `manage` (raise / reassign / delete, as opposed to working one assigned to you) |
| reports | `manage`, `delete` |
| bonus-history | `payout` |
| agent-payout | `approve` |
| agent-invoices | `generate`, `status`, `payout` |
| soa-generation | `manage` |
| mass-rebate / staggered-payment / discounts | `add` |

Every **Configurations** page and every **Users** page uses the standard
`create` / `edit` / `delete` trio.

> **Agent Management** currently has no per-action keys of its own. It renders the
> User Management screen with `agentOnly`, and its Add / Edit / Delete controls are
> ungated — holding the `agent-management` page grants all three, until that group
> is given its own verbs.

---

## 7. Grandfathering and retired keys

Two compatibility rules exist so that splitting page keys into per-action keys
did not silently revoke buttons from roles saved earlier.

**Grandfathered actions** — a role stored under an older `permissions_version`
that holds one of these pages is also granted its standard verbs: every
Configurations page, plus `tech-users`, `organization`, `roles`,
`group-management`; `status-remarks-list` → `create` only; `user-management` →
`create` and `delete` only. **Saving the role from this modal stamps the current
version and the ticks become authoritative** — that is the only way a role leaves
the rule.

**Retired keys** — still read, no longer offered: `ports.manage`,
`router-models.manage`, `status-remarks-list.manage`. Each grants all three of
its page's standard verbs. Re-saving the role writes the new keys.

---

## 8. Rules the server enforces

| Rule | Response |
|---|---|
| System roles (ID ≤ 8) cannot be edited | 403 *"System roles cannot be edited"* |
| System roles cannot be deleted | 403 *"System roles cannot be deleted"* |
| A role with users assigned cannot be deleted | 400 *"Cannot delete role that has assigned users"* — reassign those users first |
| `role_name` must be unique | 422 |
| `base_role_id` must be one of IDs 1–8, or null | 422 |
| Every permission key must be one the system recognises | 422 — an unknown key would silently grant nothing, which reads as a broken permission system rather than as the typo it is |
| A role from another organization | 403 on update and delete |
| `organization_id` and `permissions_version` in the payload | ignored on update |

Failed creates and updates are also written to the Laravel log
(`Role create failed` / `Role update failed`) with the name and base role.

---

## 9. Assigning a role to a user

Roles are not assigned from this screen. Go to **Users → User Management**, open
the user, and pick the role in the **Role** field (`users.role_id`).

- **Agent Management** locks that field to **Agent** and reveals the agent terms
  — see the Agent Module manual.
- A role change takes effect on the user's **next request**: the server re-reads
  their role, so an administrator whose role is changed mid-session loses the
  access immediately rather than at their next sign-in.
- At sign-in the API returns the user's `role`, `role_id`, resolved `permissions`
  and the page they should land on, so a client never has to work out which kind
  of role it holds.

---

## 10. Data model reference

**`roles`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | 1–8 are the seeded system roles |
| `organization_id` | bigint, nullable | |
| `role_name` | string | **UNIQUE** |
| `description` | text, nullable | |
| `base_role_id` | int, nullable | the seeded role a hybrid builds on |
| `permissions` | longText, cast to array | the role's **own** keys only |
| `permissions_version` | int | generation of the permission model this row was saved under |
| `created_by_user_id`, `updated_by_user_id` | bigint, nullable | |
| `created_at`, `updated_at` | timestamps | |

**`user_roles`** — `user_id, role_id, organization_id, timestamps`. The primary
assignment used everywhere is `users.role_id`.

---

## 11. API reference

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/roles` | list, with `users_count` and `effective_permissions` |
| POST | `/api/roles` | create |
| GET | `/api/roles/{id}` | one role, with its users |
| PUT | `/api/roles/{id}` | update (refused for ID ≤ 8) |
| DELETE | `/api/roles/{id}` | delete (refused for ID ≤ 8, or when users are assigned) |
| POST | `/api/users/{id}/roles` · DELETE `/api/users/{id}/roles` | assign / remove |

Create and update payload:

```json
{
  "role_name": "Billing Supervisor",
  "description": "Billing pages plus transaction approval",
  "base_role_id": 1,
  "permissions": ["transaction-list.approve", "reports"],
  "organization_id": 4
}
```

`permissions` carries **extras only** — never the inherited keys, which the
server merges in on every read.

---

## 12. Troubleshooting

| Symptom | What to check first |
|---|---|
| A page is missing from the sidebar for a role | The page key is not held. Sidebar visibility is decided by the permission table, not by the menu. |
| A button is missing but the page opens | The page key is held and the action key is not. |
| A ticked box is greyed out | It is inherited from the base role (badged *Inherited*), or its exclusive partner is inherited. |
| Add / Edit / Delete vanished from a Configurations page after saving a role | The role was grandfathered; saving stamped the current version and made the ticks authoritative. Tick the three verbs explicitly. |
| Both Done forms wanted on one role | Not possible — `tech-edit` and `admin-edit` are mutually exclusive by design. |
| "Cannot delete role that has assigned users" | Move those users to another role first. |
| Role name rejected as taken | Names are unique across the whole table, including the eight system roles and roles from other organizations. |
| A new page cannot be granted to anyone | Add it to `Permissions::PAGES` (backend, first) and to `PAGES` / `PERMISSION_LABELS` in `config/permissions.ts`, then map its endpoints in `ApiPermissionMap.php`. |
