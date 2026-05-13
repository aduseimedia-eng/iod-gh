# Database Architecture Quick Reference
## Excel-to-PostgreSQL Normalization Guide

---

## 🎯 The Problem & Solution

### Old Way (Excel-Style) ❌
```
Members Table:
ID | Name | Org | Sub_2016 | Sub_2017 | Sub_2018 | ... | Sub_2026
1  | John | ABC | TRUE     | TRUE     | FALSE    | ... | TRUE
```
**Problems**: Adding 2027 requires new column, boolean doesn't show payment dates/amounts

### New Way (Normalized) ✅
```
Members Table:
ID | Name | Org
1  | John | ABC

Subscriptions Table:
ID | Member_ID | Year | Status  | Amount | Payment_Date
1  | 1         | 2016 | Paid    | 150.00 | 2016-03-15
2  | 1         | 2017 | Paid    | 150.00 | 2017-03-20
3  | 1         | 2018 | Pending | NULL   | NULL
```
**Benefits**: Add any year without changing schema, track payment dates/amounts

---

## 📋 Schema at a Glance

### Members Table
```sql
id (PK) | membership_number (UNIQUE) | member_type | first_name | 
surname | organization | email | region | created_at | updated_at
```

### Subscriptions Table
```sql
id (PK) | member_id (FK) | subscription_year | status | amount_paid | 
payment_date | receipt_number | created_at | updated_at
(UNIQUE on member_id + subscription_year)
```

### Key Relationships
```
members (1) ──── (many) subscriptions
  (via member_id foreign key)
```

---

## 🚀 Quick Start: 3 Steps

### Step 1: Create Tables (5 minutes)
```sql
-- See DATABASE_ARCHITECTURE.md Part 3
-- Run CREATE TABLE statements
```

### Step 2: Migrate Data (30 minutes)
```bash
# From Excel
python3 migrate_excel_to_postgres.py

# Verify
SELECT COUNT(*) FROM members;  -- Should match
SELECT COUNT(*) FROM subscriptions;  -- 21x members (roughly)
```

### Step 3: Test Dashboard
```sql
-- See DATABASE_ARCHITECTURE.md Part 6
-- Run sample dashboard queries
```

---

## ⚡ Essential Queries

### How many members paid in 2026?
```sql
SELECT COUNT(DISTINCT member_id)
FROM subscriptions
WHERE subscription_year = 2026 AND status = 'Paid';
```

### Revenue by year (last 5 years)
```sql
SELECT 
    subscription_year,
    SUM(amount_paid) as revenue,
    COUNT(*) as paid_members
FROM subscriptions
WHERE status = 'Paid' AND subscription_year >= 2022
GROUP BY subscription_year
ORDER BY subscription_year DESC;
```

### Who hasn't paid in 2 years?
```sql
SELECT m.*, MAX(s.subscription_year) as last_paid
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id AND s.status = 'Paid'
GROUP BY m.id
HAVING MAX(s.subscription_year) < 2024;
```

### Good standing members (paid current year)
```sql
SELECT m.*
FROM members m
INNER JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year = 2026 AND s.status = 'Paid';
```

---

## 🔍 Common Questions Answered

### Q: Where is 2027 data stored?
**A:** Same subscriptions table - no schema change needed!
```sql
INSERT INTO subscriptions (member_id, subscription_year, status)
VALUES (1, 2027, 'Pending');
```

### Q: How do I track partial payments?
**A:** status column handles it
```sql
UPDATE subscriptions 
SET status = 'Partial', amount_paid = 75.00 
WHERE member_id = 1 AND subscription_year = 2026;
```

### Q: Can I see payment history?
**A:** Yes, if using payment_history table (optional)
```sql
SELECT * FROM payment_history
WHERE subscription_id = 123
ORDER BY payment_date DESC;
```

### Q: How do I find defaulters?
**A:** Simple WHERE clause
```sql
SELECT m.* FROM members m
JOIN subscriptions s ON m.id = s.member_id
WHERE s.subscription_year = 2026 AND s.status NOT IN ('Paid', 'Waived');
```

---

## 📊 Performance Tips

### Indexes You MUST Have
```sql
-- Lookup member quickly
CREATE INDEX idx_members_membership_number ON members(membership_number);

-- Find member's subscriptions quickly
CREATE INDEX idx_subscriptions_member_id ON subscriptions(member_id);

-- Filter by year quickly
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);
```

### Queries That Are Fast
- Find member by number: < 1ms
- Find all subscriptions for member: < 5ms
- Count paid by year: < 100ms
- Full analytics query: < 500ms

### Queries That Are Slow (And How to Fix)
| Slow Query | Issue | Fix |
|-----------|-------|-----|
| `SELECT *` | Gets all columns | Select only needed columns |
| `LEFT JOIN` on unindexed column | Full table scan | Add index |
| Nested SELECT in WHERE | Repeats query | Use JOIN or IN |

