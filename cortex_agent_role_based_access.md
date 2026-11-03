# One Cortex Agent, role-based semantic views

**Snowflake Cortex Agent + Snowflake Intelligence, with semantic views picked by the user's role**

Author: DSK · Last updated: Nov 3, 2026 · Warehouse: `COMPUTE_WH`

---

## 1. What this is

One Cortex Agent (`LOAN_AI_AGENT`) answers questions about loans and marketing. It's wired to three semantic views, but each user only gets the views their role can see. Nothing in the agent mentions roles. The filtering comes from plain Snowflake grants plus one agent setting, `tool_not_accessible: accept`.

```
                         ┌──────────────────────────────┐
  LOAN_USER_1  ──────────►                              │──► SharedAnalyst      ──► SV_SHARED        (both roles)
  (LOAN_ANALYST_ROLE)    │        LOAN_AI_AGENT         │──► LoanChannelAnalyst ──► SV_LOAN_CHANNEL  (loan role only)
                         │  tool_not_accessible: accept │──► MarketingAnalyst   ──► SV_MARKETING     (marketing role only)
  MARKETING_USER_1 ──────►                              │
  (MARKETING_ANALYST_ROLE)└──────────────────────────────┘
        At run time Snowflake checks: does the caller's role have SELECT on each tool's semantic view?
        Yes → tool kept.  No → tool dropped + TOOL_NOT_ACCESSIBLE warning.
```

## 2. Access matrix

| Role | SV_SHARED | SV_LOAN_CHANNEL | SV_MARKETING | Base tables |
|---|---|---|---|---|
| `LOAN_ANALYST_ROLE` | ✅ | ✅ | ❌ | 3 dims + `FACT_LOANS` |
| `MARKETING_ANALYST_ROLE` | ✅ | ❌ | ✅ | 3 dims + `DIM_CAMPAIGN`, `FACT_CAMPAIGN_SPEND` |

What lives where:

| Semantic view | Tables | Metrics |
|---|---|---|
| `SV_SHARED` | `DIM_BUSINESS`, `DIM_MARKETING_CHANNEL`, `DIM_PRODUCT` | `business_count`, `channel_count`, `product_count` |
| `SV_LOAN_CHANNEL` | `FACT_LOANS` + the 3 dims | `application_count`, `closed_loan_count`, `closed_loan_amount`, `close_rate`, `avg_interest_rate` |
| `SV_MARKETING` | `FACT_CAMPAIGN_SPEND`, `DIM_CAMPAIGN` + business, channel | `total_spend`, `total_leads`, `total_clicks`, `cost_per_lead`, `click_through_rate` |

## 3. How the role restriction works

Every agent run (REST `agent:run`, SQL `DATA_AGENT_RUN`, or the Snowflake Intelligence UI) goes through the same steps:

1. **Find the caller's role.** It's the role selected in the UI, the `X-Snowflake-Role` header on REST, or the current session role in SQL. If none of those is set, it falls back to the user's `DEFAULT_ROLE`.
2. **Check `USAGE` on the agent.** If the role doesn't have it, the run is rejected.
3. **Pre-check each Cortex Analyst tool.** Does the role have a privilege on that tool's semantic view? If not, the tool is dropped and a `TOOL_NOT_ACCESSIBLE` warning is added. That's what `accept` mode does.
4. **Run the generated SQL as the caller's role.** Missing table grants show up here as query errors. The step 3 check only looks at the semantic view itself.

The agent owner (`LOAN_AI_ADMIN`) isn't involved at run time. The agent has no data access of its own.

**Metrics follow their view.** `closed_loan_count` exists only in `SV_LOAN_CHANNEL`, so a marketing user can't reach it in any way. To share a metric with both roles, move it into `SV_SHARED` and grant both roles the tables it reads.

**Where this is set in SQL.** There's no "role" field in the agent. Three pieces work together:

| Piece | Script section | What it does |
|---|---|---|
| `tool_resources` + `tool_not_accessible: accept` | 5 (agent spec) | Links each tool to one semantic view, and skips tools the caller can't reach |
| `GRANT SELECT, REFERENCES ON SEMANTIC VIEW ...` + table grants | 6 | Decides which role reaches which view. This is the actual restriction |
| `DEFAULT_ROLE`, `DEFAULT_SECONDARY_ROLES = ()` | 7 | Decides which role a person runs as |

## 4. Actual test results

These come from real runs against the deployed script (Nov 2, 2026). The orchestration model was `claude-opus-5-5`.

### 4.1 Loan role asks a loan question ✅

**Role:** `LOAN_ANALYST_ROLE` · **Question:** "How many loans closed by marketing channel and business?"

**What the agent did:**

1. Loaded the context for `LoanChannelAnalyst` (`SV_LOAN_CHANNEL`).
2. Generated logical SQL against the semantic view:
   ```sql
   SELECT c.channel_name, b.business_name, COUNT_IF(l.loan_status='CLOSED') AS closed_loans,
          MIN(l.close_date) AS first_close, MAX(l.close_date) AS last_close
   FROM __loans l
   LEFT JOIN __channel  c ON l.channel_id  = c.channel_id
   LEFT JOIN __business b ON l.business_id = b.business_id
   GROUP BY 1,2 ORDER BY closed_loans DESC NULLS LAST
   ```
   Snowflake rewrote this into physical SQL with CTEs over `LOAN_AI_DB.RAW.FACT_LOANS`, `DIM_MARKETING_CHANNEL` and `DIM_BUSINESS`.
3. Ran a second check query and found 88 closed loans with close dates in the future.
4. Drew a heatmap chart (business × channel, colored by closed loans).

**Agent's answer:** There are **1,092 closed loans** across 6 marketing channels and 4 businesses. The highest combination is Paid Search + Auto Finance (59), and the lowest is Broker + Retail Lending (32). The agent also flagged that 88 closed loans had future close dates, and said the total would be 1,004 without them.

**Result table:**

