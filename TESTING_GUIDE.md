# Full Stack Testing Guide - IOD Ghana Database System

## 🚀 Quick Start: Testing the Complete System

### Prerequisites
- PostgreSQL running with the normalized schema created from DATABASE_ARCHITECTURE.md
- Node.js with dependencies installed
- Data migrated using migrate_excel_to_postgres.py

---

## 📋 Part 1: Backend API Testing (Node.js)

### Step 1: Start the Server

```bash
cd c:\Users\aduse\Desktop\Code\Database Design
node server.js
```

**Expected Output:**
```
Database connected: 2026-02-05 14:30:45.123456+00
Server is running on port 3000
```

---

## 🧪 Part 2: API Endpoint Testing

### Core Endpoints (Existing)

#### 1.1 Get All Members
```
GET http://localhost:3000/api/members
```

**Expected Response:**
```json
[
  {
    "id": 1,
    "membership_number": "A001",
    "member_type": "AIOD",
    "first_name": "John",
    "surname": "Doe",
    "organization": "ABC Corp",
    "email": "john@example.com",
    "phone_number": "0501234567",
    "region": "Greater Accra",
    "subscription_years": [2026, 2025, 2024],
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2026-01-15T10:30:00Z"
  }
]
```

#### 1.2 Get Members by Type
```
GET http://localhost:3000/api/members?member_type=AIOD
```

#### 1.3 Get Member by ID
```
GET http://localhost:3000/api/members/1
```

#### 1.4 Create New Member
```
POST http://localhost:3000/api/members
Content-Type: application/json

{
  "membership_number": "C003",
  "member_type": "Corporate",
  "first_name": "Jane",
  "surname": "Smith",
  "organization": "XYZ Ltd",
  "email": "jane@xyz.com",
  "phone_number": "0559876543",
  "region": "Ashanti",
  "date_of_admission": "2024-06-15",
  "subscription_years": [2024, 2025, 2026]
}
```

**Expected Response (201 Created):**
```json
{
  "id": 50,
  "membership_number": "C003",
  "member_type": "Corporate",
  "first_name": "Jane",
  ...
}
```

#### 1.5 Update Member
```
PUT http://localhost:3000/api/members/1
Content-Type: application/json

{
  "membership_number": "A001",
  "organization": "New Organization",
  "phone_number": "0501234567",
  "subscription_years": [2024, 2025, 2026]
}
```

#### 1.6 Delete Member
```
DELETE http://localhost:3000/api/members/1
```

---

### Dashboard Analytics Endpoints (NEW)

#### 2.1 Current Year Overview (2026 KPIs)
```
GET http://localhost:3000/api/dashboard/current-year-overview
```

**Expected Response:**
```json
{
  "year": 2026,
  "total_members": 1500,
  "members_paid": 1350,
  "members_unpaid": 150,
  "payment_rate_percent": 90.00,
  "total_revenue": 202500.00,
  "avg_payment": 150.00
}
```

#### 2.2 Payment by Member Type
```
GET http://localhost:3000/api/dashboard/paid-by-type
```

**Expected Response:**
```json
[
  {
    "member_type": "FIOD",
    "total_members": 400,
    "paid_members": 390,
    "unpaid_members": 10,
    "paid_percent": 97.50
  },
  {
    "member_type": "Corporate",
    "total_members": 200,
    "paid_members": 190,
    "unpaid_members": 10,
    "paid_percent": 95.00
  }
]
```

#### 2.3 Yearly Revenue Trends
```
GET http://localhost:3000/api/dashboard/yearly-trends
```

**Expected Response:**
```json
[
  {
    "subscription_year": 2026,
    "members_count": 1500,
    "paid_members": 1350,
    "payment_rate": 90.0,
    "total_revenue": 202500.00
  },
  {
    "subscription_year": 2025,
    "members_count": 1480,
    "paid_members": 1332,
    "payment_rate": 90.0,
    "total_revenue": 199800.00
  }
]
```

#### 2.4 Unpaid Subscriptions (Action List)
```
GET http://localhost:3000/api/dashboard/unpaid-subscriptions
```

