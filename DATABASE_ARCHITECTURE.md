# PostgreSQL Database Architecture - Normalized Subscription System
## Complete Migration & Implementation Guide

**Date**: February 5, 2026  
**Purpose**: Scale IOD Ghana from Excel-style columns to enterprise-grade relational database  
**Scope**: 20+ years of subscription data (2006–2026+)  

---

## 📋 Table of Contents

1. Problem Analysis
2. Normalized Schema Design
3. CREATE TABLE Statements
4. Migration Strategy
5. Performance Optimization
6. Admin Dashboard Queries
7. Best Practices
8. Implementation Timeline

---

## 🔍 Part 1: Problem Analysis

### Current Problem: Excel-Style Schema

```sql
-- ANTI-PATTERN (Current structure)
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    member_name VARCHAR(255),
    subscription_2016 BOOLEAN,
    subscription_2017 BOOLEAN,
    subscription_2018 BOOLEAN,
    subscription_2019 BOOLEAN,
    -- ... continues to 2026
    subscription_2026 BOOLEAN
);
```

### Problems with This Approach

| Problem | Impact | Example |
|---------|--------|---------|
| **Schema Inflation** | New column every year | Need ALTER TABLE for 2027, 2028... |
| **Query Complexity** | Complex WHERE clauses | `WHERE subscription_2016 OR subscription_2017...` |
| **Null Handling** | Future years = NULL | Can't distinguish "unpaid" from "future" |
| **Reporting Difficulty** | Hard to aggregate | CASE statements for each year |
| **Maintainability** | High manual effort | Code must change each year |
| **Data Integrity** | Boolean isn't enough | Can't track payment dates/amounts |
| **Analytics** | Limited insights | No revenue tracking, payment dates |
| **Scalability** | Breaks at ~50 columns | Excel exported systems hit limits |
| **Storage** | Inefficient | 21 BOOLEAN columns = wasted space |

---

## ✅ Part 2: Normalized Schema Design

### Core Principle: Separate Tables

**Normalization Benefits:**
- ✅ Schema never changes (add years indefinitely)
- ✅ Rich subscription data (dates, amounts, status)
- ✅ Simple, powerful queries
- ✅ ACID compliance
- ✅ Indexing efficiency
- ✅ Easy filtering and reporting

### Proposed Schema

```
MEMBERS TABLE
├── id (Primary Key)
├── membership_number
├── member_type
├── first_name
├── surname
├── organization
├── email
├── created_at
└── updated_at

SUBSCRIPTIONS TABLE
├── id (Primary Key)
├── member_id (Foreign Key → members)
├── subscription_year
├── status (Paid, Pending, Waived, Partial)
├── amount_paid
├── payment_date
├── receipt_number
├── created_at
└── updated_at
```

### Why This Works Better

| Aspect | Excel Model | Normalized Model |
|--------|-------------|------------------|
| **Adding 2027 data** | Alter table | Insert 1000s of rows |
| **Query payment status** | Can't, just boolean | Select with status field |
| **Track payment dates** | Not possible | payment_date column |
| **Revenue analysis** | Not possible | Sum by year/member/type |
| **Audit trail** | Not possible | created_at, updated_at |
| **Future-proof** | No | Yes, indefinitely |

---

## 🗄️ Part 3: Complete CREATE TABLE Statements

### 3.1 Members Table (Unified for All Types)

```sql
-- ============================================================
-- MEMBERS TABLE - Unified for all 5 member categories
-- ============================================================
CREATE TABLE members (
    -- Primary Key
    id SERIAL PRIMARY KEY,
    
    -- Identification
    membership_number VARCHAR(50) UNIQUE NOT NULL,
    member_type VARCHAR(50) NOT NULL CHECK (
        member_type IN ('AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate')
    ),
    
    -- Personal Information (varies by type)
    title VARCHAR(20),
    first_name VARCHAR(100),
    surname VARCHAR(100),                    -- AIOD, Honorary
    last_name VARCHAR(100),                 -- FIOD, MIOD
    other_names VARCHAR(100),
    gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', NULL)),
    date_of_birth DATE,
    
    -- Professional Information
    organization VARCHAR(255) NOT NULL,
    designation VARCHAR(150),               -- AIOD
    position VARCHAR(150),                  -- FIOD, MIOD, Honorary
    sector VARCHAR(100),
    years_served_on_boards INTEGER DEFAULT 0,
    
    -- Location & Contact
    region VARCHAR(100),
    postal_address TEXT,
    phone_number VARCHAR(50),
    email VARCHAR(150) UNIQUE,
    
    -- Dates
    date_of_admission DATE,                 -- AIOD, FIOD, MIOD, Honorary
    registration_date DATE,                 -- Corporate
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    
    -- Audit Columns
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    updated_by VARCHAR(100)
);

-- Indexes for Members (Critical for Performance)
CREATE INDEX idx_members_membership_number ON members(membership_number);
CREATE INDEX idx_members_member_type ON members(member_type);
CREATE INDEX idx_members_organization ON members(organization);
CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_region ON members(region);
CREATE INDEX idx_members_is_active ON members(is_active);
CREATE INDEX idx_members_created_at ON members(created_at);
```

