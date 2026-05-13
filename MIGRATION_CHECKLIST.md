# Database Migration Checklist
## IOD Ghana - Excel to PostgreSQL Normalization

---

## 📋 Pre-Migration Assessment

### Step 1: Audit Current System
- [ ] Export current data (all Excel files)
- [ ] Count total members: _______
- [ ] Count years of data: 2006-2026 (21 years)
- [ ] Identify subscription columns: SUBSCRIPTION_YYYY
- [ ] Note payment information available: (Yes/No)
- [ ] Document member type distribution:
  - AIOD: _______
  - FIOD: _______
  - MIOD: _______
  - Honorary: _______
  - Corporate: _______

### Step 2: Data Quality Check
- [ ] Check for duplicate membership numbers
- [ ] Check for missing required fields
- [ ] Check for inconsistent data types
- [ ] Check for special characters in names
- [ ] Document data anomalies: _______________________

---

## 🏗️ Phase 1: Schema Setup (Week 2)

### Create Base Tables

```sql
-- Step 1: Create members table
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    membership_number VARCHAR(50) UNIQUE NOT NULL,
    member_type VARCHAR(50) NOT NULL,
    -- ... (see DATABASE_ARCHITECTURE.md for full definition)
);

-- Step 2: Create subscriptions table  
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    subscription_year SMALLINT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending',
    -- ... (see DATABASE_ARCHITECTURE.md for full definition)
    UNIQUE(member_id, subscription_year)
);

-- Step 3: Create indexes
CREATE INDEX idx_members_membership_number ON members(membership_number);
CREATE INDEX idx_subscriptions_member_id ON subscriptions(member_id);
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);
-- ... (see DATABASE_ARCHITECTURE.md for all indexes)

-- Step 4: Create triggers
CREATE TRIGGER members_update_timestamp BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();
-- ...
```

### Checklist
- [ ] Create members table
- [ ] Create subscriptions table
- [ ] Create payment_history table (optional)
- [ ] Create all indexes
- [ ] Create all triggers
- [ ] Create views (good_standing, summary)
- [ ] Test schema with sample data
- [ ] Verify constraints work

---

## 🔄 Phase 2: Data Migration (Week 3)

### Option A: From PostgreSQL Legacy Table

```sql
-- Step 1: Backup original data
pg_dump -U postgres -d iod_db > backup_before_migration.sql

-- Step 2: Insert members from legacy table
INSERT INTO members (
    membership_number, member_type, first_name, 
    surname, organization, email, created_at
)
SELECT DISTINCT
    membership_number,
    member_type,
    first_name,
    surname,
    organization,
    email,
    NOW()
FROM legacy_members;

-- Step 3: Migrate subscriptions (see DATABASE_ARCHITECTURE.md)
-- (Dynamic SQL to handle all years at once)
```

### Option B: From Excel CSV

```bash
# Step 1: Convert Excel to CSV
# File: members.csv with columns:
# membership_number, member_type, first_name, surname, organization, 
# email, phone, region, subscription_2016, subscription_2017, ...

# Step 2: Run Python migration script
python3 migrate_from_excel.py

# Step 3: Verify row counts
```

### Option C: Manual SQL Import

```sql
-- Using PostgreSQL COPY command:
COPY members (membership_number, member_type, first_name, surname)
FROM '/path/to/members.csv' 
WITH (FORMAT csv, HEADER);
```

### Checklist
- [ ] Backup current data
- [ ] Test migration script on sample data
- [ ] Run full migration
- [ ] Verify member count: Expected ______, Actual ______
- [ ] Verify subscription count: Expected ______, Actual ______
- [ ] Check for NULL values in required fields
- [ ] Validate membership number uniqueness
- [ ] Check subscription year range (2006-2026)
- [ ] Spot-check 10 random members in detail

---

## ✅ Phase 3: Data Validation (Week 3)

### Validation Queries

