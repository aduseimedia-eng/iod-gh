# Frontend Quick Reference Card
## IOD Ghana Membership Database

---

## 🚀 Quick Start

```bash
# Start the application
cd "c:\Users\aduse\Desktop\Code\Database Design"
npm start

# Open in browser
http://localhost:3000
```

---

## 📋 Main Features

| Feature | Location | How to Use |
|---------|----------|-----------|
| View Members | Dashboard Table | Page loads automatically |
| Add Member | "Add New Member" Button | Click → Fill Form → Save |
| Edit Member | Pencil Icon | Click → Update → Save |
| Delete Member | Trash Icon | Click → Confirm → Done |
| Search | Search Box | Type name/membership/org |
| Filter Type | Dropdown | Select member type |
| Filter Year | Year Dropdown | Select subscription year |
| Sort | Column Headers | Click to sort, click again to reverse |
| Export CSV | "Export to CSV" Button | Click → File downloads |
| Good Standing | Navigation Menu | Click link → Select year → View |

---

## 🔄 Common Workflows

### Add a New Member
1. Click "Add New Member"
2. Select Member Type (form updates)
3. Fill required fields (marked with *)
4. Fill optional fields
5. Click "Save Member"
6. Click "OK" on success message

### Edit Existing Member
1. Find member in table
2. Click pencil icon (Edit)
3. Update desired fields
4. Click "Save Member"
5. Changes saved automatically