### 3.2 Subscriptions Table (The Key Innovation)

```sql
-- ============================================================
-- SUBSCRIPTIONS TABLE - Handles all years indefinitely
-- ============================================================
CREATE TABLE subscriptions (
    -- Primary Key
    id SERIAL PRIMARY KEY,
    
    -- Foreign Key
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    
    -- Subscription Data
    subscription_year INTEGER NOT NULL CHECK (
        subscription_year >= 2006 AND subscription_year <= 2100
    ),
    
    -- Payment Status (Much more than just TRUE/FALSE)
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (
        status IN ('Paid', 'Pending', 'Partial', 'Waived', 'Expired', 'Cancelled')
    ),
    
    -- Financial Data
    amount_due DECIMAL(10, 2) DEFAULT 0.00,
    amount_paid DECIMAL(10, 2) DEFAULT 0.00,
    payment_date DATE,
    receipt_number VARCHAR(50),
    
    -- Notes & References
    payment_method VARCHAR(50),             -- Cash, Check, Card, Bank Transfer
    reference_number VARCHAR(100),
    notes TEXT,
    
    -- Audit Columns
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    
    -- Constraint: One subscription per member per year
    UNIQUE(member_id, subscription_year)
);

-- Indexes for Subscriptions (Critical for Analytics)
CREATE INDEX idx_subscriptions_member_id ON subscriptions(member_id);
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_payment_date ON subscriptions(payment_date);
CREATE INDEX idx_subscriptions_member_year ON subscriptions(member_id, subscription_year);

-- Compound Index for Common Query: paid by member by year
CREATE INDEX idx_subscriptions_member_paid ON subscriptions(member_id, subscription_year, status);
```

### 3.3 Payment History Table (Optional - For Full Audit Trail)

```sql
-- ============================================================
-- PAYMENT_HISTORY TABLE - Complete audit trail (Optional)
-- ============================================================
CREATE TABLE payment_history (
    id SERIAL PRIMARY KEY,
    
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    
    -- Payment Details
    payment_date DATE NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50),
    receipt_number VARCHAR(50) UNIQUE,
    
    -- Reconciliation
    deposited_date DATE,
    bank_account VARCHAR(50),
    
    -- Notes
    notes TEXT,
    
    -- Audit
    recorded_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_payment_subscription ON payment_history(subscription_id),
    INDEX idx_payment_date ON payment_history(payment_date),
    INDEX idx_payment_receipt ON payment_history(receipt_number)
);
```

### 3.4 Create Triggers for Audit Columns

```sql
-- ============================================================
-- AUTO-UPDATE TIMESTAMPS
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to Members
CREATE TRIGGER members_update_timestamp
    BEFORE UPDATE ON members
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Apply to Subscriptions
CREATE TRIGGER subscriptions_update_timestamp
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
```

### 3.5 Create Useful Views

```sql
-- ============================================================
-- VIEW: Members in Good Standing (Paid Current Year)
-- ============================================================
CREATE VIEW members_good_standing AS
SELECT 
    m.id,
    m.membership_number,
    m.member_type,
    CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) AS full_name,
    m.organization,
    m.email,
    m.region,
    s.subscription_year,
    s.status,
    s.amount_paid,
    s.payment_date
FROM members m
INNER JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
  AND s.status = 'Paid'
  AND m.is_active = TRUE
ORDER BY m.membership_number;

-- ============================================================
-- VIEW: Subscription Summary by Member
-- ============================================================
CREATE VIEW member_subscription_summary AS
SELECT 
    m.id,
    m.membership_number,
    m.member_type,
    CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) AS full_name,
    m.organization,
    COUNT(s.id) AS total_subscriptions,
    COUNT(CASE WHEN s.status = 'Paid' THEN 1 END) AS paid_count,
    COUNT(CASE WHEN s.status IN ('Pending', 'Partial') THEN 1 END) AS unpaid_count,
    MAX(s.subscription_year) AS latest_year,
    MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) AS latest_paid_year,
    SUM(CASE WHEN s.status = 'Paid' THEN s.amount_paid ELSE 0 END) AS total_paid
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
WHERE m.is_active = TRUE
GROUP BY m.id, m.membership_number, m.member_type, m.first_name, 
         m.surname, m.last_name, m.organization
ORDER BY m.membership_number;
```

