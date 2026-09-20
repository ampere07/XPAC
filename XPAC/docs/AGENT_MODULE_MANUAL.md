# Agent Module — Guide Manual

ATSS 2.0 · Sidebar → **Agent**

This manual covers every screen in the Agent group, the exact fields each form
asks for, what each field means, and how the money an agent earns is produced.
It is written for the person who sets up agents and signs off payouts.

---

## 1. The screens in this module

| Sidebar entry | Screen | Source file | Permission key |
|---|---|---|---|
| Team Agents | Agent teams (the list of teams) | `frontend/src/pages/teamAgent.tsx` | `team-agent` |
| Agent Management | Agent user accounts | `frontend/src/pages/UserManagement.tsx` (`agentOnly`) | `agent-management` |
| Agent Payout | Earnings + payout records | `frontend/src/pages/AgentPayout.tsx` | `agent-payout`, `agent-payout.approve` |
| Invoices | Weekly referral invoices | `frontend/src/pages/AgentInvoice.tsx` | `agent-invoices`, `.generate`, `.status`, `.payout` |
| Bonus History | Bonus records raised against agents | `frontend/src/pages/BonusHistory.tsx` | `bonus-history`, `bonus-history.payout` |

**A signed-in AGENT does not see the group.** They get two entries instead:

- **History** — the same `BonusHistory` page, reading *their own* row of
  `agent_commission_history` (payouts, incentives, bonuses, achievements).
- **Invoices** — the same `AgentInvoice` page, scoped server-side to their team,
  or to themselves when they are a solo agent.

---

## 2. Set-up order

Do it in this order, or the later steps have nothing to work with:

1. **Team Agents** → create the team.
2. **Agent Management** → create the agent's user account, attach it to the
   team, and set Commission / Quota / Incentives.
3. Referrals are then recorded on applications and job orders through the
   **Referred By** picker (see §5.1).
4. `cron:process-agent-incentives` awards completed quotas.
5. `cron:generate-agent-invoices` bills the week (Monday 00:00).
6. **Agent Payout** / **Bonus History** → raise and approve the money out.

---

## 3. Screen — Team Agents

The team is only a grouping. It carries no rates of its own; every peso figure
lives on the agent account (§4).

### Fields — *Add / Edit Agent* modal (`modals/AgentModal.tsx`)

| Field | Required | Type | Stored as | Notes |
|---|---|---|---|---|
| Team Name | **Yes** | text, max 255 | `agents.team_name` | The only field on the form. Shown wherever a team is picked. |
| Created By | auto | text | `agents.created_by` | The signed-in user's email, taken from `authData`; falls back to `system`. |
| Organization | auto | bigint | `agents.organization_id` | Copied from the signed-in user. **Cannot be changed on edit** — the API strips it from the payload. |
| Created At | auto | datetime | `agents.created_at` | Set on insert; the model has `timestamps = false`. |

### Actions

- **Add / Edit / Delete** (trash icon).
- **Commission Payout** (banknote icon on a row) — opens
  `modals/CommissionPayoutModal.tsx`, see §6.3.

### Rules to know

- The list is filtered by organization on the client **and** the server. A team
  belonging to another organization is never shown, and updating or deleting one
  returns 403.
- Delete has **no dependency check**. Deleting a team whose agents still point at
  it leaves those agents with a dangling `users.agent_id`. Move the agents first.

---

## 4. Screen — Agent Management