### Search for Members
1. Type in search box (name, membership #, or organization)
2. Table updates instantly
3. Clear search box to reset

### Filter by Member Type
1. Select type from dropdown (AIOD, FIOD, MIOD, Honorary, Corporate)
2. Table shows only selected type
3. Select "All Member Types" to reset

### Export Members to CSV
1. Optional: Apply filters/search to narrow data
2. Click "Export to CSV"
3. Browser downloads file: `IOD_Members_[timestamp].csv`
4. Open in Excel/Sheets

### View Good Standing Members
1. Click "Good Standing" in navigation menu
2. Select year from dropdown
3. Click "View Report"
4. Members grouped by type with counts
5. Optional: Click "Export CSV" to download

---

## 🎨 Key UI Elements

### Buttons
- **Blue Gradient**: Primary actions (Add, Save)
- **Amber**: Secondary actions (Export, Refresh)
- **Red**: Delete actions
- **White with Border**: Pagination

### Badges
- **Gold**: Membership numbers
- **Green**: Member types
- **Green Text**: Current year subscription
- **Red Text**: Past year subscriptions

### Member Type Cards
- Click to filter by type
- Shows live count
- Color-coded per type

### Status Indicators
- **Green**: Current year (good standing)
- **Red**: Past year (not in good standing)
- **Dash (-)**: No subscriptions

---

## 📱 Mobile Tips

1. Use phone in landscape for better table view
2. Forms auto-stack on mobile
3. All buttons are tap-friendly
4. Modals optimize for small screens
5. Export still works on mobile

---

## ⚙️ Member Type Fields

### AIOD (Associates)
- Designation (instead of Position)
- Surname (instead of Last Name)
- Date of Admission required

### FIOD (Fellows)
- Position (instead of Designation)
- Last Name (instead of Surname)
- Region dropdown
- Years Served on Boards

### MIOD (Members)
- Position field
- Last Name field
- Region dropdown

### Honorary
- Last Name field
- Region dropdown
- Date of Admission

### Corporate
- Registration Date (not Admission)
- Membership Category (Gold/Silver/Bronze/Standard)
- Contact person fields
- SRL number & registration number

---

## 🔍 Search & Filter Tips

### Search Works On
- First name or full name
- Membership number
- Organization name
- Case insensitive

### Filters Combine
- Type + Year: Shows members of type WITH that year
- Search + Filter: Shows matching type members

### Clear Filters
- Select "All Member Types" in type dropdown
- Select "All Years" in year dropdown
- Clear search box (backspace all text)

---

## ✏️ Form Tips

### Required Fields
- Marked with * (asterisk)
- Form won't submit without them
- Highlighted on focus

### Date Fields
- Click to open date picker
- Format: YYYY-MM-DD
- Converts to DD/MM/YYYY for display

### Regions
- Dropdown with predefined regions
- Greater Accra, Ashanti, Western, etc.
- Type to search dropdown

### Subscription Years
- Comma-separated (e.g., "2022,2023,2024")
- Used for "Good Standing" reports
- One year per member per subscription record

---

## 📊 Table Features

### Sortable Columns
- Membership Number
- Member Type
- Full Name
- Organization
- Position/Designation
- Region
- Date
- Email
- Subscriptions

### Pagination
- 10 members per page
- Navigate with Previous/Next/Page numbers
- Shows current page count

### Action Icons
- 👁️ View: Quick preview of member
- ✏️ Edit: Open edit form
- 🗑️ Delete: Remove member (with confirmation)

---

## 🐛 Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| No data loads | Check if backend running (npm start) |
| Export button does nothing | Check if data is loaded first |
| Form won't submit | Check required fields (marked *) |
| Date looks wrong | Ensure format is correct |
| Filters not working | Refresh page (F5), check data |
| Modal won't close | Click X button or click outside |
| Can't type in search | Make sure search box is focused |

---

## 🎯 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| F5 | Refresh page (reload data) |
| F12 | Open Developer Console |
| Ctrl+A | Select all text in search |
| Tab | Move to next form field |
| Enter | Submit form or search |
| Escape | Close modal dialog |

---

## 📞 When Things Go Wrong

1. **Check Browser Console**
   - Press F12 → Console tab
   - Look for error messages

2. **Check Network Tab**
   - F12 → Network tab
   - Make sure API calls succeed (green 200 status)

3. **Check if Backend Running**
   - Should see: "listening on port 3000"
   - Try accessing: http://localhost:3000/api/members

4. **Common Issues**
   - API URL wrong → Update in HTML files
   - Database not initialized → Run migration
   - Member type mismatch → Check spelling

---

## 📁 Important Files

```
index.html          → Main dashboard
good_standing.html  → Good standing report
server.js           → Backend API (run with npm start)
config.js           → Configuration (API endpoints, regions)
database_schema.sql → Database schema
package.json        → Dependencies
```

---

## 📖 Documentation Files

```
FRONTEND_GUIDE.md       → Detailed testing guide (START HERE)
FRONTEND_CHECKLIST.md   → Complete feature list
SUMMARY.md              → Day's work summary
CHANGES_LOG.md          → Detailed changes made
MIGRATION_GUIDE.md      → Database migration steps
README.md               → Project overview
```

---

## ✅ Pre-Launch Checklist

Before going live:
- [ ] Backend server running (npm start)
- [ ] Database initialized with schema
- [ ] Test adding a member
- [ ] Test searching/filtering
- [ ] Test export to CSV
- [ ] Test good standing report
- [ ] Test on mobile device
- [ ] Test error handling

---

## 🎓 Learning Resources

1. **Features**: See FRONTEND_CHECKLIST.md
2. **Testing**: See FRONTEND_GUIDE.md
3. **How It Works**: See SUMMARY.md
4. **What Changed**: See CHANGES_LOG.md
5. **Setup**: See README.md

---

## 📞 Support

**For Frontend Questions:**
1. Check FRONTEND_GUIDE.md (testing section)
2. Check FRONTEND_CHECKLIST.md (features section)
3. Look at browser console (F12)
4. Check network tab for API issues

**For Backend Questions:**
- Wait for next phase
- Refer to server.js documentation
- Check database schema

---

## 🚀 Ready?

The frontend is **100% complete** and ready to use!

**Next Steps:**
1. Start backend: `npm start`
2. Open dashboard: http://localhost:3000
3. Test with the guide: FRONTEND_GUIDE.md
4. Report any issues: Check troubleshooting section

---

**Version**: 1.0  
**Last Updated**: February 5, 2026  
**Status**: ✅ Complete & Ready