---

## 📊 Part 4: Migration Strategy

### Phase 1: Preparation (Before Running Queries)

```sql
-- 1. Create new normalized tables (run the CREATE TABLE statements above)

-- 2. Add members from Excel/old system
INSERT INTO members (
    membership_number,
    member_type,
    first_name,
    surname,
    organization,
    email,
    created_at
)
VALUES 
    ('AIOD001', 'AIOD', 'John', 'Smith', 'ABC Corp', 'john@example.com', NOW()),
    ('FIOD001', 'FIOD', 'Jane', 'Doe', 'XYZ Inc', 'jane@example.com', NOW());
    -- ... more members
```

### Phase 2: Migrate Subscription Data from Excel Columns

#### Option A: Direct SQL (If data already in legacy PostgreSQL table)

```sql
-- Assuming old table is: legacy_members with columns:
-- subscription_2016, subscription_2017, ..., subscription_2026

INSERT INTO subscriptions (member_id, subscription_year, status, created_at)
SELECT 
    m.id,
    2016,
    CASE WHEN lm.subscription_2016 = TRUE THEN 'Paid' ELSE 'Pending' END,
    NOW()
FROM legacy_members lm
JOIN members m ON lm.membership_number = m.membership_number
WHERE lm.subscription_2016 IS NOT NULL
UNION ALL
SELECT 
    m.id,
    2017,
    CASE WHEN lm.subscription_2017 = TRUE THEN 'Paid' ELSE 'Pending' END,
    NOW()
FROM legacy_members lm
JOIN members m ON lm.membership_number = m.membership_number
WHERE lm.subscription_2017 IS NOT NULL
-- ... repeat for each year
```

#### Option B: Dynamic SQL for All Years

```sql
-- More elegant: Generate inserts for all years dynamically
DO $$
DECLARE
    year_column TEXT;
    year_num INT;
BEGIN
    FOR year_num IN 2006..2026 LOOP
        year_column := 'subscription_' || year_num;
        
        EXECUTE FORMAT(
            'INSERT INTO subscriptions (member_id, subscription_year, status, created_at)
             SELECT m.id, %L, 
                    CASE WHEN lm.%I = TRUE THEN ''Paid'' ELSE ''Pending'' END,
                    NOW()
             FROM legacy_members lm
             JOIN members m ON lm.membership_number = m.membership_number
             WHERE lm.%I IS NOT NULL
             ON CONFLICT (member_id, subscription_year) DO NOTHING',
            year_num,
            year_column,
            year_column
        );
    END LOOP;
END $$;
```

#### Option C: From Excel File

```bash
# 1. Export Excel to CSV
# members.csv structure:
# membership_number,member_type,first_name,surname,organization,subscription_2016,...,subscription_2026

# 2. Use Python for transformation
```

**Python Migration Script:**

```python
import pandas as pd
import psycopg2
from psycopg2.extras import execute_batch

# Read Excel file
df = pd.read_csv('members.csv')

# Connect to PostgreSQL
conn = psycopg2.connect("dbname=iod_db user=postgres password=6669")
cur = conn.cursor()

# Insert members
members_data = []
subscription_data = []

for idx, row in df.iterrows():
    # Add member
    member_id = None
    cur.execute(
        """INSERT INTO members 
           (membership_number, member_type, first_name, surname, organization)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (membership_number) DO UPDATE SET updated_at = NOW()
           RETURNING id""",
        (row['membership_number'], row['member_type'], 
         row['first_name'], row['surname'], row['organization'])
    )
    member_id = cur.fetchone()[0]
    
    # Process subscriptions for each year
    for year in range(2006, 2027):
        col_name = f'subscription_{year}'
        if col_name in row and pd.notna(row[col_name]):
            subscription_data.append((
                member_id,
                year,
                'Paid' if row[col_name] else 'Pending',
                None  # No payment date in Excel
            ))

# Batch insert subscriptions
execute_batch(
    cur,
    """INSERT INTO subscriptions (member_id, subscription_year, status, payment_date)
       VALUES (%s, %s, %s, %s)
       ON CONFLICT (member_id, subscription_year) DO NOTHING""",
    subscription_data,
    page_size=1000
)

conn.commit()
cur.close()
conn.close()

print(f"Migrated {len(members_data)} members and {len(subscription_data)} subscriptions")
```