**Expected Response:**
```json
[
  {
    "membership_number": "A001",
    "member_type": "AIOD",
    "member_name": "John Doe",
    "organization": "ABC Corp",
    "email": "john@abc.com",
    "phone_number": "0501234567",
    "subscription_year": 2026,
    "status": "Pending",
    "overdue_status": "CURRENT",
    "amount_owed": 150.00
  },
  {
    "membership_number": "F005",
    "member_type": "FIOD",
    "member_name": "Jane Smith",
    "organization": "XYZ Ltd",
    "subscription_year": 2025,
    "status": "Partial",
    "overdue_status": "1 YEAR OVERDUE",
    "amount_owed": 50.00
  }
]
```

#### 2.5 Regional Performance
```
GET http://localhost:3000/api/dashboard/regional-performance
```

**Expected Response:**
```json
[
  {
    "region": "Greater Accra",
    "total_members": 800,
    "paid_members": 760,
    "payment_rate": 95.0,
    "region_revenue": 114000.00
  },
  {
    "region": "Ashanti",
    "total_members": 400,
    "paid_members": 360,
    "payment_rate": 90.0,
    "region_revenue": 54000.00
  }
]
```

#### 2.6 Payment Methods
```
GET http://localhost:3000/api/dashboard/payment-methods
```

**Expected Response:**
```json
[
  {
    "payment_method": "Bank Transfer",
    "transactions": 450,
    "total_paid": 67500.00,
    "avg_payment": 150.00
  },
  {
    "payment_method": "Mobile Money",
    "transactions": 600,
    "total_paid": 90000.00,
    "avg_payment": 150.00
  }
]
```

#### 2.7 Member Growth
```
GET http://localhost:3000/api/dashboard/member-growth
```

**Expected Response:**
```json
[
  {
    "month": "2026-02-05",
    "new_members": 15,
    "cumulative": 1500
  },
  {
    "month": "2026-01-05",
    "new_members": 25,
    "cumulative": 1485
  }
]
```

#### 2.8 Churn Analysis
```
GET http://localhost:3000/api/dashboard/churn-analysis
```

**Expected Response:**
```json
[
  {
    "membership_number": "A002",
    "member_type": "AIOD",
    "member_name": "Bob Johnson",
    "last_paid_year": 2024,
    "years_since_paid": 2
  }
]
```

#### 2.9 Cohort Analysis
```
GET http://localhost:3000/api/dashboard/cohort-analysis
```

**Expected Response:**
```json
[
  {
    "cohort_year": 2015,
    "years_as_member": 11,
    "cohort_size": 120,
    "paid_in_latest": 108,
    "payment_rate": 90.0
  }
]
```

#### 2.10 Revenue Forecast
```
GET http://localhost:3000/api/dashboard/revenue-forecast
```

**Expected Response:**
```json
[
  {
    "subscription_year": 2026,
    "yearly_revenue": 202500.00,
    "paid_members": 1350,
    "avg_per_member": 150.00,
    "latest_revenue": 202500.00,
    "forecasted_revenue_5pct_growth": 212625.00
  }
]
```

---

## 🌐 Part 3: Frontend Testing

### Testing with Postman/Insomnia

1. **Open Postman**
2. **Create new collection: "IOD Ghana API"**
3. **Add requests for each endpoint above**
4. **Set base URL variable:** `{{base_url}} = http://localhost:3000`

**Postman Collection (Save as JSON):**
```json
{
  "info": {
    "name": "IOD Ghana API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Dashboard Analytics",
      "item": [
        {
          "name": "Current Year Overview",
          "request": {
            "method": "GET",
            "url": "{{base_url}}/api/dashboard/current-year-overview"
          }
        }
      ]
    }
  ]
}
```

### Testing via HTML Dashboard

1. **Start Node.js server:**
   ```bash
   node server.js
   ```

2. **Open browser:**
   ```
   http://localhost:3000/dashboard-analytics.html
   ```

