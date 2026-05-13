# 2025 Subscription Year Import Guide

**Date**: February 25, 2026  
**Feature**: File Import with 2025 Subscription Year Support  
**Status**: ✅ Complete and Ready to Deploy

---

## 📋 What's New

The file import system now automatically detects and processes subscription year columns from your CSV/Excel files. When you import member data, the system will:

1. ✅ Detect all columns matching `SUBSCRIPTION_YYYY` format
2. ✅ Create subscription records for each member for each year found
3. ✅ Set status as "Paid" if marked with TRUE/1/YES/PAID in the file
4. ✅ Set status as "Pending" if empty or FALSE/0/NO in the file
5. ✅ Always set "Waived" for Honorary members
6. ✅ Connect everything to the database automatically

---

## 🎯 For 2025 Specifically

### Subscription Rates Already Configured

All member types have 2025 rates configured in the database:

| Member Type | 2025 Rate |
|------------|-----------|
| AIOD | GHS 350.00 |
| FIOD | GHS 500.00 |
| MIOD | GHS 400.00 |
| Honorary | GHS 0.00 (Waived) |
| Corporate | GHS 5,000.00 |
| Corporate - Gold | GHS 8,000.00 |
| Corporate - Silver | GHS 6,000.00 |
| Corporate - Bronze | GHS 4,000.00 |
| Corporate - Standard | GHS 2,000.00 |

---

## 📋 Excel/CSV Format Example

Your import file should include columns like this:

```
membership_number | member_type | first_name | surname | organization | SUBSCRIPTION_2021 | SUBSCRIPTION_2022 | ... | SUBSCRIPTION_2025
A00001           | AIOD        | John       | Smith   | Acme Corp     | 1                | 1                | ... | 1
F00001           | FIOD        | Jane       | Doe     | Tech Ltd      | 1                | 1                | ... | 1
M00001           | MIOD        | Bob        | Wilson  | Services Inc  | 1                | 0                | ... | 0
H00001           | Honorary    | Alice      | Brown   | Ltd           | 1                | 1                | ... | 1
```

### Accepted Values for Subscription Status

✅ **Paid** (any of these):
- `1`, `true`, `TRUE`, `True`
- `Y`, `y`, `yes`, `YES`, `Yes`
- `P`, `p`, `paid`, `PAID`, `Paid`
- `✓`, `x`, `X`

❌ **Pending** (any of these or empty):
- `0`, `false`, `FALSE`, `False`
- `N`, `n`, `no`, `NO`, `No`
- Empty cell

---

## 🚀 Step-by-Step: Import with 2025 Data

### Step 1: Prepare Your File
Create a CSV or Excel file with columns for each subscription year (2021-2025, or whatever years apply).

### Step 2: Navigate to Import Page
1. Open your application
2. Go to "Members Admin Dashboard" (index.html)
3. Find the "Import Members" section

### Step 3: Upload File
1. Click "Choose File" and select your CSV/Excel file
2. Click "Preview" to see if data looks correct
3. Verify that your subscription year columns are visible

### Step 4: Map Columns (if needed)
If your column headers don't match expected names, use the column mapping feature to specify which Excel column maps to which database field.

### Step 5: Import
Click "Import" and wait for completion. The system will:
- ✅ Create all members
- ✅ Create subscription records for 2025 and other years
- ✅ Set correct status for each subscription
- ✅ Show you import summary

### Step 6: Verify
Check the "Good Standing" report:
1. Open good_standing.html
2. Select year "2025" from dropdown
3. View all members with 2025 subscriptions

---

## 💾 Database Setup

All required tables and subscription rates are already configured:

### Files to Run (if setting up fresh):

1. **database_schema_new.sql** - Create base tables
2. **subscription_rates_setup.sql** - Add subscription rates including 2025
3. **add_subscription_years_2025_2035.sql** - Add subscription years (optional, for bulk setup)
4. **initialize_2025_subscriptions.sql** - Add 2025 records for all existing members

### Running the Setup:

```bash
# Option 1: Using psql command line
psql -U postgres -d iod_ghana -f subscription_rates_setup.sql
psql -U postgres -d iod_ghana -f initialize_2025_subscriptions.sql

# Option 2: Paste content into pgAdmin
# Open each SQL file and copy-paste content into pgAdmin query editor
```