### Phase 3: Validation & Verification

```sql
-- Verify migration success
SELECT COUNT(*) as total_members FROM members;
SELECT COUNT(*) as total_subscriptions FROM subscriptions;

-- Check for data integrity
SELECT m.membership_number, COUNT(s.id) as sub_count
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
GROUP BY m.id
ORDER BY sub_count DESC;

-- Verify years are correct
SELECT 
    MIN(subscription_year) as earliest_year,
    MAX(subscription_year) as latest_year,
    COUNT(DISTINCT subscription_year) as year_count
FROM subscriptions;

-- Check status distribution
SELECT status, COUNT(*) as count
FROM subscriptions
GROUP BY status;
```

---

## ⚡ Part 5: Performance Optimization

### 5.1 Index Strategy

```sql
-- ============================================================
-- COMPREHENSIVE INDEX STRATEGY
-- ============================================================

-- Single-column indexes (Quick lookups)
CREATE INDEX idx_members_active ON members(is_active);
CREATE INDEX idx_members_region ON members(region);
CREATE INDEX idx_members_member_type ON members(member_type);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);

-- Composite indexes (Common query patterns)
-- Pattern: Find unpaid subscriptions for 2026 by member
CREATE INDEX idx_subs_year_status ON subscriptions(subscription_year, status);

-- Pattern: Find all subscriptions for a member
CREATE INDEX idx_subs_member ON subscriptions(member_id);

-- Pattern: Find paid subscriptions in a date range
CREATE INDEX idx_subs_payment_date ON subscriptions(payment_date);

-- Partial index (Only active members)
CREATE INDEX idx_members_active_email 
ON members(email) WHERE is_active = TRUE;

-- ============================================================
-- VERIFY INDEX USAGE
-- ============================================================
-- Check which indexes are being used
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Check for unused indexes
SELECT schemaname, tablename, indexname
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### 5.2 Query Optimization Techniques

```sql
-- ============================================================
-- OPTIMIZATION EXAMPLE 1: Lazy JOIN
-- ============================================================

-- SLOW: Returns all columns from both tables
SELECT m.*, s.*
FROM members m
JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year = 2026;

-- FAST: Only needed columns
SELECT 
    m.id, m.membership_number, m.organization, m.email,
    s.subscription_year, s.status, s.amount_paid
FROM members m
JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year = 2026;

-- ============================================================
-- OPTIMIZATION EXAMPLE 2: EXPLAIN ANALYZE
-- ============================================================

-- Always check query plans for production queries:
EXPLAIN ANALYZE
SELECT m.membership_number, COUNT(*) as paid_subscriptions
FROM members m
JOIN subscriptions s ON m.id = s.member_id
WHERE s.status = 'Paid'
GROUP BY m.id
ORDER BY paid_subscriptions DESC;

-- Look for:
-- - Seq Scans (bad) → Need indexes
-- - High execution time → Query redesign
-- - Memory usage → Add LIMIT or aggregate earlier

-- ============================================================
-- OPTIMIZATION EXAMPLE 3: Aggregation Efficiency
-- ============================================================

-- Use filtering BEFORE aggregation
SELECT 
    m.member_type,
    s.subscription_year,
    COUNT(*) as member_count,
    SUM(CASE WHEN s.status = 'Paid' THEN 1 ELSE 0 END) as paid_count
FROM members m
INNER JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year >= 2024      -- Filter first!
GROUP BY m.member_type, s.subscription_year;

-- ============================================================
-- OPTIMIZATION EXAMPLE 4: Materialized Views (Pre-calculated)
-- ============================================================