| Channel | Business | Closed loans | First close | Last close |
|---|---|---|---|---|
| Paid Search | Auto Finance | 59 | 2025-12-07 | 2026-12-03 |
| Email | Retail Lending | 57 | 2025-12-06 | 2026-12-12 |
| Email | Small Business | 52 | 2025-12-13 | 2026-12-16 |
| Paid Search | Small Business | 51 | 2025-12-08 | 2026-12-03 |
| Branch Walk-in | Small Business | 51 | 2025-12-07 | 2026-11-07 |
| Branch Walk-in | Mortgage | 50 | 2025-12-07 | 2026-11-15 |
| Broker | Auto Finance | 50 | 2025-12-09 | 2026-11-12 |
| Direct Mail | Mortgage | 49 | 2025-12-06 | 2026-11-28 |
| Social Media | Mortgage | 48 | 2025-11-16 | 2026-11-27 |
| Social Media | Retail Lending | 48 | 2025-11-27 | 2026-12-08 |
| Paid Search | Mortgage | 46 | 2025-11-29 | 2026-11-23 |
| Email | Mortgage | 46 | 2025-12-01 | 2026-12-03 |
| Direct Mail | Small Business | 46 | 2025-11-22 | 2026-11-10 |
| Direct Mail | Retail Lending | 44 | 2025-11-12 | 2026-11-27 |
| Social Media | Small Business | 44 | 2025-12-19 | 2026-11-19 |
| Social Media | Auto Finance | 44 | 2025-11-24 | 2026-11-14 |
| Email | Auto Finance | 43 | 2025-11-24 | 2026-11-30 |
| Broker | Small Business | 42 | 2025-12-03 | 2026-11-01 |
| Branch Walk-in | Retail Lending | 41 | 2025-12-23 | 2026-11-15 |
| Broker | Mortgage | 39 | 2025-11-17 | 2026-11-19 |
| Branch Walk-in | Auto Finance | 38 | 2025-11-14 | 2026-11-22 |
| Direct Mail | Auto Finance | 37 | 2025-12-12 | 2026-11-26 |
| Paid Search | Retail Lending | 35 | 2025-12-09 | 2026-12-02 |
| Broker | Retail Lending | 32 | 2025-11-25 | 2026-11-16 |

Total: 1,092 closed loans across 24 channel × business combinations. Close dates after Nov 2, 2026 come from the sample data bug covered in Section 6.

**Warning returned:**

```json
"warnings": [{
  "code": "399569",
  "message": "TOOL_NOT_ACCESSIBLE: MarketingAnalyst (cortex_analyst_text_to_sql) - semantic_model LOAN_AI_DB.SEMANTIC.SV_MARKETING: SQL compilation error: Semantic View 'LOAN_AI_DB.SEMANTIC.SV_MARKETING' does not exist or not authorized. Your primary role LOAN_ANALYST_ROLE must have at least one privilege granted on SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_MARKETING."
}]
```

The marketing tool was dropped before the agent planned anything. The loan question used only the loan view.

### 4.2 Loan role asks a marketing question 🚫 (correctly refused)

**Role:** `LOAN_ANALYST_ROLE` · **Question:** "What is cost per lead by marketing channel?"

**Agent's reasoning (from the thinking trace):** cost per lead needs the marketing tool, which isn't available, so it should tell the user.

**Agent's answer (abridged):**

> I can't answer this one. Cost per lead comes from the marketing campaign data (spend and leads), and your role doesn't have access to the tool that holds it, **MarketingAnalyst**. The loan data I can reach has no spend or lead figures, so I can't calculate cost per lead or estimate it.
>
> Here's what I can give you by marketing channel instead: loan application counts, closed (funded) loan counts and amounts, close rate, average interest rate.

**Suggested follow-ups:** close rate by channel, highest closed loan amounts this year, monthly application trend.

**Warning:** the same `TOOL_NOT_ACCESSIBLE` warning for `MarketingAnalyst`. The agent ran no SQL and gave no estimates.

⚠️ It named the tool ("MarketingAnalyst") in its reply. The updated agent instructions in the script now tell it to say "marketing campaign data" instead.

### 4.3 Marketing role asks a shared question ✅

**Role:** `MARKETING_ANALYST_ROLE` · **Question:** "List all marketing channels and their channel group."

**What the agent did:**

1. Loaded the context for `SharedAnalyst` (`SV_SHARED`).
2. Ran `SELECT channel_name, channel_group FROM __channel ORDER BY channel_group, channel_name`.

**Agent's answer:** 6 marketing channels in three groups.

| Channel | Group |
|---|---|
| Email | Digital |
| Paid Search | Digital |
| Social Media | Digital |
| Branch Walk-in | Offline |
| Direct Mail | Offline |
| Broker | Partner |

**Warning returned:**

```json
"warnings": [{
  "code": "399569",
  "message": "TOOL_NOT_ACCESSIBLE: LoanChannelAnalyst (cortex_analyst_text_to_sql) - semantic_model LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL: SQL compilation error: Semantic View 'LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL' does not exist or not authorized. Your primary role MARKETING_ANALYST_ROLE must have at least one privilege granted on SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL."
}]
```

The marketing role got the shared view and its own view, and the loan view was dropped.

### 4.4 Summary

| # | Role | Question | Tools kept | Tool used | Outcome |
|---|---|---|---|---|---|
| 1 | Loan | Closed loans by channel & business | Shared, LoanChannel | LoanChannelAnalyst | ✅ 1,092 closed loans, table + heatmap |
| 2 | Loan | Cost per lead by channel | Shared, LoanChannel | none | 🚫 Refused, offered loan metrics instead |
| 3 | Marketing | List channels & groups | Shared, Marketing | SharedAnalyst | ✅ 6 channels |

Still worth running: marketing role → "cost per lead by channel" (should succeed) and marketing role → "closed loans by channel" (should be refused).

## 5. Doing the same thing in the UI

Yes, the UI gives you the same behavior. The UI calls the same agent, and the same grants decide what each user gets.

### Option A: Snowflake Intelligence (what end users should use)

1. Run Section 8 of the script. It creates the Snowflake Intelligence object, adds `LOAN_AI_AGENT`, and grants `USAGE` to both roles.
2. Sign in to Snowflake Intelligence as `LOAN_USER_1`. The first login forces a password change.
3. The agent appears as **Lending Insights Agent** (its `display_name`). Pick it.
4. Ask "How many loans closed by marketing channel and business?" You get the table and heatmap from 4.1.
5. Ask "What is cost per lead by marketing channel?" You get the refusal from 4.2. The `TOOL_NOT_ACCESSIBLE` warning is shown with the answer.
6. Sign out and sign in as `MARKETING_USER_1`. Same agent, but now marketing questions work and loan questions are refused.

Snowflake Intelligence uses the user's default role, so each user's `DEFAULT_ROLE` decides which semantic views they get. Keep `DEFAULT_SECONDARY_ROLES = ()` on these users. Otherwise someone who holds both roles would get all three views.