---

## 🔧 Technical Details

### Files Modified for 2025 Support

#### 1. **server.js** (Lines 1265+)
- **New**: Detects subscription columns from imported file
- **New**: Creates subscription records during import
- **New**: Handles multiple subscription years from single file
- **Returns**: Summary of detected subscription years in import response

Key function:
```javascript
// Extracts subscription columns like SUBSCRIPTION_2025
const subscriptionCols = headers.filter(h => h.toUpperCase().includes('SUBSCRIPTION'))
    .map(col => {
        const match = col.match(/(\d{4})/);
        if (match) return { colName: col, year: parseInt(match[1]) };
        return null;
    }).filter(x => x !== null);
```

#### 2. **subscription_rates_setup.sql**
- **Added**: 2025 rates for all member types
- **Added**: Corporate category rates (Gold, Silver, Bronze, Standard)
- **All years**: 2025-2035 fully configured

#### 3. **index.html**
- **Already supports**: 2025 year selection (no changes needed)
- **Range**: Shows years 2025-2035

#### 4. **good_standing.html**
- **Already supports**: 2025 in year dropdown (no changes needed)
- **Default**: Shows 2026 (can be changed in code)

---

## 📊 API Response Example

When you import a file, the API returns:

```json
{
  "success": true,
  "imported": 150,
  "failed": 2,
  "errors": [...],
  "subscriptionColumnsDetected": [
    "SUBSCRIPTION_2021",
    "SUBSCRIPTION_2022",
    "SUBSCRIPTION_2023",
    "SUBSCRIPTION_2024",
    "SUBSCRIPTION_2025"
  ],
  "subscriptionYearsProcessed": [2021, 2022, 2023, 2024, 2025]
}
```

This confirms that 2025 data was processed.

---

## ✅ Testing Checklist

- [ ] Database has 2025 subscription rates (run: `SELECT * FROM subscription_rates WHERE subscription_year = 2025;`)
- [ ] Download sample CSV from `/EXCEL` folder
- [ ] Add `SUBSCRIPTION_2025` column to CSV
- [ ] Mark some members as "1" (paid) for 2025
- [ ] Upload file via import
- [ ] Verify import response shows 2025 detected
- [ ] Check database: `SELECT * FROM subscriptions WHERE subscription_year = 2025 LIMIT 10;`
- [ ] View in "Good Standing" report with year 2025 selected
- [ ] Verify paid, pending, and waived are showing correctly

---

## 🆘 Troubleshooting

### "2025 not showing in dropdown"
**Solution**: Update the year range in code:
- index.html line 2822: Change `for (let y = 2025; y <= 2035; y++)`
- good_standing.html line 705: Add 2025 to defaultYears array

### "Subscriptions not imported from file"
**Solution**: 
1. Verify column is named exactly `SUBSCRIPTION_2025` (can be uppercase/lowercase)
2. Check your values are 0, 1, yes, no, true, false, paid, etc.
3. Look at API response to confirm columns were detected

### "2025 records not in database"
**Solution**:
1. Run initialize_2025_subscriptions.sql
2. Check that subscriptions table exists and has proper structure
3. Verify members are imported before subscriptions

### "Wrong status for 2025"
**Solution**: 
1. Check subscription_rates table has 2025 entry for member type
2. View raw data in subscriptions table to debug
3. Check member_type is correct (capitalization matters)

---

## 📝 Related Documentation

- [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) - Full schema design
- [QUICK_START.md](QUICK_START.md) - Setup instructions
- [TESTING_GUIDE.md](TESTING_GUIDE.md) - Complete testing procedures
- [DATABASE_QUICK_REFERENCE.md](DATABASE_QUICK_REFERENCE.md) - SQL query examples

---

## 🎯 Summary

Your system now has complete 2025 support:

✅ **Database**: All rates and schema ready
✅ **Frontend**: Year dropdowns include 2025
✅ **Import**: Automatically processes SUBSCRIPTION_2025 columns
✅ **Reports**: Good Standing report shows 2025 data
✅ **Profiles**: Member profiles display 2025 subscription status

**Ready to import members with 2025 subscription data!**

---

**Questions or issues?** Check the changelog and implementation guide in the main documentation.

**Version**: 1.0  
**Date**: February 25, 2026  
**Status**: ✅ Production Ready