-- For dashboard that runs frequently, pre-calculate:
CREATE MATERIALIZED VIEW dashboard_summary AS
SELECT 
    EXTRACT(YEAR FROM CURRENT_DATE) as current_year,
    (SELECT COUNT(*) FROM members WHERE is_active) as total_active_members,
    (SELECT COUNT(*) FROM subscriptions 
     WHERE subscription_year = EXTRACT(YEAR FROM CURRENT_DATE) 
     AND status = 'Paid') as paid_this_year,
    (SELECT COUNT(*) FROM subscriptions 
     WHERE subscription_year = EXTRACT(YEAR FROM CURRENT_DATE) 
     AND status IN ('Pending', 'Partial')) as unpaid_this_year,
    (SELECT SUM(amount_paid) FROM subscriptions 
     WHERE subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)) as revenue_this_year;

-- Refresh daily/weekly
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_summary;

-- ============================================================
-- OPTIMIZATION EXAMPLE 5: Pagination for Large Results
-- ============================================================

-- WITHOUT pagination (loads 100K rows into memory)
SELECT * FROM members ORDER BY created_at DESC;

-- WITH pagination (loads 100 rows at a time)
SELECT * FROM members 
ORDER BY created_at DESC 
LIMIT 100 OFFSET 0;  -- Page 1

SELECT * FROM members 
ORDER BY created_at DESC 
LIMIT 100 OFFSET 100;  -- Page 2
```

### 5.3 Connection Pooling (For Web Apps)

```python
# Use PgBouncer or psycopg2 connection pool
from psycopg2 import pool

# Create connection pool (reuse connections, don't create new ones)
db_pool = pool.SimpleConnectionPool(
    1,           # minconn
    20,          # maxconn
    dbname="iod_db",
    user="postgres",
    password="6669",
    host="localhost"
)

# Use from pool
conn = db_pool.getconn()
cur = conn.cursor()
# ... execute queries ...
db_pool.putconn(conn)
```

---

## 📈 Part 6: Admin Dashboard Queries

### 6.1 Key Dashboard Metrics

```sql
-- ============================================================
-- DASHBOARD METRIC 1: Current Year Overview
-- ============================================================
SELECT 
    EXTRACT(YEAR FROM CURRENT_DATE) as year,
    COUNT(DISTINCT m.id) as total_members,
    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as members_paid,
    COUNT(DISTINCT CASE WHEN s.status IN ('Pending', 'Partial') THEN m.id END) as members_unpaid,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
        / NULLIF(COUNT(DISTINCT m.id), 0), 2) as payment_rate_percent,
    SUM(CASE WHEN s.status = 'Paid' THEN s.amount_paid ELSE 0 END) as total_revenue,
    ROUND(AVG(CASE WHEN s.status = 'Paid' THEN s.amount_paid ELSE NULL END), 2) as avg_payment
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id 
    AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE m.is_active = TRUE;

-- Result Example:
-- year | total_members | members_paid | members_unpaid | payment_rate | total_revenue | avg_payment
-- 2026 |     1500      |      1350    |      150       |    90.00%    |   $202,500    |   $150.00

-- ============================================================
-- DASHBOARD METRIC 2: Paid vs Unpaid by Member Type
-- ============================================================
SELECT 
    m.member_type,
    COUNT(DISTINCT m.id) as total_members,
    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_members,
    COUNT(DISTINCT CASE WHEN s.status != 'Paid' THEN m.id END) as unpaid_members,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
        / NULLIF(COUNT(DISTINCT m.id), 0), 2) as paid_percent
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id 
    AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE m.is_active = TRUE
GROUP BY m.member_type
ORDER BY paid_percent DESC;

-- Result Example:
-- member_type | total | paid | unpaid | paid_percent
-- FIOD        |  400  | 390  |   10   |   97.50%
-- Corporate   |  200  | 190  |   10   |   95.00%
-- MIOD        |  600  | 540  |   60   |   90.00%
-- AIOD        |  250  | 220  |   30   |   88.00%
-- Honorary    |   50  |  10  |   40   |   20.00%

-- ============================================================
-- DASHBOARD METRIC 3: Yearly Trend (Revenue Over Time)
-- ============================================================
SELECT 
    s.subscription_year,
    COUNT(DISTINCT m.id) as members_count,
    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_members,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
        / COUNT(DISTINCT m.id), 2) as payment_rate,
    SUM(s.amount_paid) as total_revenue
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
WHERE m.is_active = TRUE
GROUP BY s.subscription_year
ORDER BY s.subscription_year DESC
LIMIT 10;

-- Result Example (Last 10 years):
-- year | members | paid | rate  | revenue
-- 2026 |  1500   | 1350 | 90.0% | $202,500
-- 2025 |  1480   | 1332 | 90.0% | $199,800
-- 2024 |  1420   | 1278 | 90.0% | $191,700
-- ...