---

## 🛡️ Data Integrity Checks

### Run These After Migration
```sql
-- Check duplicates (should be 0)
SELECT membership_number FROM members GROUP BY membership_number HAVING COUNT(*) > 1;

-- Check orphaned records (should be 0)
SELECT COUNT(*) FROM subscriptions WHERE member_id NOT IN (SELECT id FROM members);

-- Check year range (should be 2006-2026)
SELECT MIN(subscription_year), MAX(subscription_year) FROM subscriptions;

-- Check status values (only valid values)
SELECT DISTINCT status FROM subscriptions;
```

---

## 🔄 Comparing Old vs New

| Operation | Old Schema | New Schema |
|-----------|-----------|-----------|
| **Add 2027 data** | ALTER TABLE (structural change) | INSERT rows (data change) |
| **Query all paid members** | CASE WHEN Sub_2026='TRUE' OR Sub_2025=... | SELECT WHERE status='Paid' |
| **Track payment date** | Not possible | payment_date column |
| **Calculate revenue** | Manual Excel formula | SUM(amount_paid) |
| **5-year trend** | 5 separate CASE statements | One simple GROUP BY |
| **New member type** | Rethink schema | Just data in table |
| **Audit trail** | Not possible | created_by, updated_by columns |

---

## 💾 Backup & Recovery

### Backup Your Data
```bash
# Full database backup
pg_dump -U postgres iod_db > iod_db_backup.sql

# Compress it
gzip iod_db_backup.sql
```

### Recover From Backup
```bash
# Full restore
psql -U postgres iod_db < iod_db_backup.sql

# Or restore specific table
pg_restore -U postgres -d iod_db -t members backup.sql
```

---

## 🚀 Migration Path

### Phase 1: Parallel Run (1 week)
- New schema live
- Old Excel system still active
- Both systems receive updates
- Compare results nightly

### Phase 2: Cutover (1 day)
- Announce planned downtime
- Final data sync
- Flip to new database
- Verify all systems online

### Phase 3: Verification (1 week)
- Monitor for issues
- Check for discrepancies
- Run daily validation

### Phase 4: Archive (30 days later)
- Decommission old Excel files
- Archive for compliance

---

## 🎓 Learning Path

1. **Understand the problem** (5 min) → Read this document
2. **Understand the schema** (15 min) → Read DATABASE_ARCHITECTURE.md Part 2-3
3. **Create the schema** (30 min) → Run CREATE TABLE statements
4. **Migrate the data** (30 min) → Run Python script
5. **Test queries** (30 min) → Run sample queries from Part 6
6. **Build dashboard** (2 hours) → Use provided query examples
7. **Optimize** (ongoing) → Monitor and tune

---

## ✅ Before You Go Live

- [ ] Backup of old system
- [ ] Schema created and tested
- [ ] Data migrated and validated
- [ ] All dashboard queries tested
- [ ] Performance baseline established
- [ ] Backups configured
- [ ] Admin users created
- [ ] Documentation updated
- [ ] Users trained
- [ ] Rollback plan ready

---

## 📞 Troubleshooting

### "Constraint violated" during migration
```sql
-- Check what constraint is failing
SELECT constraint_name, table_name FROM information_schema.table_constraints
WHERE table_name = 'subscriptions';

-- Fix: Run validation queries to find bad data
SELECT * FROM subscriptions WHERE member_id IS NULL;
```

### "Duplicate key value" error
```sql
-- Check for duplicate membership numbers
SELECT membership_number, COUNT(*) FROM members
GROUP BY membership_number HAVING COUNT(*) > 1;

-- Fix: Manually reconcile or dedup before migration
```

### Slow queries
```sql
-- Check indexes exist
SELECT indexname FROM pg_indexes WHERE tablename = 'subscriptions';

-- Check query plan
EXPLAIN ANALYZE SELECT * FROM subscriptions WHERE subscription_year = 2026;

-- Fix: Add missing indexes
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);
```

---

## 🎯 Success Metrics

### After Migration, You Should See:
- ✅ Dashboard queries run in < 100ms
- ✅ Can add new year with single INSERT
- ✅ Payment history traceable
- ✅ Revenue reports in seconds
- ✅ Zero data loss
- ✅ Easy admin access

---

## 📚 Related Documents

1. **DATABASE_ARCHITECTURE.md** - Complete technical guide (comprehensive)
2. **MIGRATION_CHECKLIST.md** - Step-by-step checklist (actionable)
3. **migrate_excel_to_postgres.py** - Automated migration script (runnable)
4. **This document** - Quick reference (digestible)

---

**Start here → Read DATABASE_ARCHITECTURE.md Part 1 (Problem Analysis)**

**Questions? Check MIGRATION_CHECKLIST.md or DATABASE_ARCHITECTURE.md**
