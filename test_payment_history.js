const http = require('http');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_MEMBER_ID = 1; // Will test with first member

function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + path);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Payment History API Tests');
    console.log('========================================\n');

    try {
        // Test 1: Record a payment
        console.log('TEST 1: Record a payment...');
        const paymentRes = await makeRequest('POST', '/api/payments', {
            member_id: TEST_MEMBER_ID,
            payment_amount: 5000,
            payment_date: '2026-05-10',
            payment_method: 'Bank Transfer',
            receipt_number: 'RCPT-001',
            notes: 'Excess payment to cover 2026-2027'
        });
        console.log(`Status: ${paymentRes.status}`);
        console.log(`Response: ${JSON.stringify(paymentRes.data, null, 2)}\n`);

        // Test 2: Get member's payment history
        console.log('TEST 2: Get payment history for member...');
        const historyRes = await makeRequest('GET', `/api/payments/${TEST_MEMBER_ID}`);
        console.log(`Status: ${historyRes.status}`);
        console.log(`Response: ${JSON.stringify(historyRes.data, null, 2)}\n`);

        // Test 3: Get member's current balance
        console.log('TEST 3: Get member balance...');
        const balanceRes = await makeRequest('GET', `/api/member-balance/${TEST_MEMBER_ID}`);
        console.log(`Status: ${balanceRes.status}`);
        if (balanceRes.data.current_balance !== undefined) {
            console.log(`Current Balance: ₵ ${balanceRes.data.current_balance.toFixed(2)}`);
            console.log(`Subscriptions:\n${JSON.stringify(balanceRes.data.subscriptions, null, 2)}\n`);
        } else {
            console.log(`Response: ${JSON.stringify(balanceRes.data, null, 2)}\n`);
        }

        // Test 4: Get subscription with balance for specific year
        console.log('TEST 4: Get subscription with balance for 2026...');
        const subRes = await makeRequest('GET', `/api/subscription-with-balance/${TEST_MEMBER_ID}/2026`);
        console.log(`Status: ${subRes.status}`);
        console.log(`Response: ${JSON.stringify(subRes.data, null, 2)}\n`);

        // Test 5: Record another payment for different year
        console.log('TEST 5: Record payment for specific subscription year...');
        const payment2Res = await makeRequest('POST', '/api/payments', {
            member_id: TEST_MEMBER_ID,
            payment_amount: 350,
            payment_date: '2026-05-14',
            payment_method: 'Cash',
            receipt_number: 'RCPT-002',
            notes: 'Payment for 2026 subscription',
            subscription_year: 2026
        });
        console.log(`Status: ${payment2Res.status}`);
        console.log(`Response: ${JSON.stringify(payment2Res.data, null, 2)}\n`);

        // Test 6: Get updated payment history
        console.log('TEST 6: Get updated payment history...');
        const historyRes2 = await makeRequest('GET', `/api/payments/${TEST_MEMBER_ID}`);
        console.log(`Status: ${historyRes2.status}`);
        console.log(`Payments Count: ${historyRes2.data.length}`);
        console.log(`Response: ${JSON.stringify(historyRes2.data, null, 2)}\n`);

        console.log('========================================');
        console.log('All tests completed successfully!');
        console.log('========================================\n');

    } catch (error) {
        console.error('Test Error:', error);
    }
}

// Wait for server to be ready and run tests
setTimeout(runTests, 2000);