-- ============================================================
-- DASHBOARD METRIC 4: Unpaid Subscriptions (Action List)
-- ============================================================
SELECT 
    m.membership_number,
    m.member_type,
    CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) as member_name,
    m.organization,
    m.email,
    m.phone_number,
    s.subscription_year,
    s.status,
    CASE 
        WHEN s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE) THEN 'CURRENT'
        WHEN s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE) - 1 THEN '1 YEAR OVERDUE'
        ELSE CONCAT(EXTRACT(YEAR FROM CURRENT_DATE) - s.subscription_year, ' YEARS OVERDUE')
    END as overdue_status,
    COALESCE(s.amount_due, 0) - COALESCE(s.amount_paid, 0) as amount_owed
FROM members m
JOIN subscriptions s ON m.id = s.member_id
WHERE m.is_active = TRUE
  AND s.status IN ('Pending', 'Partial')
ORDER BY 
    s.subscription_year DESC,
    s.status DESC;

-- Result Example:
-- mem# | type | name | org | email | year | status | overdue_status | owed
-- A001 | AIOD | John | ABC | j@.. | 2026 | Pending | CURRENT | $150.00
-- F005 | FIOD | Jane | XYZ | j@.. | 2025 | Partial | 1 YEAR OVERDUE | $50.00
-- C002 | Corp | Bob  | Inc | b@.. | 2024 | Pending | 2 YEARS OVERDUE | $150.00

-- ============================================================
-- DASHBOARD METRIC 5: Regional Performance
-- ============================================================
SELECT 
    COALESCE(m.region, 'Unknown') as region,
    COUNT(DISTINCT m.id) as total_members,
    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_members,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
        / COUNT(DISTINCT m.id), 2) as payment_rate,
    SUM(CASE WHEN s.status = 'Paid' THEN s.amount_paid ELSE 0 END) as region_revenue
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id 
    AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE m.is_active = TRUE
GROUP BY m.region
ORDER BY region_revenue DESC;

-- Result Example:
-- region | members | paid | rate | revenue
-- Greater Accra | 800 | 760 | 95.0% | $114,000
-- Ashanti | 400 | 360 | 90.0% | $54,000
-- Western | 200 | 180 | 90.0% | $27,000
-- ...

-- ============================================================
-- DASHBOARD METRIC 6: Payment Method Breakdown (if tracked)
-- ============================================================
SELECT 
    s.payment_method,
    COUNT(*) as transactions,
    SUM(s.amount_paid) as total_paid,
    ROUND(AVG(s.amount_paid), 2) as avg_payment
FROM subscriptions s
WHERE s.payment_date >= CURRENT_DATE - INTERVAL '1 year'
  AND s.status = 'Paid'
GROUP BY s.payment_method
ORDER BY total_paid DESC;

-- ============================================================
-- DASHBOARD METRIC 7: Member Growth Over Time
-- ============================================================
SELECT 
    DATE_TRUNC('month', created_at)::DATE as month,
    COUNT(*) as new_members,
    SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', created_at)) as cumulative
FROM members
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC
LIMIT 12;
```

### 6.2 Advanced Analytics Queries

```sql
-- ============================================================
-- CHURN ANALYSIS: Who stopped paying?
-- ============================================================
SELECT 
    m.membership_number,
    m.member_type,
    CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) as member_name,
    MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) as last_paid_year,
    EXTRACT(YEAR FROM CURRENT_DATE) - MAX(CASE WHEN s.status = 'Paid' 
        THEN s.subscription_year END) as years_since_paid
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
WHERE m.is_active = TRUE
GROUP BY m.id
HAVING MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) < EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY years_since_paid DESC;

-- ============================================================
-- COHORT ANALYSIS: Compare payment rates by join year
-- ============================================================
SELECT 
    EXTRACT(YEAR FROM m.date_of_admission) as cohort_year,
    EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM m.date_of_admission) as years_as_member,
    COUNT(*) as cohort_size,
    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_in_latest,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
        / COUNT(*), 2) as payment_rate
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id 
    AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE m.is_active = TRUE
GROUP BY EXTRACT(YEAR FROM m.date_of_admission)
ORDER BY cohort_year DESC;

