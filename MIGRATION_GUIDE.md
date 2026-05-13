# Migration Guide: Unified Members Database Schema

## Overview
This guide walks you through migrating from the separate member type tables (AIOD, FIOD, MIOD, Honorary, Corporate) to a unified `members` and `subscriptions` schema.

## Files Created

1. **database_schema_new.sql** - New unified database schema
2. **migration.sql** - Data migration script to move existing data
3. **server_new.js** - New unified API server
4. **index_new.html** - New unified frontend interface

## Implementation Steps

### Step 1: Backup Current Database

```sql
-- Create backup of current database
pg_dump -U postgres -d postgres > backup_$(date +%Y%m%d).sql
```

### Step 2: Create New Schema

Run the `database_schema_new.sql` file:

```sql
\i 'database_schema_new.sql'
```

This will create:
- `members` table (unified table for all member types)
- `subscriptions` table (unified subscriptions)
- Indexes for performance
- Views and functions for reporting

### Step 3: Migrate Data

Run the `migration.sql` file to move data from old tables to new schema:

```sql
\i 'migration.sql'
```

This will:
1. Copy all AIOD members
2. Copy all FIOD members  
3. Copy all MIOD members
4. Copy all Honorary members
5. Copy all Corporate members
6. Copy all subscriptions with proper member_id references
7. Verify the migration was successful

### Step 4: Verify Migration

```sql
-- Check member counts by type
SELECT member_type, COUNT(*) as count
FROM members
GROUP BY member_type;

-- Check subscription counts
SELECT COUNT(*) as total_subscriptions FROM subscriptions;

-- View sample members with subscriptions
SELECT 
    m.membership_number,
    m.member_type,
    COALESCE(m.first_name || ' ' || COALESCE(m.surname, m.last_name), '') as full_name,
    ARRAY_AGG(s.subscription_year ORDER BY s.subscription_year DESC) as subscriptions
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
GROUP BY m.id
LIMIT 10;
```

### Step 5: Update Backend

1. Replace `server.js` with `server_new.js`:
   ```bash
   cp server.js server_old.js
   cp server_new.js server.js
   ```

2. Restart the server:
   ```bash
   node server.js
   ```

### Step 6: Update Frontend

1. Replace `index.html` with `index_new.html`:
   ```bash
   cp index.html index_old.html
   cp index_new.html index.html
   ```

2. Refresh your browser

### Step 7: Test the System

1. **View Members**: All member types should display together
2. **Filter by Member Type**: Use the dropdown to filter by AIOD, FIOD, MIOD, Honorary, or Corporate
3. **Add New Member**: Create a new member and verify it works for all types
4. **Edit Member**: Modify an existing member
5. **Delete Member**: Remove a member
6. **Sort & Filter**: Test sorting and filtering by various columns

## API Endpoints

### Unified Members Endpoints

```
GET /api/members                    - Get all members
GET /api/members?member_type=AIOD   - Get members by type
GET /api/members/:id                - Get single member
POST /api/members                   - Create new member
PUT /api/members/:id                - Update member
DELETE /api/members/:id             - Delete member
```

### Subscriptions Endpoints

```
GET /api/members/:id/subscriptions               - Get subscriptions for member
POST /api/members/:id/subscriptions              - Add subscription
PUT /api/subscriptions/:id                       - Update subscription
DELETE /api/subscriptions/:id                    - Delete subscription
```

### Statistics Endpoints

```
GET /api/statistics/members         - Get member statistics by type
GET /api/good-standing/:year        - Get members in good standing for year
```

## Database Schema

### Members Table

```sql
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    membership_number TEXT UNIQUE NOT NULL,
    member_type VARCHAR(50) NOT NULL,  -- AIOD, FIOD, MIOD, Honorary, Corporate
    title VARCHAR(20),
    first_name VARCHAR(100),
    surname VARCHAR(100),             -- For AIOD
    last_name VARCHAR(100),           -- For FIOD, MIOD, Honorary
    other_names VARCHAR(100),
    membership_category VARCHAR(50),  -- For Corporate: Gold, Silver, Bronze, Standard
    gender VARCHAR(10),
    organization VARCHAR(255) NOT NULL,
    designation VARCHAR(150),         -- For AIOD
    position VARCHAR(150),            -- For FIOD, MIOD, Honorary
    sector VARCHAR(100),
    region VARCHAR(100),
    postal_address TEXT,
    date_of_admission DATE,           -- For individual members
    registration_date DATE,           -- For Corporate
    phone_number VARCHAR(50),
    email TEXT,
    feedback_on_calls TEXT,
    years_served_on_boards INTEGER DEFAULT 0,
    srl_no INTEGER UNIQUE,            -- For Corporate
    reg_no VARCHAR(50) UNIQUE,        -- For Corporate
    contact_person VARCHAR(150),      -- For Corporate
    contact_phone VARCHAR(50),        -- For Corporate
    contact_email VARCHAR(150),       -- For Corporate
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Subscriptions Table

```sql
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    subscription_year INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'Paid',  -- Paid, Pending, Partial, Waived
    payment_date DATE,
    amount_paid DECIMAL(10, 2),
    receipt_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (member_id, subscription_year)
);
```

## Key Changes from Old Schema

1. **Unified Table**: All member types now in single `members` table with `member_type` field
2. **Flexible Fields**: Table has fields for all member types (AIOD, FIOD, MIOD, Honorary, Corporate)
3. **Simplified Subscriptions**: Single `subscriptions` table instead of separate tables
4. **Member Type Support**: member_type can be 'AIOD', 'FIOD', 'MIOD', 'Honorary', or 'Corporate'
5. **Default Subscriptions**: Subscription year defaults to admission/registration year on member creation

## Frontend Features

- Single unified table showing all member types
- Filter by member type (AIOD, FIOD, MIOD, Honorary, Corporate)
- Search by name, membership number, or organization
- Filter by subscription year
- Sort by any column (with special handling for dates)
- Add, edit, delete members
- Modal forms that adapt based on member type

## Rollback Plan

If you need to rollback:

1. Stop the server
2. Restore from backup:
   ```sql
   psql -U postgres -d postgres < backup_YYYYMMDD.sql
   ```
3. Restore old `server.js` and `index.html` files
4. Restart the server

## Notes

- The migration script uses `ON CONFLICT DO NOTHING` to handle any duplicate keys gracefully
- All old tables can be dropped after verifying migration success: `DROP TABLE aiod, aiod_subscriptions, fiod, fiod_subscriptions, etc.`
- Views and functions are recreated with the new unified structure
- All timestamps (created_at, updated_at) are preserved during migration

## Support

For issues:
1. Check the verification queries in migration.sql
2. Compare record counts between old and new tables
3. Check API responses in browser console
4. Review server logs for errors

