require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: (process.env.DB_PASSWORD || '').replace(/['"]/g, ''),
    port: parseInt(process.env.DB_PORT)
});

async function check() {
    try {
        // Test the payment-summary API via direct DB logic simulation
        // (API needs auth, so simulate the recalculation)
        const res = await pool.query(`
            SELECT s.subscription_year, s.amount_paid, s.expected_amount, 
                   s.credit_applied, s.credit_balance, s.status,
                   COALESCE(sr.expected_amount, 0) as rate_expected_amount
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = 'AIOD' 
                AND sr.subscription_year = s.subscription_year
                AND sr.membership_category IS NULL
            WHERE s.member_id = 4196
            ORDER BY s.subscription_year ASC
        `);

        console.log('Kenneth (4196) - Raw DB data with rate lookup:');
        console.table(res.rows);

        // Simulate the recalculation logic from the fixed payment-summary endpoint
        let carryForward = 0;
        console.log('\n--- Recalculated credit chain ---');
        for (const sub of res.rows) {
            const rateExpected = parseFloat(sub.rate_expected_amount || 0);
            const amountPaid = parseFloat(sub.amount_paid || 0);
            const creditApplied = carryForward;
            const totalAvailable = amountPaid + creditApplied;
            const appliedToYear = rateExpected > 0 ? Math.min(totalAvailable, rateExpected) : totalAvailable;
            const creditBalance = rateExpected > 0 ? Math.max(0, totalAvailable - rateExpected) : 0;
            const totalAppliedDisplay = totalAvailable - creditBalance;

            console.log(`Year ${sub.subscription_year}: paid=₵${amountPaid}, credit_from_prev=₵${creditApplied}, rate_expected=₵${rateExpected}, total_applied=₵${totalAppliedDisplay}, excess_to_next=₵${creditBalance}`);
            carryForward = creditBalance;
        }

        // Also check F.E Adu-Boateng (1940)
        const res2 = await pool.query(`
            SELECT s.subscription_year, s.amount_paid, s.expected_amount, 
                   s.credit_applied, s.credit_balance,
                   COALESCE(sr.expected_amount, 0) as rate_expected_amount
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = 'MIOD' 
                AND sr.subscription_year = s.subscription_year
                AND sr.membership_category IS NULL
            WHERE s.member_id = 1940
            ORDER BY s.subscription_year ASC
        `);

        console.log('\nF.E Adu-Boateng (1940) - Recalculated:');
        carryForward = 0;
        for (const sub of res2.rows) {
            const rateExpected = parseFloat(sub.rate_expected_amount || 0);
            const amountPaid = parseFloat(sub.amount_paid || 0);
            const creditApplied = carryForward;
            const totalAvailable = amountPaid + creditApplied;
            const creditBalance = rateExpected > 0 ? Math.max(0, totalAvailable - rateExpected) : 0;
            const totalAppliedDisplay = totalAvailable - creditBalance;

            console.log(`Year ${sub.subscription_year}: paid=₵${amountPaid}, credit_from_prev=₵${creditApplied}, expected=₵${rateExpected}, total_applied=₵${totalAppliedDisplay}, excess_to_next=₵${creditBalance}`);
            carryForward = creditBalance;
        }

    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

check();