-- ============================================================
-- REVENUE FORECAST: Project next year revenue
-- ============================================================
WITH recent_trends AS (
    SELECT 
        s.subscription_year,
        SUM(CASE WHEN s.status = 'Paid' THEN s.amount_paid ELSE 0 END) as yearly_revenue,
        COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_members
    FROM members m
    JOIN subscriptions s ON m.id = s.member_id
    WHERE m.is_active = TRUE
      AND s.subscription_year >= EXTRACT(YEAR FROM CURRENT_DATE) - 3
    GROUP BY s.subscription_year
)
SELECT 
    subscription_year,
    yearly_revenue,
    paid_members,
    ROUND(yearly_revenue / paid_members, 2) as avg_per_member,
    (SELECT yearly_revenue FROM recent_trends ORDER BY subscription_year DESC LIMIT 1) 
        as latest_revenue,
    ROUND(
        (SELECT yearly_revenue FROM recent_trends ORDER BY subscription_year DESC LIMIT 1) * 1.05,
        2
    ) as forecasted_revenue_5pct_growth
FROM recent_trends
ORDER BY subscription_year;
```

---

## 🎯 Part 7: Best Practices for Admin-Only Dashboards

### 7.1 Performance Best Practices

```sql
-- ✅ DO: Use efficient data types
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,           -- SERIAL, not UUID (faster)
    member_id INTEGER NOT NULL,      -- INT, not BIGINT (smaller index)
    subscription_year SMALLINT,      -- SMALLINT (2 bytes), not INT (4 bytes)
    status VARCHAR(20),              -- VARCHAR(20), not TEXT
    amount_paid DECIMAL(10, 2)       -- Fixed precision for money
);

-- ✅ DO: Partition large tables by year
CREATE TABLE subscriptions_2024 PARTITION OF subscriptions
    FOR VALUES FROM (2024) TO (2025);

CREATE TABLE subscriptions_2025 PARTITION OF subscriptions
    FOR VALUES FROM (2025) TO (2026);

CREATE TABLE subscriptions_2026 PARTITION OF subscriptions
    FOR VALUES FROM (2026) TO (2027);

-- ✅ DO: Use MATERIALIZED VIEWs for frequent reports
CREATE MATERIALIZED VIEW dashboard_metrics AS
SELECT ... (expensive calculations);

-- Refresh on schedule
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_metrics;

-- ✅ DO: Cache results in application
-- Don't query database on every page load
# In Django/Flask:
cache.set('dashboard_metrics', query_result, timeout=3600)  # 1 hour
```

### 7.2 Security Best Practices

```sql
-- ✅ DO: Create readonly admin role
CREATE ROLE admin_readonly WITH LOGIN PASSWORD 'secure_password';

-- Grant only SELECT on relevant tables
GRANT SELECT ON members, subscriptions TO admin_readonly;
GRANT SELECT ON dashboard_summary TO admin_readonly;

-- Deny access to sensitive columns
CREATE POLICY hide_internal_columns ON members
    FOR SELECT
    USING (current_user = 'admin_user');