This is `User Management` rendered with `agentOnly`, so: the Role field is locked
to **Agent**, the Organization picker is hidden (the account inherits the
creator's organization), and the agent money fields are always shown.

### Fields — *Add / Edit User* drawer (`modals/UserModal.tsx`)

#### Account details

| Field | Required | Type | Stored as | Notes |
|---|---|---|---|---|
| First Name | **Yes** | text | `users.first_name` | |
| Last Name | **Yes** | text | `users.last_name` | |
| Middle Initial | No | 1 character | `users.middle_initial` | `maxLength = 1`. |
| Username | **Yes** | text | `users.username` | Unique — a 422 is shown as *"already existed"*. |
| Email Address | **Yes** | email | `users.email_address` | Unique. The sign-in identity and the notification address. |
| Contact Number | No | text | `users.contact_number` | |
| Organization | hidden here | select | `users.organization_id` | Inherited from the creator in agent mode. |
| Role | locked | — | `users.role_id` | Read-only **Agent** (`role_id = 4`). |
| Password | **Yes** on create | password, min 8 | `users.password` | On **edit**, leave blank to keep the current one. |
| Confirm Password | **Yes** on create | password | — | Must match exactly. Not shown when editing. |

#### Agent terms — shown whenever the role is Agent

| Field | Required | Type | Stored as | Default on a new account |
|---|---|---|---|---|
| Team | No | select of `agents` | `users.agent_id` | blank = **solo agent** (still earns, still invoiced, on their own invoice) |
| Commission | **Yes** | decimal ₱ | `agent_balance.commission` | **100.00** |
| Quota | **Yes** | integer count | `agent_balance.quota` | **10** |
| Incentives | **Yes** | decimal ₱ | `agent_balance.incentives_value` | **100.00** |
| Remarks | No | textarea | `agent_balance.remarks` | empty |

> The three defaults live in `AGENT_DEFAULTS` at the top of
> `modals/UserModal.tsx`. They are only pre-filled values for a **new** account —
> they can be overwritten before saving, and editing an existing agent always
> shows that agent's own stored figures. Change the agreed standard terms there.

#### What the three money fields actually mean

- **Commission** — pesos earned **per completed referral**. It is also the
  **unit price** printed on each customer line of that agent's weekly invoice, so
  a mixed-rate team prices every line at the rate of the agent who brought that
  customer in.
- **Quota** — a **count of completed referrals**, not a peso amount. Reaching it
  completes one *batch*.
- **Incentives** — pesos credited **per completed quota batch**:

  ```
  incentive earned = number of completed quota batches × incentives_value
  ```

  Quota 10 with Incentives 100 → ₱100 each time 10 referrals complete. The
  referrals inside a batch are not separately paid by this figure; commission is
  the per-referral part of the scheme.

---

## 5. How an agent earns

### 5.1 What counts as *their* referral

Attribution runs off the single `referred_by` varchar on applications, customers
and service orders (`app/Support/AgentReferral.php`):

- The **Referred By picker** writes the agent's **bare user id** (`37`), which
  names exactly one account.
- A number only counts as an id when it resolves to a user **whose role is
  Agent**. Anything else — mobile numbers, account numbers, values with leading
  zeros — stays free text and is displayed exactly as stored.
- Legacy free-text values (agent names, team names, "Walk in") are still matched
  tolerantly by name.
- Known ambiguous legacy values, worth checking if a referral ever shows the
  wrong name: `000201`, `699`, `1840`.

### 5.2 Commission — per referral

Earned once the referral's job order is approved, at the agent's own
`agent_balance.commission` rate.

### 5.3 Incentive — per completed quota batch

Awarded by `cron:process-agent-incentives` (`AgentIncentiveService`):

- A job order counts when its **onsite status is Done or Completed**, **or** it
  carries the **pre-install marker** and has not since been abandoned
  (Failed / Cancelled).
- Progress is **never reset** by a run. Uncounted referrals accumulate until a
  full quota completes; any remainder carries over to the next run.
- On completion, every job order in the batch is written to
  `agent_incentive_history` with that cycle's `batch_number` and is **consumed
  permanently** — a `UNIQUE` key on `job_order_id` makes double payment
  impossible even across concurrent runs.
- 20 completed referrals on a quota of 10 award **2 batches in one run**.
- A batch is undone by `reverseAbandonedBatches()` if one of its referrals later
  turns out to have been abandoned.

### 5.4 Achievements — per period (`config/achievements.php`)

| Tier | Target (onboarded referrals) | Reward | Period |
|---|---|---|---|
| Weekly Achievement | 25 | ₱1,000 | resets every ISO week (Mon–Sun) |
| Monthly Achievement | 100 | ₱15,000 | resets every calendar month |

Tunable via `ACHIEVEMENT_WEEKLY_TARGET` / `ACHIEVEMENT_WEEKLY_REWARD` and
`ACHIEVEMENT_MONTHLY_TARGET` / `ACHIEVEMENT_MONTHLY_REWARD`. A tier is claimable
**once per period**. Closed periods are recorded in `agent_achievement_periods`,
claims in `agent_achievement_claims`.

### 5.5 Bonus — manual

Raised by an administrator from **Bonus History** (§6.4). Nothing computes it.

### 5.6 Programme start date

`config/agent.php → start_date` (env `AGENT_START_DATE`) is currently **null** =
an agent's whole history counts. Setting a date makes earlier referrals earn
nothing — for incentives **and** achievements alike, so the two can never
disagree.

> ⚠️ If you set it, you must set the matching `AGENT_JOB_ORDER_START_DATE` in the
> `agentReferral` helper of **both** frontends (`ATSS2_0/frontend` and
> `MOBILEAPP/frontend`). A date on the server alone hides nothing on the clients;
> a date on the clients alone shows referrals that earn nothing.

### 5.7 The balance buckets (`agent_balance`)

`balance`, `incentives`, `bonus` and `achievement` are **independent columns**,
alongside `commission_value`. A payout of type **All Balance** cashes out every
bucket at once — which is why the amount is not typed by hand.

---

## 6. Money out — the payout forms

### 6.1 Agent Payout screen

Two tables:

**Earnings** — `Transaction ID · Customer Name · Service Type · Date · Status ·
Amount`

**Payout history** — `ID · Type · Ref Number · Total Amount · Job Orders ·
Created By · Status · Approved By`

Column order is drag-arrangeable and remembered per browser; columns added later
are appended to a saved arrangement rather than lost.

Payout statuses: **Pending** → **Approved** (`agent_commission_history.status`,
default `Pending`; rows predating the column were backfilled as `Approved`).

### 6.2 Fields — *Agent Payout* modal (`modals/AgentPayoutModal.tsx`)

| Field | Required | Behaviour |
|---|---|---|
| Agent | **Yes** | Searchable picker grouped by team (solo agents under *No Team*). Pre-filled when opened from a row. |
| Payout Type | **Yes** | One option only: **All Balance**, sent as `type: all`. Cashes out every bucket, so there is no partial settlement to reconcile later. |
| Reference Number | **Yes** | Auto-generated, read-only. |
| Total Amount | **Yes** | **Locked** when raising — filled with the agent's whole balance. **Editable when approving**: that is where the figure is actually decided, and an agent whose balance already reads zero could otherwise never be approved. |
| Proof | **Yes** | Image upload (PNG / JPG / JPEG). Saved to Google Drive under `agent-payout - <agent name>`; the URL is stored in `proof_of_payment`. |
| Remarks | **Yes** | Free text. |

**Raised from an invoice** (`fromInvoice`): only *Agent* and the read-only
*Invoice Number* are asked for — type, amount, proof and remarks are hidden and
sent empty, and the API relaxes its own requirement for them. Those four are then
entered at **approval** time.

- Raising posts `POST /commissions/history`.
- Approving posts `POST /commissions/history/{id}/approve`, which writes the
  details onto the record that already exists. Approving through the create
  endpoint raises a **second** payout beside the first.
- Approval requires `agent-payout.approve`.

### 6.3 Fields — *Commission Payout* modal (from Team Agents)

The same shape, plus a date range and a read-only list of the agent's completed
job orders:

| Field | Required | Notes |
|---|---|---|
| Agent | **Yes** | grouped by team |
| Start / End Date | No | narrows the job orders listed |
| Job Orders Referred by Agent | read-only | shows the count and `₱<rate> each`; the ids go out as `commission_id_list` |
| Reference Number | **Yes** | |
| Total Amount | **Yes** | |
| Proof of Payment | **Yes** | image upload |
| Remarks | **Yes** | |

### 6.4 Fields — *Bonus Payout* modal (from Bonus History)

Posts `POST /commissions/bonus-history` → `agent_bonus_history`.

| Field | Required |
|---|---|
| Agent | **Yes** |
| Reference Number | **Yes** |
| Total Amount | **Yes** |
| Proof | **Yes** (image) |
| Remarks | **Yes** |

The **Add Bonus** button is only drawn for a user holding `agent-payout` — it is
an administrator's act against an agent, so it never appears on an agent's own
reading of their history, whatever keys their account happens to hold.

Bonus History columns: `ID · Ref Number · Type · Total Amount · Created By ·
Status · Approved By` (an agent additionally sees **Job Orders**).

`type` is a loose column — `commission`, `incentives`, `incentives_payout`,
`Bonus`, `Bonus_payout`, `all`, `achievement`. Displayed labels:
`incentives_payout` / `Bonus_payout` → **Payout**, `incentives` → **Add
Incentives**, `Bonus` → **Add Bonus**; anything unrecognised is shown as stored.

---

## 7. Screen — Agent Invoices

One invoice per **team** and one per **solo agent**, for the calendar week that
has just ended (Monday 00:00 → Sunday 23:59).

### List columns

`Invoice No. · Type · Team / Agent · Invoice Date · Billing Period · Customers ·
Total Amount · Subtotal · Status`

A row opens its detail pane; **View PDF**, **Download** and **Pay Out** live
there. There is deliberately no Actions column.

### Statuses

- Selectable by hand: **Generated**, **Paid**, **Unpaid** (needs
  `agent-invoices.status`). Picking a value saves immediately; a failed save puts
  the old value back.
- Still accepted, no longer offered: **Sent**, **Cancelled** — invoices already
  carrying them keep displaying correctly.

### How the figures are produced (`config/agent_invoices.php`)

| Line on the invoice | Where it comes from |
|---|---|
| **Unit price** (per customer line) | the **referring agent's own** `agent_balance.commission` |
| **Commission** | the sum of those lines |
| **Total amount** | the **incentives** the cron awarded inside that billing week, read from `agent_incentive_history`; each completed quota billed exactly once |
| **Subtotal** | Total Amount + Commission |
| **Installation fee** | a stated figure (`AGENT_INVOICE_INSTALLATION_FEE`, default 500). **Not** part of what is owed |
| **Invoice number** | `ATSS-AGT-000001` — `AGENT_INVOICE_PREFIX` plus a 6-digit running number |

Other keys: `pdf_folder` (`storage/app/public/agent-invoices`), `first_page_rows`
(10, team invoice), `first_page_rows_solo` (15), `rows_per_page` (18),
`chunk_size` (200). The `unit_price` key is **no longer used by the invoice run**
— it survives only as a fallback in `JobOrderAgentPaymentService` for an agent
with no rate of their own.

Rendered PDFs live on Google Drive: `pdf_drive_url` / `pdf_drive_id` /
`pdf_uploaded_at`. `pdf_path` is only the layout-versioned filename.

### Safety

Re-running the generator creates nothing: an owner already invoiced for the week
is skipped, and `UNIQUE (owner_key, period_start)` plus
`UNIQUE (owner_key, application_id)` stop a customer being billed twice.

---

## 8. Scheduled jobs

| Command | When | What |
|---|---|---|
| `cron:generate-agent-invoices` | **Monday 00:00** (Asia/Manila), in `app/Console/Kernel.php` | the weekly referral invoices. Log: `storage/logs/agent-invoices/Agent_Invoices.log` |
| `cron:process-agent-incentives` | **not on the Laravel schedule** — add it to the system crontab yourself | awards completed quota batches (idempotent) |
| `agents:apply-invoice-status` | manual | sets invoice statuses Paid / Unpaid from a per-client CSV of payments |
| `cron:backfill-agent-invoices`, `cron:diagnose-agent-settlement` | manual | backfill and diagnostics |

---

## 9. Data model reference

**`agents`** — `id, team_name, created_by, organization_id, created_at, updated_at`

**`users`** (agent-relevant) — `role_id` (4 = Agent), `agent_id` (team; nullable =
solo)

**`agent_balance`** — `id, agent_id, balance, commission, commission_value,
incentives, incentives_value, quota, bonus, achievement, remarks,
organization_id, timestamps`

**`agent_commission_history`** — `id, agent_id, ref_number, type, total_amount,
commission_id_list, job_order_ids, proof_of_payment, remarks, status, created_by,
updated_by, approve_by, organization_id, timestamps`

**`agent_bonus_history`** — `id, agent_id, ref_number, type, total_amount,
proof_of_payment, remarks, status, created_by, updated_by, approve_by,
organization_id, created_at, updated_at`

**`agent_incentive_history`** — `id, agent_id, job_order_id (UNIQUE),
quota_reached, batch_number, incentive_value, organization_id, processed_at,
timestamps`

**`agent_achievement_periods`** — `id, agent_id, period_type, period_key,
period_start, period_end, target, onboarded, reached, claimed, claim_id,
reward_paid, carried_over, closed_at, closed_by, organization_id` ·
UNIQUE `(agent_id, period_type, period_key)`

**`agent_achievement_claims`** — `id, agent_id → users.id, milestone, amount,
period, cycle bounds, job_order_ids, status, approve_by, timestamps`

**`agent_invoices`** — `id, invoice_number (UNIQUE), invoice_type, owner_key,
team_id, agent_id, team_name, agent_name, period_start, period_end, invoice_date,
total_customers, unit_price, installation_fee, total_amount, commission,
subtotal, pdf_path, pdf_drive_url, pdf_drive_id, pdf_uploaded_at, status,
organization_id, created_by, updated_by, timestamps`

**`agent_invoice_customers`** — `id, agent_invoice_id → agent_invoices (cascade),
application_id, job_order_id, owner_key, customer_name, referred_by_agent_id,
referred_by_name, referred_by_raw, installed_date, unit_price, quantity, total`

---

## 10. API reference

| Method | Endpoint |
|---|---|
| GET / POST / PUT / DELETE | `/api/agents` (apiResource) |
| GET | `/api/commissions/agent-job-orders` |
| POST | `/api/commissions/history` · `/api/commissions/history/{id}/approve` |
| POST | `/api/commissions/bonus-history` |
| GET | `/api/agent-invoices` · `/periods` · `/archive` · `/{id}` · `/{id}/pdf` |
| POST | `/api/agent-invoices/generate` |
| PATCH | `/api/agent-invoices/{id}/status` |

Every endpoint is authorised against `backend/app/Support/ApiPermissionMap.php`,
whatever the UI happened to draw.

---

## 11. Troubleshooting

| Symptom | What to check first |
|---|---|
| An agent earns nothing | No `agent_balance` row, or Commission / Quota / Incentives were left blank. All three are required on the form for a reason. |
| A referral is credited to the wrong agent | Legacy free-text `referred_by` matched by name, or a numeric legacy value colliding with a real agent id (`000201`, `699`, `1840`). |
| Incentive never awarded | `cron:process-agent-incentives` is **not** on the Laravel schedule — confirm it is in the system crontab. |
| Quota progress looks reset | It never is. Check whether a batch completed and consumed those job orders into `agent_incentive_history`. |
| Web and mobile disagree on referral counts | `agent.start_date` set on the server without the matching `AGENT_JOB_ORDER_START_DATE` in both frontends. |
| Invoice missing a customer | Already billed to that owner (`UNIQUE (owner_key, application_id)`), or the job order is not Done / Completed. |
| Two payouts appear for one approval | The approval was posted to `/commissions/history` instead of `/commissions/history/{id}/approve`. |
| "Unauthorized. You can only update agents within your organization." | The team belongs to another organization; `organization_id` cannot be changed on update. |