### Option B: Snowsight agent playground (what admins should use for testing)

1. In Snowsight, go to **AI & ML → Agents → LOAN_AI_AGENT**.
2. Use the role switcher (bottom-left profile menu) to pick `LOAN_ANALYST_ROLE`, then chat in the agent's preview panel.
3. Switch to `MARKETING_ANALYST_ROLE` and ask the same questions.
4. Open the agent's **Monitoring/Observability** tab to see each run's trace: tools kept, generated SQL and warnings.

Your admin user holds both functional roles. Turn secondary roles off first (`USE SECONDARY ROLES NONE;` in a worksheet, or set `DEFAULT_SECONDARY_ROLES = ()` on your user). Otherwise you'll see all three tools no matter which role you pick.

### Option C: Your own app (REST)

Authenticate each user (OAuth or key-pair), call `POST /api/v2/databases/LOAN_AI_DB/schemas/SEMANTIC/agents/LOAN_AI_AGENT:run`, and either omit `X-Snowflake-Role` (default role is used) or set it to the user's role. Filter `response.warning` events out of what you show users.

### Option D: This app (pick a role or a user, ask, see only that role's answer)

The chat has a **Run as** bar. Pick a role, or a user who holds one, and the agent runs as that role. You get only the answer that role would get, and the bar shows which of the agent's tools the role can reach.

How it works: the app sends the chosen role to Snowflake in the `X-Snowflake-Role` header of `:run`, which is the same mechanism as Option C. The app doesn't filter anything itself.

**1. Turn it on and name the roles** (backend `.env`, then restart). It's off when `RUN_AS_ROLES` is empty, and the browser can only pick roles in this list, so the proxy can never be asked to act as `ACCOUNTADMIN` or any role you didn't name:

```
RUN_AS_ROLES=LOAN_ANALYST_ROLE,MARKETING_ANALYST_ROLE
```

**2. Give the app a way to become each role.** Seen on this account (2026-11-03): the app's token is restricted to `SALES_EVAL_ROLE`, and Snowflake rejects every other role with error 390186, "not permitted for the credentials being used", even for roles granted to that user. A role-restricted token can't switch roles. Two ways to fix it, per role:

| Mode | Setup | Trade-off |
|---|---|---|
| **Own token** (recommended) | A token restricted to that role in `RUN_AS_PAT_<ROLE>` | Least privilege: the proxy can only act as roles you minted a token for |
| **Shared token** | Nothing extra, but `SNOWFLAKE_PAT` must not be role-restricted | One powerful token, so the allowlist is the only guard |

For own tokens, mint each one on the user that holds only that role, so its secondary roles are already off (Section 7):

```sql
USE ROLE ACCOUNTADMIN;
ALTER USER LOAN_USER_1
  ADD PROGRAMMATIC ACCESS TOKEN LOAN_APP_TOKEN
  ROLE_RESTRICTION = 'LOAN_ANALYST_ROLE' DAYS_TO_EXPIRY = 30;
ALTER USER MARKETING_USER_1
  ADD PROGRAMMATIC ACCESS TOKEN MARKETING_APP_TOKEN
  ROLE_RESTRICTION = 'MARKETING_ANALYST_ROLE' DAYS_TO_EXPIRY = 30;
```

> Check this syntax against the current `ALTER USER ... ADD PROGRAMMATIC ACCESS TOKEN` reference before running it. I haven't run it. The token secret is shown once. A network policy on the user may be required.

```
RUN_AS_PAT_LOAN_ANALYST_ROLE=<token for LOAN_USER_1>
RUN_AS_PAT_MARKETING_ANALYST_ROLE=<token for MARKETING_USER_1>
```

If you use the shared token instead, keep `DEFAULT_SECONDARY_ROLES = ()` on its user. Whether secondary roles apply to a `X-Snowflake-Role` call isn't documented, and if they do, a user holding both roles would get all three views.