3. **Verify all sections load:**
   - ✅ KPI Cards (Total Members, Paid, Payment Rate, Revenue)
   - ✅ Payment by Type (Progress bars)
   - ✅ Regional Performance (Regional breakdown)
   - ✅ Yearly Trends (Table with 10 years)
   - ✅ Unpaid Subscriptions (Action list)
   - ✅ Churn Analysis (Members not paying)
   - ✅ Cohort Analysis (Retention by join year)
   - ✅ Revenue Forecast (Projection with 5% growth)

4. **Test Refresh Button:**
   - Click "Refresh" button
   - Verify all data reloads
   - Verify success message appears

---

## 🧪 Part 4: Manual Testing Scenarios

### Scenario 1: Member Management
```
1. Create new member (POST /api/members)
2. Verify in list (GET /api/members)
3. Update member details (PUT /api/members/:id)
4. Delete member (DELETE /api/members/:id)
5. Verify removed from list (GET /api/members)
```

### Scenario 2: Payment Tracking
```
1. Add subscription for member (POST /api/members/:id/subscriptions)
2. Update subscription status to "Paid" (PUT /api/subscriptions/:id)
3. Verify appears in KPI metrics
4. Verify payment appears in revenue forecast
5. Verify member removed from unpaid list
```

### Scenario 3: Region Filtering
```
1. Create members in different regions
2. Query /api/dashboard/regional-performance
3. Verify each region shows correct counts
4. Verify revenue calculated by region
5. Verify payment rate calculated per region
```

### Scenario 4: Year-over-Year Trends
```
1. Query /api/dashboard/yearly-trends
2. Verify 10 most recent years returned
3. Verify revenue calculated per year
4. Verify payment rate shows decline/growth
5. Verify member count trends
```

---

## 🔍 Part 5: Debugging & Common Issues

### Issue 1: Server Won't Start
```
Error: ECONNREFUSED 127.0.0.1:5432
```
**Solution:**
- Ensure PostgreSQL is running
- Check DB_HOST, DB_USER, DB_PASSWORD in environment
- Run: `psql -U postgres -d postgresSS` to verify connection

### Issue 2: Dashboard Shows No Data
```
"Loading..." spinner never stops
```
**Solution:**
- Check browser console for CORS errors
- Verify server is running: `node server.js`
- Check Network tab in DevTools
- Verify API endpoint is accessible: `http://localhost:3000/api/dashboard/current-year-overview`

### Issue 3: Member Create Fails
```
Error: "Subscription years is required"
```
**Solution:**
- Provide subscription_years array in request body
- Or provide date_of_admission (auto-adds that year)
- Example: `"subscription_years": [2024, 2025, 2026]`

### Issue 4: Revenue Shows $0
```
Trending shows no revenue
```
**Solution:**
- Verify payment_date is set in subscriptions table
- Verify status = 'Paid' for counting
- Verify amount_paid > 0
- Check data via: `SELECT * FROM subscriptions WHERE status = 'Paid' LIMIT 5;`

---

## 📊 Part 6: Performance Testing

### Test 1: API Response Time
```
Endpoint: /api/dashboard/current-year-overview
Expected: < 100ms
```

Run test:
```bash
# Using curl with timing
curl -w "Time: %{time_total}s\n" http://localhost:3000/api/dashboard/current-year-overview
```

### Test 2: Large Dataset Query
```
Endpoint: /api/members
Expected: < 500ms for 10,000+ members
```

### Test 3: Concurrent Requests
```
Simulate 10 simultaneous dashboard requests
Expected: All complete within 5 seconds
```

---

## ✅ Part 7: Validation Checklist

### Database Schema
- [ ] `members` table exists with all columns
- [ ] `subscriptions` table exists with unique constraint
- [ ] Foreign key: subscriptions.member_id → members.id
- [ ] Indexes created on: member_id, subscription_year, member_type
- [ ] `is_active` column defaults to TRUE

### Data Migration
- [ ] All member records migrated
- [ ] All subscription years migrated
- [ ] No NULL values in required fields
- [ ] No duplicate (member_id, subscription_year) pairs
- [ ] Payment data correctly populated

### API Endpoints
- [ ] All 10 dashboard endpoints respond
- [ ] Member CRUD operations work
- [ ] Subscription operations work
- [ ] Good standing endpoint works
- [ ] Error handling returns 500 for DB errors

