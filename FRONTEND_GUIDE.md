# Frontend Setup & Testing Guide
## Institute of Directors-Ghana Membership Database System

---

## ✅ Frontend Features Implemented

### Main Dashboard (index.html)
- **Member Management**
  - View all members in a paginated table
  - Add new members with dynamic form fields
  - Edit existing member information
  - Delete members with confirmation
  - Search by name, membership number, or organization
  - Filter by member type (AIOD, FIOD, MIOD, Honorary, Corporate)
  - Filter by subscription year
  - Sort by any column (ascending/descending)

- **Data Display**
  - Member type cards with live counts
  - Real-time statistics
  - Color-coded subscription status
  - Responsive grid layout

- **Export Features**
  - Export filtered/searched data to CSV
  - Timestamped file naming
  - Includes all member details

### Good Standing Report (good_standing.html)
- **Report Features**
  - Filter members by year
  - View members grouped by member type
  - Display member counts per category
  - Shows total members in good standing
  - Export report to CSV

---

## 🚀 How to Run the Frontend

### Prerequisites
1. Node.js and npm installed
2. PostgreSQL database running
3. Backend server (server.js) running on port 3000

### Step 1: Start the Backend Server
```bash
cd "c:\Users\aduse\Desktop\Code\Database Design"
npm install
npm start
```

The server will run on `http://localhost:3000`

### Step 2: Access the Frontend
Open your browser and navigate to:
- **Dashboard**: http://localhost:3000/
- **Good Standing**: http://localhost:3000/good_standing.html

---

## 🧪 Testing the Frontend

### Test 1: Load Members
1. Open the Dashboard
2. Verify that members load from the database
3. Check that member type counters display correctly

**Expected Result**: Members display in the table with all columns visible

### Test 2: Add a New Member
1. Click "Add New Member" button
2. Fill in the form fields:
   - Member Type: Select one (form fields will update)
   - Membership Number: e.g., "AIOD001"
   - Name fields: Based on member type selected
   - Organization: Required field
   - Other optional fields
3. Click "Save Member"

**Expected Result**: Member added and table updates automatically

### Test 3: Search & Filter
1. Use the search box to search by name
2. Use member type filter dropdown
3. Use subscription year filter
4. Combine multiple filters

**Expected Result**: Table updates with filtered results

### Test 4: Sort Data
1. Click on any column header
2. Click again to reverse sort order
3. Observe the sorting indicator

**Expected Result**: Data sorts by the selected column

### Test 5: Edit Member
1. Click the edit button (pencil icon) on any member row
2. Update some fields
3. Click "Save Member"

**Expected Result**: Member record updates in the database

### Test 6: Delete Member
1. Click the delete button (trash icon)
2. Confirm deletion
3. Click "OK" in the alert

**Expected Result**: Member is removed from the table

### Test 7: Export Data
1. Optional: Apply filters/search to narrow data
2. Click "Export to CSV" button
3. Browser will download a CSV file

**Expected Result**: CSV file downloads with timestamp, contains filtered data

### Test 8: Good Standing Report
1. Navigate to Good Standing page
2. Select a year from dropdown
3. Click "View Report"
4. Verify members are grouped by type
5. Click "Export CSV" to download report

**Expected Result**: Report displays with member counts, export works

### Test 9: Responsive Design
1. Open the page on different screen sizes:
   - Desktop (1920x1080)
   - Tablet (768x1024)
   - Mobile (375x667)
2. Verify layout adjusts properly
3. Test form in mobile view

**Expected Result**: Layout is responsive, all features work on mobile

### Test 10: Error Handling
1. Disconnect the backend (stop Node.js server)
2. Try to load members or add a new member
3. Observe the error message

**Expected Result**: Graceful error message is displayed

---

## 📋 API Endpoints Used

The frontend communicates with these backend endpoints:

### Members CRUD
- `GET /api/members` - Fetch all members
- `GET /api/members/:id` - Fetch single member
- `POST /api/members` - Create new member
- `PUT /api/members/:id` - Update member
- `DELETE /api/members/:id` - Delete member

### Subscriptions
- `GET /api/members/:id/subscriptions` - Get member subscriptions
- `POST /api/members/:id/subscriptions` - Add subscription
- `PUT /api/subscriptions/:id` - Update subscription
- `DELETE /api/subscriptions/:id` - Delete subscription

### Reports
- `GET /api/statistics/members` - Get member statistics
- `GET /api/good-standing/:year` - Get good standing members for year

---

## ⚙️ Configuration

The frontend uses hardcoded API URLs pointing to `http://localhost:3000`. For production deployment:

1. Update API URL in both HTML files:
   - Replace `http://localhost:3000` with your production server URL
   - Or use the new `config.js` file for centralized configuration

2. Example using config.js:
   ```javascript
   const apiUrl = CONFIG.getApiUrl(CONFIG.ENDPOINTS.GET_ALL_MEMBERS);
   fetch(apiUrl)...
   ```

---

## 🎨 Styling & UI Features

### Color Scheme
- **Primary**: Deep Blue (#12086f)
- **Secondary**: Cyan (#06b6d4)
- **Accent**: Amber (#f59e0b)
- **Success**: Green (#10b981)
- **Danger**: Red (#ef4444)

### Responsive Breakpoints
- Desktop: 1024px+
- Tablet: 768px - 1023px
- Mobile: < 768px
- Small Mobile: < 480px

### Key UI Components
- Modern gradient buttons
- Smooth modal animations
- Responsive data tables
- Color-coded status indicators
- Interactive member type cards
- Intuitive form layouts

---

## 🐛 Troubleshooting

### Issue: "Failed to load members data"
- **Cause**: Backend server not running
- **Fix**: Start the backend with `npm start`

### Issue: Modal won't close
- **Cause**: JavaScript error
- **Fix**: Check browser console for errors (F12)

### Issue: Export button not working
- **Cause**: Browser security restrictions or no data
- **Fix**: Ensure data is loaded, check browser permissions

### Issue: Filters not working
- **Cause**: JavaScript issue or data mismatch
- **Fix**: Refresh page, check browser console

### Issue: Date fields show incorrect format
- **Cause**: Date format mismatch between frontend/backend
- **Fix**: Ensure dates are in DD/MM/YYYY format

---

## 📱 Mobile Testing Checklist

- [ ] Form inputs are accessible on mobile
- [ ] Buttons are large enough to tap
- [ ] Tables scroll horizontally if needed
- [ ] Modals display properly on small screens
- [ ] Navigation menu is accessible
- [ ] Export functionality works
- [ ] All text is readable without zooming

---

## ✨ Future Enhancements

- [ ] Add bulk import from Excel
- [ ] Add email notifications
- [ ] Add advanced reporting/analytics
- [ ] Add member photo uploads
- [ ] Add payment history tracking
- [ ] Add audit logs
- [ ] Add user authentication
- [ ] Add role-based access control

---

## 📞 Support

For issues or questions about the frontend:
1. Check the browser console for error messages (F12)
2. Verify the backend is running and accessible
3. Check network tab in DevTools to see API calls
4. Review the error messages in alerts

---

**Last Updated**: February 5, 2026
**Status**: ✅ Complete and Ready for Testing