**3. Use it.** The bar lists each role as available or not (with the reason when it isn't), and lists users under the role they hold. Selecting a user runs as that role. It does not log in as that user unless the token is that user's own, as in step 2.

- Changing the role **starts a new chat**. The thread lives on Snowflake's side, so reusing it would carry one role's data into another role's answers.
- The agent list reloads for the role, because each role sees only the agents it has `USAGE` on.
- Thumbs up/down feedback is sent as the same role.
- The selection is kept in memory only. Reloading the page goes back to the app's default role, so a role can never be left selected on a screen it can't use.
- Below the bar, a chip per tool shows what the role can reach. The app checks this by running `DESCRIBE` on each tool's semantic view or search service as that role, which is the privilege test Snowflake applies before dropping a tool. After an answer, a line lists the tools Snowflake dropped (`TOOL_NOT_ACCESSIBLE`).

Per section 6, the warning text and tool names are for testing. Don't show them to end users.

The database and schema are picked in the app (the bar under **Run as**), not fixed in `.env`. The lists show only what the active role can see: on this account the default role sees `SALES_EVAL_DB`, while `LOAN_ANALYST_ROLE` and `MARKETING_ANALYST_ROLE` see `LOAN_AI_DB`. To use `LOAN_AI_AGENT`, pick a role, then `LOAN_AI_DB` and `SEMANTIC`. `SNOWFLAKE_DATABASE` and `SNOWFLAKE_SCHEMA` in `.env` are now only an optional default.

## 6. Issues found and fixes applied

| Issue | Seen in | Fix (already in the script below) |
|---|---|---|
| 88 closed loans had close dates in the future | 4.1 | The sample data generator now caps `close_date` with `LEAST(..., CURRENT_DATE())` |
| Agent told the user the internal tool name "MarketingAnalyst" | 4.2 | `instructions.response` now forbids tool names and gives the wording to use instead |
| Warning text shows view names to the user | All | Expected in `accept` mode. Hide `response.warning` in custom UIs. In Snowflake Intelligence it's shown with the answer |

The agent caught the future-date issue on its own, without being asked. That's a good sign for the eval work in Section 8.

## 7. Full script

Run top to bottom as `ACCOUNTADMIN`. The script switches roles where it needs to. To re-deploy over the earlier version, the `CREATE OR REPLACE` and `INSERT OVERWRITE` statements make it safe to re-run. If the Snowflake Intelligence object already exists, skip its `CREATE` line in Section 8.

```sql
/* =====================================================================
   Snowflake Cortex Agent: one agent, semantic views resolved by role
   ---------------------------------------------------------------------
   What this script builds (end to end, from nothing):
     - Database LOAN_AI_DB with schemas RAW (tables) and SEMANTIC (views + agent)
     - Sample data: loans, marketing spend, shared dimensions
     - 3 semantic views
         SV_SHARED        -> common dims (business, channel, product)      -> both roles
         SV_LOAN_CHANNEL  -> loans + channel + business                    -> loan role only
         SV_MARKETING     -> campaigns + spend + channel + business        -> marketing role only
     - Roles: LOAN_AI_ADMIN (builder), LOAN_ANALYST_ROLE, MARKETING_ANALYST_ROLE
     - ONE agent LOAN_AI_AGENT with 3 Cortex Analyst tools.
       orchestration.tool_not_accessible = accept, so each caller only gets
       the tools (semantic views) their role has SELECT on.
     - Test users, Snowflake Intelligence publishing, and test queries

   Warehouse: COMPUTE_WH (must already exist)
   Run as:    ACCOUNTADMIN for sections 1, 6, 7, 8; LOAN_AI_ADMIN for 2-5.
              The script switches roles for you. Run top to bottom.
   ===================================================================== */


/* =====================================================================
   SECTION 1: Roles and account-level setup   (ACCOUNTADMIN)
   ===================================================================== */
USE ROLE ACCOUNTADMIN;

SET my_user = CURRENT_USER();

-- Builder / owner role
CREATE ROLE IF NOT EXISTS LOAN_AI_ADMIN
  COMMENT = 'Owns LOAN_AI_DB, semantic views and the Cortex agent';

-- Functional roles for end users
CREATE ROLE IF NOT EXISTS LOAN_ANALYST_ROLE
  COMMENT = 'Loan ops users: shared + loan channel semantic views';
CREATE ROLE IF NOT EXISTS MARKETING_ANALYST_ROLE
  COMMENT = 'Marketing users: shared + marketing semantic views';

-- Keep the hierarchy tidy: custom roles roll up to SYSADMIN
GRANT ROLE LOAN_AI_ADMIN          TO ROLE SYSADMIN;
GRANT ROLE LOAN_ANALYST_ROLE      TO ROLE LOAN_AI_ADMIN;
GRANT ROLE MARKETING_ANALYST_ROLE TO ROLE LOAN_AI_ADMIN;

-- You (the person running this) get the admin role, and both functional
-- roles so you can test them later with USE ROLE.
GRANT ROLE LOAN_AI_ADMIN          TO USER IDENTIFIER($my_user);
GRANT ROLE LOAN_ANALYST_ROLE      TO USER IDENTIFIER($my_user);
GRANT ROLE MARKETING_ANALYST_ROLE TO USER IDENTIFIER($my_user);

-- Admin can create the database
GRANT CREATE DATABASE ON ACCOUNT TO ROLE LOAN_AI_ADMIN;

-- Warehouse
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE LOAN_AI_ADMIN;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE MARKETING_ANALYST_ROLE;

-- Cortex access.
-- CORTEX_USER covers Agents + Analyst. For least privilege you can use
-- SNOWFLAKE.CORTEX_AGENT_USER (+ SNOWFLAKE.CORTEX_ANALYST_USER) instead.
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE LOAN_AI_ADMIN;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE LOAN_ANALYST_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE MARKETING_ANALYST_ROLE;

-- Needed later for Cortex Analyst / Agent evaluations (optional)
GRANT EXECUTE TASK ON ACCOUNT TO ROLE LOAN_AI_ADMIN;


/* =====================================================================
   SECTION 2: Database, schemas, tables   (LOAN_AI_ADMIN)
   ===================================================================== */
USE ROLE LOAN_AI_ADMIN;
USE WAREHOUSE COMPUTE_WH;

CREATE DATABASE IF NOT EXISTS LOAN_AI_DB;
CREATE SCHEMA   IF NOT EXISTS LOAN_AI_DB.RAW;
CREATE SCHEMA   IF NOT EXISTS LOAN_AI_DB.SEMANTIC;

USE SCHEMA LOAN_AI_DB.RAW;

-- ---------- Shared dimensions (used by both roles) ----------
CREATE OR REPLACE TABLE DIM_BUSINESS (
  business_id    NUMBER       PRIMARY KEY,
  business_name  VARCHAR      NOT NULL,
  business_group VARCHAR
);

CREATE OR REPLACE TABLE DIM_MARKETING_CHANNEL (
  channel_id     NUMBER       PRIMARY KEY,
  channel_name   VARCHAR      NOT NULL,
  channel_group  VARCHAR       -- Digital / Offline / Partner
);

CREATE OR REPLACE TABLE DIM_PRODUCT (
  product_id     NUMBER       PRIMARY KEY,
  product_name   VARCHAR      NOT NULL,
  product_type   VARCHAR       -- Secured / Unsecured
);

-- ---------- Loan-only fact ----------
CREATE OR REPLACE TABLE FACT_LOANS (
  loan_id           NUMBER        PRIMARY KEY,
  application_date  DATE          NOT NULL,
  close_date        DATE,                         -- populated only when CLOSED
  loan_status       VARCHAR       NOT NULL,       -- CLOSED / IN_PROGRESS / DECLINED / WITHDRAWN
  loan_amount       NUMBER(12,2)  NOT NULL,
  interest_rate     NUMBER(5,2),
  business_id       NUMBER        REFERENCES DIM_BUSINESS(business_id),
  channel_id        NUMBER        REFERENCES DIM_MARKETING_CHANNEL(channel_id),
  product_id        NUMBER        REFERENCES DIM_PRODUCT(product_id)
);

-- ---------- Marketing-only tables ----------
CREATE OR REPLACE TABLE DIM_CAMPAIGN (
  campaign_id     NUMBER   PRIMARY KEY,
  campaign_name   VARCHAR  NOT NULL,
  start_date      DATE,
  end_date        DATE
);

CREATE OR REPLACE TABLE FACT_CAMPAIGN_SPEND (
  spend_id        NUMBER        PRIMARY KEY,
  spend_date      DATE          NOT NULL,
  campaign_id     NUMBER        REFERENCES DIM_CAMPAIGN(campaign_id),
  channel_id      NUMBER        REFERENCES DIM_MARKETING_CHANNEL(channel_id),
  business_id     NUMBER        REFERENCES DIM_BUSINESS(business_id),
  spend_amount    NUMBER(12,2)  NOT NULL,
  impressions     NUMBER,
  clicks          NUMBER,
  leads           NUMBER
);


/* =====================================================================
   SECTION 3: Sample data   (LOAN_AI_ADMIN)
   ===================================================================== */
INSERT OVERWRITE INTO DIM_BUSINESS VALUES
  (1, 'Retail Lending',      'Consumer'),
  (2, 'Mortgage',            'Consumer'),
  (3, 'Small Business',      'Commercial'),
  (4, 'Auto Finance',        'Consumer');

INSERT OVERWRITE INTO DIM_MARKETING_CHANNEL VALUES
  (1, 'Paid Search',   'Digital'),
  (2, 'Social Media',  'Digital'),
  (3, 'Email',         'Digital'),
  (4, 'Direct Mail',   'Offline'),
  (5, 'Branch Walk-in','Offline'),
  (6, 'Broker',        'Partner');

INSERT OVERWRITE INTO DIM_PRODUCT VALUES
  (1, 'Personal Loan',      'Unsecured'),
  (2, 'Home Loan',          'Secured'),
  (3, 'Business Term Loan', 'Secured'),
  (4, 'Car Loan',           'Secured'),
  (5, 'Credit Line',        'Unsecured');

INSERT OVERWRITE INTO DIM_CAMPAIGN VALUES
  (1, 'Spring Personal Loan Push', DATEADD(month, -10, CURRENT_DATE()), DATEADD(month, -7, CURRENT_DATE())),
  (2, 'Home Buyer Season',         DATEADD(month,  -8, CURRENT_DATE()), DATEADD(month, -4, CURRENT_DATE())),
  (3, 'SMB Growth Q3',             DATEADD(month,  -5, CURRENT_DATE()), DATEADD(month, -2, CURRENT_DATE())),
  (4, 'Festive Auto Offers',       DATEADD(month,  -3, CURRENT_DATE()), CURRENT_DATE());

-- 2,000 synthetic loans over the last 12 months
INSERT OVERWRITE INTO FACT_LOANS
SELECT
  loan_id,
  application_date,
  -- LEAST(...) caps close_date at today, so no closed loan is future-dated
  IFF(loan_status = 'CLOSED',
      LEAST(DATEADD(day, UNIFORM(5, 45, RANDOM()), application_date), CURRENT_DATE()),
      NULL)                                                     AS close_date,
  loan_status,
  loan_amount,
  interest_rate,
  business_id,
  channel_id,
  product_id
FROM (
  SELECT
    SEQ4() + 1                                                  AS loan_id,
    DATEADD(day, -UNIFORM(0, 365, RANDOM()), CURRENT_DATE())    AS application_date,
    CASE
      WHEN UNIFORM(1, 100, RANDOM()) <= 55 THEN 'CLOSED'
      WHEN UNIFORM(1, 100, RANDOM()) <= 50 THEN 'IN_PROGRESS'
      WHEN UNIFORM(1, 100, RANDOM()) <= 60 THEN 'DECLINED'
      ELSE 'WITHDRAWN'
    END                                                         AS loan_status,
    ROUND(UNIFORM(5000, 500000, RANDOM()), -2)                  AS loan_amount,
    ROUND(UNIFORM(650, 1800, RANDOM()) / 100, 2)                AS interest_rate,
    UNIFORM(1, 4, RANDOM())                                     AS business_id,
    UNIFORM(1, 6, RANDOM())                                     AS channel_id,
    UNIFORM(1, 5, RANDOM())                                     AS product_id
  FROM TABLE(GENERATOR(ROWCOUNT => 2000))
);

-- 1,200 synthetic marketing spend rows
INSERT OVERWRITE INTO FACT_CAMPAIGN_SPEND
SELECT
  SEQ4() + 1                                                    AS spend_id,
  DATEADD(day, -UNIFORM(0, 365, RANDOM()), CURRENT_DATE())      AS spend_date,
  UNIFORM(1, 4, RANDOM())                                       AS campaign_id,
  UNIFORM(1, 6, RANDOM())                                       AS channel_id,
  UNIFORM(1, 4, RANDOM())                                       AS business_id,
  ROUND(UNIFORM(500, 25000, RANDOM()), 2)                       AS spend_amount,
  UNIFORM(10000, 500000, RANDOM())                              AS impressions,
  UNIFORM(100, 8000, RANDOM())                                  AS clicks,
  UNIFORM(5, 400, RANDOM())                                     AS leads
FROM TABLE(GENERATOR(ROWCOUNT => 1200));

-- Quick sanity check
SELECT 'FACT_LOANS' AS t, COUNT(*) FROM FACT_LOANS
UNION ALL SELECT 'FACT_CAMPAIGN_SPEND', COUNT(*) FROM FACT_CAMPAIGN_SPEND;


/* =====================================================================
   SECTION 4: Semantic views   (LOAN_AI_ADMIN)
   ===================================================================== */
USE SCHEMA LOAN_AI_DB.SEMANTIC;

-- ---------- 4a. SHARED: common reference data for everyone ----------
CREATE OR REPLACE SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_SHARED
  TABLES (
    business AS LOAN_AI_DB.RAW.DIM_BUSINESS
      PRIMARY KEY (business_id)
      WITH SYNONYMS = ('line of business', 'LOB', 'business unit')
      COMMENT = 'Lines of business',
    channel AS LOAN_AI_DB.RAW.DIM_MARKETING_CHANNEL
      PRIMARY KEY (channel_id)
      WITH SYNONYMS = ('marketing channel', 'acquisition channel', 'source')
      COMMENT = 'Marketing / acquisition channels',
    product AS LOAN_AI_DB.RAW.DIM_PRODUCT
      PRIMARY KEY (product_id)
      WITH SYNONYMS = ('loan product', 'product type')
      COMMENT = 'Loan products'
  )
  DIMENSIONS (
    business.business_name  AS business_name  COMMENT = 'Business line name',
    business.business_group AS business_group COMMENT = 'Consumer or Commercial',
    channel.channel_name    AS channel_name   COMMENT = 'Marketing channel name',
    channel.channel_group   AS channel_group  COMMENT = 'Digital, Offline or Partner',
    product.product_name    AS product_name   COMMENT = 'Product name',
    product.product_type    AS product_type   COMMENT = 'Secured or Unsecured'
  )
  METRICS (
    business.business_count AS COUNT(business.business_id) COMMENT = 'Number of business lines',
    channel.channel_count   AS COUNT(channel.channel_id)   COMMENT = 'Number of marketing channels',
    product.product_count   AS COUNT(product.product_id)   COMMENT = 'Number of products'
  )
  COMMENT = 'Shared reference data: businesses, marketing channels, products';


-- ---------- 4b. LOAN CHANNEL: loan role only ----------
CREATE OR REPLACE SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL
  TABLES (
    loans AS LOAN_AI_DB.RAW.FACT_LOANS
      PRIMARY KEY (loan_id)
      WITH SYNONYMS = ('loan applications', 'loans', 'deals')
      COMMENT = 'One row per loan application',
    business AS LOAN_AI_DB.RAW.DIM_BUSINESS
      PRIMARY KEY (business_id)
      WITH SYNONYMS = ('line of business', 'LOB')
      COMMENT = 'Lines of business',
    channel AS LOAN_AI_DB.RAW.DIM_MARKETING_CHANNEL
      PRIMARY KEY (channel_id)
      WITH SYNONYMS = ('marketing channel', 'acquisition channel')
      COMMENT = 'Marketing / acquisition channel that sourced the loan',
    product AS LOAN_AI_DB.RAW.DIM_PRODUCT
      PRIMARY KEY (product_id)
      COMMENT = 'Loan products'
  )
  RELATIONSHIPS (
    loans_to_business AS loans (business_id) REFERENCES business,
    loans_to_channel  AS loans (channel_id)  REFERENCES channel,
    loans_to_product  AS loans (product_id)  REFERENCES product
  )
  FACTS (
    loans.loan_amount   AS loan_amount   COMMENT = 'Loan amount in USD',
    loans.interest_rate AS interest_rate COMMENT = 'Annual interest rate (percent)'
  )
  DIMENSIONS (
    loans.loan_status      AS loan_status
      WITH SYNONYMS = ('status')
      COMMENT = 'CLOSED (funded), IN_PROGRESS, DECLINED, WITHDRAWN',
    loans.application_date AS application_date COMMENT = 'Date the application was received',
    loans.close_date       AS close_date       COMMENT = 'Date the loan closed/funded; null if not closed',
    loans.close_month      AS DATE_TRUNC('MONTH', loans.close_date) COMMENT = 'Month the loan closed',
    business.business_name AS business_name    COMMENT = 'Business line name',
    channel.channel_name   AS channel_name     COMMENT = 'Marketing channel name',
    channel.channel_group  AS channel_group    COMMENT = 'Digital, Offline or Partner',
    product.product_name   AS product_name     COMMENT = 'Product name'
  )
  METRICS (
    loans.application_count AS COUNT(loans.loan_id)
      COMMENT = 'Total loan applications',
    loans.closed_loan_count AS COUNT_IF(loans.loan_status = 'CLOSED')
      WITH SYNONYMS = ('loans closed', 'funded loans', 'closed loans')
      COMMENT = 'Number of loans with status CLOSED',
    loans.closed_loan_amount AS SUM(IFF(loans.loan_status = 'CLOSED', loans.loan_amount, 0))
      WITH SYNONYMS = ('funded amount', 'closed volume')
      COMMENT = 'Total amount of closed loans',
    loans.close_rate AS DIV0(COUNT_IF(loans.loan_status = 'CLOSED'), COUNT(loans.loan_id))
      WITH SYNONYMS = ('pull-through rate', 'conversion rate')
      COMMENT = 'Closed loans divided by applications',
    loans.avg_interest_rate AS AVG(loans.interest_rate)
      COMMENT = 'Average interest rate'
  )
  COMMENT = 'Loan applications and closed loans by marketing channel, business and product';


-- ---------- 4c. MARKETING: marketing role only ----------
CREATE OR REPLACE SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_MARKETING
  TABLES (
    spend AS LOAN_AI_DB.RAW.FACT_CAMPAIGN_SPEND
      PRIMARY KEY (spend_id)
      WITH SYNONYMS = ('marketing spend', 'campaign spend', 'ad spend')
      COMMENT = 'Daily campaign spend and engagement',
    campaign AS LOAN_AI_DB.RAW.DIM_CAMPAIGN
      PRIMARY KEY (campaign_id)
      COMMENT = 'Marketing campaigns',
    business AS LOAN_AI_DB.RAW.DIM_BUSINESS
      PRIMARY KEY (business_id)
      COMMENT = 'Lines of business',
    channel AS LOAN_AI_DB.RAW.DIM_MARKETING_CHANNEL
      PRIMARY KEY (channel_id)
      COMMENT = 'Marketing channels'
  )
  RELATIONSHIPS (
    spend_to_campaign AS spend (campaign_id) REFERENCES campaign,
    spend_to_business AS spend (business_id) REFERENCES business,
    spend_to_channel  AS spend (channel_id)  REFERENCES channel
  )
  FACTS (
    spend.spend_amount AS spend_amount COMMENT = 'Spend in USD',
    spend.impressions  AS impressions  COMMENT = 'Ad impressions',
    spend.clicks       AS clicks       COMMENT = 'Clicks',
    spend.leads        AS leads        COMMENT = 'Leads generated'
  )
  DIMENSIONS (
    spend.spend_date       AS spend_date                         COMMENT = 'Date of spend',
    spend.spend_month      AS DATE_TRUNC('MONTH', spend.spend_date) COMMENT = 'Month of spend',
    campaign.campaign_name AS campaign_name                      COMMENT = 'Campaign name',
    business.business_name AS business_name                      COMMENT = 'Business line name',
    channel.channel_name   AS channel_name                       COMMENT = 'Marketing channel name',
    channel.channel_group  AS channel_group                      COMMENT = 'Digital, Offline or Partner'
  )
  METRICS (
    spend.total_spend   AS SUM(spend.spend_amount)
      WITH SYNONYMS = ('marketing cost', 'budget spent')
      COMMENT = 'Total marketing spend',
    spend.total_leads   AS SUM(spend.leads)         COMMENT = 'Total leads',
    spend.total_clicks  AS SUM(spend.clicks)        COMMENT = 'Total clicks',
    spend.cost_per_lead AS DIV0(SUM(spend.spend_amount), SUM(spend.leads))
      WITH SYNONYMS = ('CPL')
      COMMENT = 'Spend divided by leads',
    spend.click_through_rate AS DIV0(SUM(spend.clicks), SUM(spend.impressions))
      WITH SYNONYMS = ('CTR')
      COMMENT = 'Clicks divided by impressions'
  )
  COMMENT = 'Marketing campaign spend, leads and efficiency by channel and business';

SHOW SEMANTIC VIEWS IN SCHEMA LOAN_AI_DB.SEMANTIC;


/* =====================================================================
   SECTION 5: The single Cortex Agent   (LOAN_AI_ADMIN)
   ===================================================================== */
CREATE OR REPLACE AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT
  COMMENT = 'Single lending agent. Semantic views available depend on caller role.'
  PROFILE = '{"display_name": "Lending Insights Agent"}'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto

  orchestration:
    tool_not_accessible: accept     # run continues; inaccessible tools are skipped
    budget:
      seconds: 60
      tokens: 16000

  instructions:
    orchestration: >
      Use SharedAnalyst for reference questions about businesses, marketing channels and products.
      Use LoanChannelAnalyst for loan applications, closed (funded) loans, loan amounts,
      close rate, and loan breakdowns by marketing channel, business or product.
      Use MarketingAnalyst for campaign spend, leads, clicks, cost per lead and CTR.
      A loan is "closed" when loan_status = 'CLOSED'.
      If answering needs a tool that is not available to you, tell the user their role
      does not have access to that data. Never estimate or invent numbers.
    response: >
      Be concise. Show results as a table when there is more than one row.
      State the time period used.
      Never mention tool names such as SharedAnalyst, LoanChannelAnalyst or MarketingAnalyst.
      Describe data by its business name instead: "reference data", "loan data",
      "marketing campaign data". When access is missing, say "your role doesn't have
      access to marketing campaign data" (or loan data), not the tool name.
    sample_questions:
      - question: "How many loans closed by marketing channel and business?"
      - question: "What was our close rate by channel last quarter?"
      - question: "What is cost per lead by marketing channel?"

  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "SharedAnalyst"
        description: >
          Shared reference data used by all teams: list of business lines, marketing
          channels and channel groups, and loan products. No loan or spend figures.
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "LoanChannelAnalyst"
        description: >
          Loan application data: application counts, closed/funded loan counts and amounts,
          close rate, interest rate, by marketing channel, business line, product and month.
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "MarketingAnalyst"
        description: >
          Marketing campaign data: spend, impressions, clicks, leads, cost per lead and CTR,
          by campaign, marketing channel, business line and month. No loan outcomes.

  tool_resources:
    SharedAnalyst:
      semantic_view: "LOAN_AI_DB.SEMANTIC.SV_SHARED"
      execution_environment:
        type: "warehouse"
        warehouse: "COMPUTE_WH"
    LoanChannelAnalyst:
      semantic_view: "LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL"
      execution_environment:
        type: "warehouse"
        warehouse: "COMPUTE_WH"
    MarketingAnalyst:
      semantic_view: "LOAN_AI_DB.SEMANTIC.SV_MARKETING"
      execution_environment:
        type: "warehouse"
        warehouse: "COMPUTE_WH"
  $$;

DESCRIBE AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT;


/* =====================================================================
   SECTION 6: Role-based grants   (ACCOUNTADMIN)
   This is the access matrix that decides which semantic views
   (and therefore which agent tools) each role gets.

                          SV_SHARED   SV_LOAN_CHANNEL   SV_MARKETING
   LOAN_ANALYST_ROLE         yes           yes               no
   MARKETING_ANALYST_ROLE    yes           no                yes
   ===================================================================== */
USE ROLE ACCOUNTADMIN;

-- Database + schemas
GRANT USAGE ON DATABASE LOAN_AI_DB          TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON DATABASE LOAN_AI_DB          TO ROLE MARKETING_ANALYST_ROLE;
GRANT USAGE ON SCHEMA   LOAN_AI_DB.RAW      TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON SCHEMA   LOAN_AI_DB.RAW      TO ROLE MARKETING_ANALYST_ROLE;
GRANT USAGE ON SCHEMA   LOAN_AI_DB.SEMANTIC TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON SCHEMA   LOAN_AI_DB.SEMANTIC TO ROLE MARKETING_ANALYST_ROLE;

-- The ONE agent: both roles can use it
GRANT USAGE ON AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT TO ROLE MARKETING_ANALYST_ROLE;

-- ---------- Shared semantic view + shared tables: BOTH roles ----------
GRANT SELECT, REFERENCES ON SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_SHARED TO ROLE LOAN_ANALYST_ROLE;
GRANT SELECT, REFERENCES ON SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_SHARED TO ROLE MARKETING_ANALYST_ROLE;

GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_BUSINESS          TO ROLE LOAN_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_MARKETING_CHANNEL TO ROLE LOAN_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_PRODUCT           TO ROLE LOAN_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_BUSINESS          TO ROLE MARKETING_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_MARKETING_CHANNEL TO ROLE MARKETING_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_PRODUCT           TO ROLE MARKETING_ANALYST_ROLE;

-- ---------- Loan semantic view + loan table: LOAN role only ----------
GRANT SELECT, REFERENCES ON SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL TO ROLE LOAN_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.FACT_LOANS TO ROLE LOAN_ANALYST_ROLE;

-- ---------- Marketing semantic view + marketing tables: MARKETING role only ----------
GRANT SELECT, REFERENCES ON SEMANTIC VIEW LOAN_AI_DB.SEMANTIC.SV_MARKETING TO ROLE MARKETING_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.DIM_CAMPAIGN        TO ROLE MARKETING_ANALYST_ROLE;
GRANT SELECT ON TABLE LOAN_AI_DB.RAW.FACT_CAMPAIGN_SPEND TO ROLE MARKETING_ANALYST_ROLE;

-- Verify the matrix
SHOW GRANTS TO ROLE LOAN_ANALYST_ROLE;
SHOW GRANTS TO ROLE MARKETING_ANALYST_ROLE;


/* =====================================================================
   SECTION 7: Test users   (ACCOUNTADMIN)
   - DEFAULT_ROLE decides which semantic views the agent can use
     when the caller doesn't pick a role.
   - DEFAULT_SECONDARY_ROLES = () stops a user who holds both roles from
     getting all three views through secondary roles.
   Replace the passwords, or switch to SSO / key-pair as per your policy.
   ===================================================================== */
CREATE USER IF NOT EXISTS LOAN_USER_1
  PASSWORD = 'ChangeMe#Loan2026'
  MUST_CHANGE_PASSWORD = TRUE
  DEFAULT_ROLE = LOAN_ANALYST_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH
  DEFAULT_NAMESPACE = 'LOAN_AI_DB.SEMANTIC'
  DEFAULT_SECONDARY_ROLES = ()
  COMMENT = 'Test user: loan analyst';

CREATE USER IF NOT EXISTS MARKETING_USER_1
  PASSWORD = 'ChangeMe#Mktg2026'
  MUST_CHANGE_PASSWORD = TRUE
  DEFAULT_ROLE = MARKETING_ANALYST_ROLE
  DEFAULT_WAREHOUSE = COMPUTE_WH
  DEFAULT_NAMESPACE = 'LOAN_AI_DB.SEMANTIC'
  DEFAULT_SECONDARY_ROLES = ()
  COMMENT = 'Test user: marketing analyst';

GRANT ROLE LOAN_ANALYST_ROLE      TO USER LOAN_USER_1;
GRANT ROLE MARKETING_ANALYST_ROLE TO USER MARKETING_USER_1;


/* =====================================================================
   SECTION 8: Publish the agent in Snowflake Intelligence   (ACCOUNTADMIN)
   One SI object per account, fixed name. If it already exists in your
   account, skip the CREATE and run only the ALTER + GRANTs.
   ===================================================================== */
CREATE SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT;

ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT
  ADD AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT;

GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE LOAN_ANALYST_ROLE;
GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE MARKETING_ANALYST_ROLE;


/* =====================================================================
   SECTION 9: Tests
   You hold both functional roles (granted in Section 1), so you can
   switch with USE ROLE. Make sure secondary roles are off for the test.
   ===================================================================== */
USE SECONDARY ROLES NONE;
USE WAREHOUSE COMPUTE_WH;

-- ---------- 9a. LOAN role ----------
USE ROLE LOAN_ANALYST_ROLE;

-- Direct semantic view query: should work
SELECT * FROM SEMANTIC_VIEW(
  LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL
  METRICS    loans.closed_loan_count, loans.closed_loan_amount
  DIMENSIONS channel.channel_name, business.business_name
)
ORDER BY closed_loan_count DESC;

-- Marketing view: should FAIL with insufficient privileges
-- SELECT * FROM SEMANTIC_VIEW(LOAN_AI_DB.SEMANTIC.SV_MARKETING METRICS spend.total_spend);

-- Agent: loan question -> answered via LoanChannelAnalyst
SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT',
  $${
    "messages": [{"role": "user", "content": [{"type": "text",
      "text": "How many loans closed by marketing channel and business?"}]}],
    "stream": false
  }$$
)) AS loan_role_loan_question;

-- Agent: marketing question -> expect "no access", plus a TOOL_NOT_ACCESSIBLE
-- warning for MarketingAnalyst in the "warnings" array
SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT',
  $${
    "messages": [{"role": "user", "content": [{"type": "text",
      "text": "What is cost per lead by marketing channel?"}]}],
    "stream": false
  }$$
)) AS loan_role_marketing_question;


-- ---------- 9b. MARKETING role ----------
USE ROLE MARKETING_ANALYST_ROLE;

SELECT * FROM SEMANTIC_VIEW(
  LOAN_AI_DB.SEMANTIC.SV_MARKETING
  METRICS    spend.total_spend, spend.total_leads, spend.cost_per_lead
  DIMENSIONS channel.channel_name
)
ORDER BY total_spend DESC;

-- Loan view: should FAIL with insufficient privileges
-- SELECT * FROM SEMANTIC_VIEW(LOAN_AI_DB.SEMANTIC.SV_LOAN_CHANNEL METRICS loans.closed_loan_count);

-- Agent: marketing question -> answered via MarketingAnalyst
SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT',
  $${
    "messages": [{"role": "user", "content": [{"type": "text",
      "text": "What is cost per lead by marketing channel?"}]}],
    "stream": false
  }$$
)) AS mktg_role_marketing_question;

-- Agent: loan question -> expect "no access" + warning for LoanChannelAnalyst
SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT',
  $${
    "messages": [{"role": "user", "content": [{"type": "text",
      "text": "How many loans closed by marketing channel and business?"}]}],
    "stream": false
  }$$
)) AS mktg_role_loan_question;

-- Shared question works for both roles
SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT',
  $${
    "messages": [{"role": "user", "content": [{"type": "text",
      "text": "List all marketing channels and their channel group."}]}],
    "stream": false
  }$$
)) AS mktg_role_shared_question;


/* =====================================================================
   SECTION 10: Cleanup (commented out; run only to tear everything down)
   ===================================================================== */
-- USE ROLE ACCOUNTADMIN;
-- ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT DROP AGENT LOAN_AI_DB.SEMANTIC.LOAN_AI_AGENT;
-- DROP USER IF EXISTS LOAN_USER_1;
-- DROP USER IF EXISTS MARKETING_USER_1;
-- DROP DATABASE IF EXISTS LOAN_AI_DB;
-- DROP ROLE IF EXISTS LOAN_ANALYST_ROLE;
-- DROP ROLE IF EXISTS MARKETING_ANALYST_ROLE;
-- DROP ROLE IF EXISTS LOAN_AI_ADMIN;
```

## 8. Next steps: evals

- **Per semantic view (Cortex Analyst evaluations):** add 5–10 verified queries to each view in the Snowsight editor, keeping eval-only queries separate from runtime ones. Run evals from the view's **Evaluations** tab and track accuracy and regressions.
- **Per agent and role (Cortex Agent evaluations):** create one dataset per role with `ground_truth_invocations`. Loan questions as the loan role should expect `LoanChannelAnalyst`. Cross-role questions should expect `[]` and a "no access" answer. Run the eval once per role, since evals run as the selected Snowsight role. Add a custom `no_leakage` metric that scores whether the other team's data ever shows up.
- **Turn 4.1–4.3 into eval cases** with expected answers (1,004 closed loans after the date fix, the 6 channels, and the refusal), so future changes can't quietly break them.

## Sources

- [Inaccessible tool handling (Snowflake docs)](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-inaccessible-tool-handling)
- [Cortex Agents access control and authentication](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-setup)
- [Cortex Agents Run API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-run)
- [Overview of Snowflake Intelligence](https://docs.snowflake.com/user-guide/snowflake-cortex/snowflake-intelligence)
- [Best practices for semantic views](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