### Frontend Dashboard
- [ ] Page loads without errors
- [ ] All KPI cards display data
- [ ] All charts load data
- [ ] All tables populate
- [ ] Refresh button updates all sections
- [ ] No CORS errors in console
- [ ] Auto-refresh every 5 minutes works

---

## 🚀 Part 8: Deployment Testing

### Before Going Live

#### 1. Database Backups
```bash
# Test backup
pg_dump -U postgres postgresSS > backup_test.sql

# Test restore
createdb postgresSS_test
psql -U postgres postgresSS_test < backup_test.sql
```

#### 2. Load Testing
```bash
# Using Apache Bench (requires installation)
ab -n 100 -c 10 http://localhost:3000/api/dashboard/current-year-overview

# Expected: 100 requests completed
#           10 concurrent
#           Response time < 500ms avg
```

#### 3. Security Checklist
- [ ] CORS configured (allow frontend origin only)
- [ ] SQL injection protection (using parameterized queries ✓)
- [ ] No exposed credentials in code
- [ ] HTTPS enabled in production
- [ ] Database user has least privilege

#### 4. Monitoring Setup
```javascript
// Add to server.js for monitoring
app.get('/health', (req, res) => {
    pool.query('SELECT NOW()', (err) => {
        if (err) {
            return res.status(500).json({ status: 'unhealthy', error: err.message });
        }
        res.json({ status: 'healthy', timestamp: new Date() });
    });
});
```

Test health:
```
GET http://localhost:3000/health
```

Expected (200):
```json
{
  "status": "healthy",
  "timestamp": "2026-02-05T14:30:45Z"
}
```

---

## 📋 Part 9: Test Data Setup

If you need sample data for testing:

```sql
-- Insert sample members
INSERT INTO members (membership_number, member_type, first_name, surname, organization, region, is_active)
VALUES 
    ('T001', 'AIOD', 'Test', 'User1', 'Test Org 1', 'Greater Accra', TRUE),
    ('T002', 'FIOD', 'Test', 'User2', 'Test Org 2', 'Ashanti', TRUE),
    ('T003', 'Corporate', 'Test', 'User3', 'Test Org 3', 'Western', TRUE);

-- Insert sample subscriptions
INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
VALUES
    (1, 2026, 'Paid', 150.00, '2026-02-01'),
    (2, 2026, 'Pending', NULL, NULL),
    (3, 2026, 'Paid', 150.00, '2026-01-15');
```

Verify:
```sql
SELECT COUNT(*) FROM members WHERE is_active = TRUE;
SELECT COUNT(*) FROM subscriptions WHERE status = 'Paid';
```

---

## 🎯 Part 10: Full Stack Integration Test

### Test Workflow:
1. ✅ Start server
2. ✅ Create test member
3. ✅ Add subscription for member
4. ✅ Mark subscription as paid
5. ✅ Query dashboard overview
6. ✅ Verify member appears in KPIs
7. ✅ Open analytics dashboard in browser
8. ✅ Verify all visualizations load
9. ✅ Click refresh button
10. ✅ Verify data updates

**If all ✅, system is ready for production!**

---

## 📞 Support & Debugging

### Check Server Logs
```bash
# View detailed logs
node server.js 2>&1 | tee server.log
```

### Check Database Logs
```bash
# PostgreSQL logs
SELECT * FROM pg_current_wal_lsn();
```

### Test Specific Query
```bash
# Direct SQL test
psql -U postgres postgresSS -c "SELECT * FROM subscriptions LIMIT 5;"
```

### API Test with cURL
```bash
# Test endpoint directly
curl -s http://localhost:3000/api/dashboard/current-year-overview | jq .

# Pretty print JSON
curl -s http://localhost:3000/api/members | jq '.[] | {id, membership_number, member_type}'
```

---

**System is now ready for testing! 🎉**

Next steps:
1. Start Node.js server
2. Navigate to dashboard-analytics.html
3. Verify all data loads
4. Run through test scenarios
5. Monitor performance
6. Deploy when ready!
