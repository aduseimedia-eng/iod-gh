# Payment History & Balance System - User Guide

## Overview
The Payment History System allows admins to track member payments and automatically calculate balances that carry over to future subscription years. This enables members to pay in excess in one year to cover future years' subscriptions.

## How It Works

### Example: Multi-Year Payment Scenario

**Year 2024:**
- Member: Gideon Akpabu
- Subscription Amount Due: ₵3,000
- Payment Received: ₵5,000 (excess of ₵2,000)
- Status: Good Standing ✓
- Remaining Balance: ₵2,000

**Year 2025:**
- Subscription Amount Due: ₵3,000
- Applied Balance from 2024: ₵2,000
- Still Need to Collect: ₵1,000
- Status: Pending (balance covers part, needs ₵1,000 more)

**Year 2025 (After Payment):**
- New Payment Received: ₵1,000
- Total (Balance + Payment): ₵3,000
- Status: Good Standing ✓
- Remaining Balance: ₵0

## Using the Payment History Feature

### Step 1: Open Member Details
1. Login to the admin dashboard
2. Find the member in the members list
3. Click on the member name or "Edit" button
4. The member detail modal opens

### Step 2: Locate Payment History Section
Scroll down to find the "Payment History & Balance" section showing:
- Current Balance (₵ amount)
- Total Paid (cumulative)

### Step 3: Record a New Payment
In the "Record New Payment" form:
1. **Amount** (required): Enter the payment amount in ₵
2. **Payment Date** (required): Select the date payment was received
3. **Method** (optional): Select payment method
   - Cash
   - Bank Transfer
   - Mobile Money
   - Cheque
   - Card
4. **Receipt #** (optional): Enter receipt/transaction number
5. **Notes** (optional): Add any notes (e.g., "Covers 2024 and 2025")
6. Click "Record Payment"

### Step 4: View Payment History
The payment table below shows all recorded payments with:
- Date
- Amount
- Payment Method
- Receipt Number

### Step 5: Check Subscription Status
The "Subscription Status by Year" section displays:
- **Year**: Subscription year
- **Expected Amount**: Amount due for that year
- **Paid + Balance**: Total amount available (payments + carried-over balance)
- **Balance**: Any remaining credit for future years
- **Status**: "Good Standing" or "Pending"

## API Integration (For Developers)

### Record Payment
```
POST /api/payments
{
  "member_id": 42,
  "payment_amount": 5000,
  "payment_date": "2026-05-10",
  "payment_method": "Bank Transfer",
  "receipt_number": "RCPT-001",
  "notes": "Excess payment for future years",
  "subscription_year": 2024  // Optional
}
```

### Get Payment History
```
GET /api/payments/:memberId
Returns: Array of payments ordered by date
```

### Get Member Balance
```
GET /api/member-balance/:memberId
Returns: {
  current_balance: 2000.00,
  subscriptions: [...]
}
```

### Get Subscription with Balance
```
GET /api/subscription-with-balance/:memberId/:year
Returns: Detailed subscription info with balance calculations
```

## Best Practices

1. **Record Payments Promptly**
   - Record payments in the system as soon as they're received
   - This ensures accurate real-time balance tracking

2. **Add Detailed Notes**
   - If a payment covers multiple years, note this
   - Include reference numbers for reconciliation

3. **Regular Balance Reviews**
   - Check member balances periodically
   - Identify members with credits available
   - Monitor members who have pending subscriptions

4. **Year-End Reconciliation**
   - At year-end, review all members' balances
   - Identify any discrepancies
   - Apply unused credits to the next year or issue refunds

## Status Indicators

### Good Standing ✓
- Paid amount + applied balance ≥ required amount
- Member is current with subscriptions
- Shown in green

### Pending ⏳
- Paid amount + applied balance < required amount
- Member still owes for subscription
- Shown in red

### Waived
- Amount is waived (typically for Honorary members)
- Shown in gray

## Troubleshooting

### Q: Payment recorded but balance didn't update
**A:** Refresh the member modal by closing and reopening it, or reload the page.

### Q: Member shows as "Pending" but should be "Good Standing"
**A:** Check that:
- Payment was recorded with correct amount
- Payment date is in the correct year
- Balance from previous year was properly carried over
- Run the subscription status calculation function

### Q: Can I edit or delete a recorded payment?
**A:** Currently, payments can only be added. To correct an error, contact system administrator.

## Contact Support
For issues or feature requests, contact the system administrator or IOD-Ghana finance team.