```sql
-- 1. Member count check
SELECT COUNT(*) FROM members;  -- Should match expected count

-- 2. Member type distribution
SELECT member_type, COUNT(*) FROM members GROUP BY member_type;

-- 3. Subscription completeness
SELECT COUNT(*) FROM subscriptions;

-- 4. Year range check
SELECT MIN(subscription_year), MAX(subscription_year) FROM subscriptions;

-- 5. Duplicate check (should be 0)
SELECT membership_number, COUNT(*)
FROM members
GROUP BY membership_number
HAVING COUNT(*) > 1;

-- 6. Orphaned records (should be 0)
SELECT s.id FROM subscriptions s
WHERE s.member_id NOT IN (SELECT id FROM members);

-- 7. Status value check
SELECT DISTINCT status FROM subscriptions ORDER BY status;

-- 8. Required fields (should have no NULLs)
SELECT COUNT(*) FROM members WHERE membership_number IS NULL;
SELECT COUNT(*) FROM members WHERE organization IS NULL;
SELECT COUNT(*) FROM members WHERE member_type IS NULL;

-- 9. Sample data check (pick random members)
SELECT * FROM members ORDER BY RANDOM() LIMIT 5;

-- 10. Subscription sample
SELECT m.membership_number, s.subscription_year, s.status
FROM subscriptions s
JOIN members m ON s.member_id = m.id
ORDER BY RANDOM()
LIMIT 10;
```

### Checklist
- [ ] All validation queries pass
- [ ] No duplicate membership numbers
- [ ] No orphaned subscriptions
- [ ] All required fields populated
- [ ] Date ranges correct
- [ ] Status values correct
- [ ] Sample data looks correct
- [ ] Create detailed validation report

---

## 📊 Phase 4: Dashboard Setup (Week 4)

### Create Dashboard Views

```sql
-- Step 1: Create summary views (see DATABASE_ARCHITECTURE.md)
CREATE VIEW members_good_standing AS ...
CREATE VIEW member_subscription_summary AS ...
CREATE MATERIALIZED VIEW dashboard_summary AS ...

-- Step 2: Create analytics views
CREATE VIEW unpaid_subscriptions AS ...
CREATE VIEW member_churn AS ...
CREATE VIEW revenue_trends AS ...

-- Step 3: Test all views
SELECT * FROM members_good_standing LIMIT 1;
SELECT * FROM member_subscription_summary LIMIT 1;
-- ... test all views
```

### Create Dashboard Queries

```sql
-- Step 1: Test all dashboard queries
-- (See DATABASE_ARCHITECTURE.md Part 6 for all queries)

-- Current year overview
SELECT ... FROM members m LEFT JOIN subscriptions s ...

-- Paid vs unpaid by type
SELECT m.member_type, COUNT(*) as paid, ...

-- Trending
SELECT subscription_year, SUM(amount_paid) as revenue ...

-- Step 2: Verify query performance
EXPLAIN ANALYZE SELECT ... -- Check execution plans
```

### Checklist
- [ ] All views created successfully
- [ ] All dashboard queries return expected data
- [ ] EXPLAIN ANALYZE shows good performance
- [ ] Materialized views created
- [ ] Test refresh schedule for materialized views
- [ ] Document important queries
- [ ] Create query documentation

---

## 🔍 Phase 5: Testing (Week 5)

### Performance Testing

```sql
-- Load testing with larger datasets
-- Test with 100K members and 2M subscriptions

-- Query performance baseline
-- Single member lookup: < 10ms
-- Dashboard summary: < 100ms
-- Full report: < 500ms

-- Run EXPLAIN ANALYZE on all critical queries
EXPLAIN ANALYZE SELECT * FROM subscriptions WHERE subscription_year = 2026;

-- Check index usage
SELECT * FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Check slow queries (if logging enabled)
SELECT * FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Functional Testing

```sql
-- CRUD Operations
-- Create member
INSERT INTO members (...) VALUES (...);

-- Read member
SELECT * FROM members WHERE membership_number = 'AIOD001';

-- Update member
UPDATE members SET email = 'newemail@example.com' WHERE id = 1;

-- Delete member
DELETE FROM members WHERE id = 1;
-- (Verify subscriptions auto-deleted via CASCADE)

-- Subscription operations
INSERT INTO subscriptions (member_id, subscription_year, status) VALUES (1, 2027, 'Pending');

-- Add payment
UPDATE subscriptions SET status = 'Paid', amount_paid = 150.00, payment_date = NOW();

-- Add to payment history
INSERT INTO payment_history (...) VALUES (...);
```

### Security Testing

```sql
-- Verify admin user permissions
-- Admin can SELECT all tables: ✓
-- Admin cannot DELETE/UPDATE: ✓
-- Regular users cannot access: ✓