-- ✅ DO: Log admin access
CREATE TABLE admin_audit_log (
    id SERIAL PRIMARY KEY,
    admin_user VARCHAR(100),
    action VARCHAR(100),
    table_name VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ✅ DO: Use parameterized queries (ALWAYS)
-- Bad (SQL injection risk):
EXECUTE "SELECT * FROM members WHERE email = '" + user_input + "'";

-- Good (safe):
EXECUTE "SELECT * FROM members WHERE email = $1" USING user_email;
```

### 7.3 UX Best Practices

```sql
-- ✅ DO: Provide quick filters
-- Add indexed columns for common filters:
-- - subscription_year (for "current year" filter)
-- - status (for "paid/unpaid" filter)
-- - region (for "regional view")
-- - member_type (for "by category")

-- ✅ DO: Precompute heavy calculations
-- Don't calculate on-the-fly in dashboard
-- Store key metrics in materialized views or cache

-- ✅ DO: Provide "at a glance" numbers
-- Example dashboard layout:
-- [Total Members: 1500] [Paid: 1350] [Unpaid: 150] [Revenue: $202.5K]
--
-- Top performers:
-- - FIOD: 97.5% payment rate
-- - Corporate: 95.0% payment rate
--
-- Collections needed:
-- [List of 150 unpaid members with link to detail]
--
-- Trends:
-- [Chart showing revenue over 10 years]
--
-- By region:
-- [Sortable table by payment rate]

-- ✅ DO: Lazy-load detailed views
-- Main dashboard: Summary only
-- Click on member: Detail page (separate query)

-- ✅ DO: Provide export functionality
SELECT * FROM subscriptions 
WHERE subscription_year = 2026 
AND status = 'Paid'
-- (Export to CSV for Excel/sharing)
```

### 7.4 Data Integrity Best Practices

```sql
-- ✅ DO: Enforce constraints
ALTER TABLE subscriptions 
ADD CONSTRAINT check_amounts 
CHECK (amount_due >= 0 AND amount_paid >= 0 AND amount_paid <= amount_due);

-- ✅ DO: Use transactions for related updates
BEGIN TRANSACTION;
    UPDATE subscriptions SET status = 'Paid' WHERE id = 123;
    INSERT INTO payment_history (subscription_id, amount_paid, payment_date) 
    VALUES (123, 150.00, CURRENT_DATE);
COMMIT;

-- ✅ DO: Create archive tables for historical data
CREATE TABLE subscriptions_archive AS 
SELECT * FROM subscriptions WHERE subscription_year < 2010;

-- ✅ DO: Regular backups
-- PostgreSQL backup command:
pg_dump -U postgres -d iod_db > backup_$(date +%Y%m%d).sql
```

---

## 🚀 Part 8: Implementation Timeline

### Week 1: Planning & Design ✅
- [x] Analyze current Excel structure
- [x] Design normalized schema
- [x] Plan migration strategy
- [x] Get stakeholder approval

### Week 2: Development (Database)
- [ ] Create PostgreSQL tables
- [ ] Create indexes
- [ ] Create views
- [ ] Set up triggers

### Week 3: Migration
- [ ] Extract data from Excel/legacy system
- [ ] Run migration scripts
- [ ] Validate data integrity
- [ ] Parallel run (old & new system)

### Week 4: Dashboard Development
- [ ] Build queries for admin dashboard
- [ ] Create materialized views
- [ ] Develop admin UI
- [ ] Add filters and exports

### Week 5: Testing & Optimization
- [ ] Performance testing
- [ ] Load testing
- [ ] Security testing
- [ ] User acceptance testing

### Week 6: Deployment & Training
- [ ] Deploy to production
- [ ] Set up monitoring
- [ ] Train admin users
- [ ] Decommission old system

---

## 📋 Comparison: Excel vs Normalized

| Aspect | Excel-Style | Normalized |
|--------|-------------|-----------|
| **Add 2027 data** | ALTER TABLE | INSERT rows |
| **Query all paid members** | Complex CASE | Simple WHERE |
| **Payment history** | Not possible | Full audit trail |
| **Revenue by year** | Manual calculation | Aggregate query |
| **Reporting** | Excel formulas | SQL queries |
| **Performance** | Slow (full scan) | Fast (indexed) |
| **Scalability** | 2030 → schema breaks | Indefinite |
| **Maintenance** | High | Low |
| **Data integrity** | Poor | ACID guarantees |

---

## 🎓 Key Takeaways

1. **One subscription per year, per member** → Not column per year
2. **Rich status field** → Not just TRUE/FALSE
3. **Audit columns** → Track who changed what when
4. **Proper indexes** → Query performance
5. **Materialized views** → Dashboard performance
6. **Parameterized queries** → Security
7. **Archive old data** → Faster queries on active data
8. **Plan for growth** → Think 30 years ahead, not 3

---

## 📞 Questions to Consider

Before implementation:

1. **Payment history**: Do you need to track every payment, or just final status?
2. **Partial payments**: How often do members pay in installments?
3. **Late fees**: Do you charge interest on overdue subscriptions?
4. **Discounts**: Do some members get special rates?
5. **Waived**: Which members' subscriptions are waived and why?
6. **Archive**: How far back do you need active data (20 years is fine)?
7. **Users**: How many admins will access simultaneously?
8. **Reporting**: What ad-hoc reports do you need?

---

## 🔗 Next Steps

1. **Review schema** with your team
2. **Estimate data volume** (affects indexing strategy)
3. **Identify critical dashboards** (affects materialized views)
4. **Plan migration** (test on sample data first)
5. **Set up monitoring** (query performance, backup status)
6. **Train admins** (new dashboard queries)

---

**Questions? This design scales to:**
- ✅ 100,000 members
- ✅ 50 years of data
- ✅ Multiple payment methods
- ✅ Complex reporting requirements

Good luck with your migration!