-- Test SQL injection protection
-- All queries use parameterized statements: ✓
```

### Checklist
- [ ] Performance baseline established
- [ ] All queries run within target time
- [ ] CRUD operations work correctly
- [ ] Cascading deletes work
- [ ] Triggers fire correctly
- [ ] Constraints enforced
- [ ] View data matches source data
- [ ] User permissions set correctly
- [ ] Backup/restore tested
- [ ] Create test report

---

## 🚀 Phase 6: Deployment (Week 6)

### Pre-Deployment Checklist

- [ ] Production database created
- [ ] Schema migrated to production
- [ ] All data migrated and validated
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Admin users created
- [ ] Connection pooling configured
- [ ] Application code updated

### Migration Day

- [ ] Final backup of legacy system
- [ ] Backup of new database
- [ ] Brief application downtime (announce to users)
- [ ] Flip DNS/connection to new database
- [ ] Run real-time validation queries
- [ ] Monitor for errors in first hour
- [ ] Verify dashboard loads correctly
- [ ] Test export functionality
- [ ] Check admin access logs

### Post-Deployment

- [ ] Monitor for 24 hours
- [ ] Check slow query logs
- [ ] Verify backup schedule running
- [ ] Decommission old system (after 30-day verification)
- [ ] Archive legacy database

### Checklist
- [ ] All production systems ready
- [ ] Deployment completed
- [ ] Zero data loss
- [ ] All dashboards working
- [ ] Users can access
- [ ] No error alerts
- [ ] Documentation updated

---

## 📈 Performance Optimization Checklist

### Phase 7: Optimization (Ongoing)

- [ ] Monitor slow queries daily
- [ ] Review index usage monthly
- [ ] Archive old subscriptions yearly
- [ ] Update table statistics: `ANALYZE;`
- [ ] Reindex: `REINDEX TABLE subscriptions;`
- [ ] Refresh materialized views on schedule
- [ ] Monitor disk space usage
- [ ] Review backup sizes

---

## 📚 Documentation Checklist

- [ ] Schema documentation created
- [ ] Dashboard query documentation
- [ ] Admin user guide created
- [ ] Troubleshooting guide created
- [ ] Backup/restore procedures documented
- [ ] Migration report completed
- [ ] Performance baseline documented
- [ ] Data dictionary created

---

## 🎯 Success Criteria

### Must Have ✅
- [ ] All data migrated correctly
- [ ] Zero data loss
- [ ] Dashboard queries < 100ms
- [ ] Backup working
- [ ] Users can access system

### Should Have ✅
- [ ] Queries < 50ms average
- [ ] Materialized views refresh on schedule
- [ ] Documentation complete
- [ ] Monitoring configured
- [ ] Archive strategy implemented

### Nice to Have ✅
- [ ] Query performance < 20ms
- [ ] Real-time dashboards
- [ ] Advanced analytics implemented
- [ ] Predictive reports created
- [ ] Mobile-friendly dashboard

---

## 🚨 Rollback Plan

If anything goes wrong:

```sql
-- Restore from backup
psql -U postgres -d iod_db < backup_before_migration.sql

-- OR restore specific table
pg_restore -U postgres -d iod_db -t members backup.sql

-- Verify restoration
SELECT COUNT(*) FROM members;
```

- [ ] Backup locations documented
- [ ] Restore procedures tested
- [ ] Rollback plan in writing
- [ ] Communication plan if rollback needed

---

## 📞 Support & Escalation

### During Migration
- **Issue**: Query performance degradation
  - **Action**: Run ANALYZE, check table statistics
  
- **Issue**: Disk space running out
  - **Action**: Archive old data, expand disk
  
- **Issue**: User access issues
  - **Action**: Check permissions, verify credentials
  
- **Issue**: Data mismatch
  - **Action**: Stop, validate, run reconciliation

### Post-Migration Support
- [ ] 7-day intensive monitoring
- [ ] 30-day trial period
- [ ] Weekly performance reviews
- [ ] Monthly optimization meetings

---

## 💾 Backup Schedule

- **Daily**: Full backup, 30-day retention
- **Weekly**: Full backup, 12-week retention
- **Monthly**: Full backup, 2-year retention
- **Test restore**: Monthly from random backup

```bash
# Automated daily backup
0 2 * * * pg_dump -U postgres iod_db | gzip > /backups/iod_db_$(date +\%Y\%m\%d).sql.gz
```

---

## 📋 Sign-Off

When complete, confirm:

- [ ] Technical Lead approval
- [ ] Database Admin sign-off
- [ ] Application Team confirmation
- [ ] Test results reviewed
- [ ] Documentation complete
- [ ] Users trained
- [ ] Go-live approved

---

**Migration Status**: ⏳ Ready to Begin

**Next Step**: Run Phase 1 (Schema Setup)

**Timeline**: 6 weeks from start to full deployment

**Questions?** Refer to DATABASE_ARCHITECTURE.md for detailed information.
