// ============================================================
// Institute of Directors - Ghana
// Unified Member Database API
// ============================================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.txt', '.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'));
        }
    }
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

// ============================================================
// AUTHENTICATION SETUP (credentials stored in database)
// ============================================================

app.set('trust proxy', 1);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true
}));
app.use(express.json());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'iod-ghana-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
    }
}));

// Login endpoint (no auth required)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const admin = result.rows[0];
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        req.session.authenticated = true;
        req.session.user = admin.username;
        req.session.adminId = admin.id;
        res.json({ message: 'Login successful', user: admin.username });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

// Check auth status endpoint
app.get('/api/auth-status', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.json({ authenticated: true, user: req.session.user });
    }
    res.json({ authenticated: false });
});

// In-memory storage for password reset codes (temporary, expires after 30 minutes)
const resetCodes = new Map();

// Generate password reset code
app.post('/api/request-password-reset', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }
    try {
        // Verify user exists
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username.trim()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Admin user not found' });
        }
        
        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expireTime = Date.now() + 30 * 60 * 1000; // 30 minutes
        
        resetCodes.set(username.trim(), { code, expireTime });
        
        // Log the code for admin to retrieve from server logs
        console.log(`\n${'='.repeat(60)}`);
        console.log(`PASSWORD RESET REQUEST for ${username.trim()}`);
        console.log(`Verification Code: ${code}`);
        console.log(`Valid for 30 minutes until: ${new Date(expireTime).toLocaleString()}`);
        console.log(`${'='.repeat(60)}\n`);
        
        res.json({ message: 'Reset code generated. Check server logs for verification code.' });
    } catch (err) {
        console.error('Password reset request error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset password endpoint
app.post('/api/reset-password', async (req, res) => {
    const { username, newPassword, verificationCode } = req.body;
    
    if (!username || !newPassword || !verificationCode) {
        return res.status(400).json({ error: 'Username, password, and verification code are required' });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    const trimmedUsername = username.trim();
    const trimmedCode = verificationCode.trim();
    
    try {
        // Verify code
        const storedReset = resetCodes.get(trimmedUsername);
        if (!storedReset) {
            return res.status(401).json({ error: 'Invalid or expired verification code. Request a new one.' });
        }
        
        if (Date.now() > storedReset.expireTime) {
            resetCodes.delete(trimmedUsername);
            return res.status(401).json({ error: 'Verification code expired. Request a new one.' });
        }
        
        if (storedReset.code !== trimmedCode) {
            return res.status(401).json({ error: 'Invalid verification code' });
        }
        
        // Verify user exists
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [trimmedUsername]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Admin user not found' });
        }
        
        // Update password
        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE username = $2', [newHash, trimmedUsername]);
        
        // Clear the used code
        resetCodes.delete(trimmedUsername);
        
        console.log(`PASSWORD RESET SUCCESSFUL for ${trimmedUsername}`);
        
        res.json({ message: 'Password reset successfully! Please log in with your new password.' });
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// Change username endpoint
app.post('/api/change-username', async (req, res) => {
    if (!req.session || !req.session.authenticated) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const { currentPassword, newUsername } = req.body;
    if (!currentPassword || !newUsername) {
        return res.status(400).json({ error: 'Current password and new username are required' });
    }
    if (newUsername.trim().length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [req.session.adminId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin user not found' });
        const admin = result.rows[0];
        const valid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        await pool.query('UPDATE admin_users SET username = $1, updated_at = NOW() WHERE id = $2', [newUsername.trim(), admin.id]);
        req.session.user = newUsername.trim();
        res.json({ message: 'Username updated successfully', user: newUsername.trim() });
    } catch (err) {
        console.error('Change username error:', err);
        if (err.code === '23505') return res.status(400).json({ error: 'Username already taken' });
        res.status(500).json({ error: 'Server error' });
    }
});

// Change password endpoint
app.post('/api/change-password', async (req, res) => {
    if (!req.session || !req.session.authenticated) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [req.session.adminId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin user not found' });
        const admin = result.rows[0];
        const valid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, admin.id]);
        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Serve login page (no auth required)
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve staff dashboard (no auth required - view only)
app.get('/staff-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'staff-dashboard.html'));
});

// ============================================================
// STAFF READ-ONLY API ENDPOINTS (no auth required)
// ============================================================

// Staff: Get all members (read-only, limited fields)
app.get('/api/staff/members', async (req, res) => {
    try {
        const { member_type } = req.query;
        let query = `
            SELECT m.id, m.membership_number, m.member_type, m.title, m.first_name,
                   m.surname, m.last_name, m.other_names, m.organization, m.designation,
                   m.position, m.sector, m.region, m.phone_number, m.email,
                   m.gender, m.contact_person, m.postal_address,
                   m.membership_category,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) as subscription_years,
                   (SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC) FROM subscriptions WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')) as paid_years,
                   COALESCE((SELECT s2.status FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 'Pending') as payment_status
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id
        `;

        let result;
        if (member_type) {
            query += ` WHERE m.member_type = $1`;
            query += ` GROUP BY m.id ORDER BY m.membership_number`;
            result = await pool.query(query, [member_type]);
        } else {
            query += ` GROUP BY m.id ORDER BY m.membership_number`;
            result = await pool.query(query);
        }

        // Post-process: recalculate paid_years and payment_status using credit chain logic
        const members = await computeCreditAwarePaidYears(result.rows, pool);
        res.json(members);
    } catch (err) {
        console.error('Error fetching members for staff:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Staff: Get single member by ID (read-only)
app.get('/api/staff/members/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.id, m.membership_number, m.member_type, m.title, m.first_name,
                   m.surname, m.last_name, m.other_names, m.organization, m.designation,
                   m.position, m.sector, m.region, m.phone_number, m.email,
                   m.gender, m.contact_person, m.postal_address,
                   m.membership_category,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) as subscription_years,
                   (SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC) FROM subscriptions WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')) as paid_years,
                   COALESCE((SELECT s2.status FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 'Pending') as payment_status
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id
            WHERE m.id = $1
            GROUP BY m.id
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Post-process: recalculate paid_years and payment_status using credit chain logic
        const members = await computeCreditAwarePaidYears(result.rows, pool);
        res.json(members[0]);
    } catch (err) {
        console.error('Error fetching member for staff:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Staff: Good Standing report (read-only, no auth required)
app.get('/api/staff/good-standing/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        
        const allMembersResult = await pool.query(`
            SELECT DISTINCT m.id, m.membership_number, m.member_type, m.membership_category,
                   m.title, m.first_name, m.surname, m.last_name, m.other_names,
                   m.organization, m.designation, m.position, m.region, m.email, m.phone_number,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission
            FROM members m
            WHERE m.member_type IN ('FIOD', 'MIOD', 'AIOD', 'Corporate', 'Honorary')
        `);
        
        const goodStandingMembers = [];
        
        for (const member of allMembersResult.rows) {
            if (member.member_type === 'Honorary') {
                goodStandingMembers.push({
                    ...member,
                    subscription_year: year,
                    status: 'Waived',
                    amount_paid: 0,
                    credit_applied: 0,
                    expected_amount: 0,
                    recorded_by: null,
                    payment_date: null
                });
                continue;
            }
            
            const subsResult = await pool.query(`
                SELECT s.*, COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as rate_expected_amount,
                       s.receipt_number as recorded_by,
                       TO_CHAR(s.payment_date, 'DD/MM/YYYY') as payment_date_fmt
                FROM subscriptions s
                LEFT JOIN subscription_rates sr ON sr.member_type = $2 
                    AND sr.subscription_year = s.subscription_year
                    AND (
                        ($2 != 'Corporate' AND sr.membership_category IS NULL)
                        OR ($2 = 'Corporate' AND sr.membership_category = $3)
                    )
                WHERE s.member_id = $1 AND s.subscription_year <= $4
                ORDER BY s.subscription_year ASC
            `, [member.id, member.member_type, member.membership_category, year]);
            
            if (subsResult.rows.length === 0) continue;
            
            let carryForwardCredit = 0;
            let targetYearData = null;
            
            // Pre-fetch rates for gap year chaining
            const memberRateResult = await pool.query(`
                SELECT subscription_year, expected_amount FROM subscription_rates 
                WHERE member_type = $1
                AND (
                    ($1 != 'Corporate' AND membership_category IS NULL)
                    OR ($1 = 'Corporate' AND membership_category = $2)
                )
            `, [member.member_type, member.membership_category]);
            const memberRatesMap = {};
            for (const r of memberRateResult.rows) {
                memberRatesMap[r.subscription_year] = parseFloat(r.expected_amount || 0);
            }
            
            for (let i = 0; i < subsResult.rows.length; i++) {
                const sub = subsResult.rows[i];
                
                // Chain credit through gap years between subscriptions
                if (i > 0 && carryForwardCredit > 0) {
                    const prevSubYear = subsResult.rows[i - 1].subscription_year;
                    for (let gapYear = prevSubYear + 1; gapYear < sub.subscription_year; gapYear++) {
                        if (carryForwardCredit <= 0) break;
                        const gapRate = memberRatesMap[gapYear] || 0;
                        const gapOutcome = calculateCreditOutcome({
                            subscriptionYear: gapYear,
                            memberType: member.member_type,
                            explicitStatus: 'Pending',
                            amountPaid: 0,
                            expectedAmount: gapRate,
                            availableCredit: carryForwardCredit
                        });

                        if (gapYear === year) {
                            targetYearData = {
                                amountPaid: 0,
                                creditApplied: gapOutcome.creditApplied,
                                totalAvailable: gapOutcome.totalApplied,
                                rateExpected: gapRate,
                                creditBalance: gapOutcome.creditBalance,
                                recorded_by: null,
                                payment_date: null,
                                isWaived: gapOutcome.isWaived,
                                isLegacyPaid: gapOutcome.isLegacyPaid,
                                status: gapOutcome.status
                            };
                        }
                        carryForwardCredit = gapOutcome.creditBalance;
                    }
                }
                
                const rateExpected = parseFloat(sub.rate_expected_amount || 0);
                const outcome = calculateCreditOutcome({
                    subscriptionYear: sub.subscription_year,
                    memberType: member.member_type,
                    explicitStatus: sub.status,
                    amountPaid: sub.amount_paid,
                    expectedAmount: rateExpected,
                    availableCredit: carryForwardCredit,
                    isInductionYear: isInductionYearSubscription(member, sub.subscription_year, sub.status, sub.amount_paid)
                });
                
                if (sub.subscription_year === year) {
                    targetYearData = {
                        amountPaid: outcome.amountPaid,
                        creditApplied: outcome.creditApplied,
                        totalAvailable: outcome.totalApplied,
                        rateExpected,
                        creditBalance: outcome.creditBalance,
                        recorded_by: sub.recorded_by,
                        payment_date: sub.payment_date_fmt,
                        isWaived: outcome.isWaived,
                        isLegacyPaid: outcome.isLegacyPaid,
                        isInductionYear: outcome.isInductionYear,
                        status: outcome.status
                    };
                }
                
                carryForwardCredit = outcome.creditBalance;
            }
            
            if (!targetYearData) {
                // Chain credit through gap years from last subscription to target year
                const lastSubYear = subsResult.rows.length > 0 
                    ? subsResult.rows[subsResult.rows.length - 1].subscription_year : 0;
                
                for (let gapYear = lastSubYear + 1; gapYear <= year; gapYear++) {
                    if (carryForwardCredit <= 0) break;
                    const gapRate = memberRatesMap[gapYear] || 0;
                    const gapOutcome = calculateCreditOutcome({
                        subscriptionYear: gapYear,
                        memberType: member.member_type,
                        explicitStatus: 'Pending',
                        amountPaid: 0,
                        expectedAmount: gapRate,
                        availableCredit: carryForwardCredit
                    });
                    
                    if (gapYear === year) {
                        targetYearData = {
                            amountPaid: 0,
                            creditApplied: gapOutcome.creditApplied,
                            totalAvailable: gapOutcome.totalApplied,
                            rateExpected: gapRate,
                            creditBalance: gapOutcome.creditBalance,
                            recorded_by: null,
                            payment_date: null,
                            isWaived: gapOutcome.isWaived,
                            isLegacyPaid: gapOutcome.isLegacyPaid,
                            status: gapOutcome.status
                        };
                    }
                    carryForwardCredit = gapOutcome.creditBalance;
                }
            }
            
            const isGoodStanding = targetYearData && (
                targetYearData.status === 'Paid' ||
                targetYearData.status === 'Waived'
            );
            
            if (isGoodStanding) {
                goodStandingMembers.push({
                    ...member,
                    subscription_year: year,
                    status: targetYearData.status,
                    amount_paid: targetYearData.amountPaid,
                    credit_applied: targetYearData.creditApplied,
                    expected_amount: targetYearData.rateExpected,
                    is_induction_year: targetYearData.isInductionYear === true,
                    induction_note: targetYearData.isInductionYear ? 'Inducted this year' : null,
                    recorded_by: targetYearData.recorded_by,
                    payment_date: targetYearData.payment_date
                });
            }
        }
        
        goodStandingMembers.sort((a, b) => {
            if (a.member_type !== b.member_type) return a.member_type.localeCompare(b.member_type);
            return (a.membership_number || '').localeCompare(b.membership_number || '');
        });
        
        res.json(goodStandingMembers);
    } catch (err) {
        console.error('Error fetching good standing for staff:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Auth middleware - protect everything else
function requireAuth(req, res, next) {
    // Allow static assets (CSS, JS, fonts, images) without auth
    const ext = path.extname(req.path).toLowerCase();
    const publicExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    if (publicExts.includes(ext)) {
        return next();
    }
    
    if (req.session && req.session.authenticated) {
        return next();
    }
    
    // Allow staff read-only API without auth
    if (req.path.startsWith('/api/staff/')) {
        return next();
    }

    // Allow password reset endpoints without auth
    if (req.path === '/api/request-password-reset' || req.path === '/api/reset-password') {
        return next();
    }

    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    // For page requests, redirect to login
    res.redirect('/login.html');
}

// TEMP: CLEAR ALL MEMBERS (no auth - remove after use)
app.post('/api/admin/clear-all-members', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE members RESTART IDENTITY CASCADE');
        res.json({ success: true, message: 'All members deleted. Table structure preserved.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// TEMP: ADD EXPERTISE COLUMN MIGRATION
app.post('/api/admin/migrate-expertise', async (req, res) => {
    try {
        await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS expertise TEXT`);
        res.json({ success: true, message: 'expertise column added to members table.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use(requireAuth);

// Disable caching for HTML files
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});

app.use(express.static('.')); // Serve static files (HTML, CSS, JS)

// ============================================================
// ============================================================
// DATABASE CONNECTION
// ============================================================
require('dotenv').config();

function createDatabasePoolConfig() {
    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
        };
    }

    return {
        user: process.env.DB_USER || process.env.PGUSER || 'postgres',
        host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
        database: process.env.DB_NAME || process.env.PGDATABASE || 'iod_ghana',
        password: (process.env.DB_PASSWORD || process.env.PGPASSWORD || '').replace(/['"]/g, ''),
        port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
}

const pool = new Pool(createDatabasePoolConfig());

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected:', res.rows[0]);
    }
});

// ============================================================
// AUTO-INITIALIZE SUBSCRIPTION RATES TABLE
// ============================================================
async function initializeAdminUsers() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        const adminCount = await pool.query('SELECT COUNT(*) FROM admin_users');
        if (parseInt(adminCount.rows[0].count, 10) === 0) {
            const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim();
            const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123!';
            const passwordHash = await bcrypt.hash(defaultPassword, 10);

            await pool.query(
                'INSERT INTO admin_users (username, password_hash, email) VALUES ($1, $2, $3)',
                [defaultUsername, passwordHash, process.env.ADMIN_DEFAULT_EMAIL || 'admin@iodghana.org']
            );

            console.log(`Default admin user "${defaultUsername}" created`);
        }

        console.log('Admin users table initialized successfully');
    } catch (err) {
        console.error('Error initializing admin users table:', err);
    }
}

async function initializeSubscriptionRates() {
    try {
        // Create subscription_rates table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS subscription_rates (
                id SERIAL PRIMARY KEY,
                member_type VARCHAR(50) NOT NULL CHECK (member_type IN ('AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate')),
                subscription_year INTEGER NOT NULL,
                expected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                early_bird_amount DECIMAL(10, 2) DEFAULT NULL,
                early_bird_deadline DATE DEFAULT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (member_type, subscription_year)
            )
        `);
        
        // Add early bird columns if they don't exist
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscription_rates' AND column_name = 'early_bird_amount'
                ) THEN
                    ALTER TABLE subscription_rates ADD COLUMN early_bird_amount DECIMAL(10, 2) DEFAULT NULL;
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscription_rates' AND column_name = 'early_bird_deadline'
                ) THEN
                    ALTER TABLE subscription_rates ADD COLUMN early_bird_deadline DATE DEFAULT NULL;
                END IF;
            END $$
        `);
        
        // Add credit_balance column to subscriptions if not exists
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscriptions' AND column_name = 'credit_balance'
                ) THEN
                    ALTER TABLE subscriptions ADD COLUMN credit_balance DECIMAL(10, 2) DEFAULT 0.00;
                END IF;
            END $$
        `);
        
        // Add expected_amount column to subscriptions if not exists
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscriptions' AND column_name = 'expected_amount'
                ) THEN
                    ALTER TABLE subscriptions ADD COLUMN expected_amount DECIMAL(10, 2) DEFAULT 0.00;
                END IF;
            END $$
        `);
        
        // Add credit_applied column to subscriptions if not exists
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscriptions' AND column_name = 'credit_applied'
                ) THEN
                    ALTER TABLE subscriptions ADD COLUMN credit_applied DECIMAL(10, 2) DEFAULT 0.00;
                END IF;
            END $$
        `);
        
        // Create index if not exists
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_subscription_rates_type_year 
            ON subscription_rates(member_type, subscription_year)
        `);
        
        // ============================================================
        // CORPORATE CATEGORY RATES MIGRATION
        // Add membership_category column for per-category Corporate rates
        // ============================================================
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'subscription_rates' AND column_name = 'membership_category'
                ) THEN
                    ALTER TABLE subscription_rates ADD COLUMN membership_category VARCHAR(50) DEFAULT NULL;
                END IF;
            END $$
        `);
        
        // Drop old unique constraint and create new one that includes membership_category
        await pool.query(`
            DO $$
            BEGIN
                -- Drop old constraint if it exists
                IF EXISTS (
                    SELECT 1 FROM pg_constraint 
                    WHERE conname = 'subscription_rates_member_type_subscription_year_key'
                ) THEN
                    ALTER TABLE subscription_rates DROP CONSTRAINT subscription_rates_member_type_subscription_year_key;
                END IF;
            END $$
        `);
        
        // Create unique index that handles NULL membership_category properly
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_rates_type_year_category
            ON subscription_rates(member_type, subscription_year, COALESCE(membership_category, ''))
        `);

        // Insert default rates for years 2025-2035 if table is empty (non-corporate)
        const existingRates = await pool.query('SELECT COUNT(*) FROM subscription_rates WHERE member_type != $1', ['Corporate']);
        if (parseInt(existingRates.rows[0].count) === 0) {
            const memberTypes = [
                { type: 'AIOD', amount: 350.00, category: null, desc: 'Associate annual subscription' },
                { type: 'FIOD', amount: 500.00, category: null, desc: 'Fellow annual subscription' },
                { type: 'MIOD', amount: 400.00, category: null, desc: 'Member annual subscription' },
                { type: 'Honorary', amount: 0.00, category: null, desc: 'Honorary - waived' }
            ];
            
            for (let year = 2025; year <= 2035; year++) {
                for (const mt of memberTypes) {
                    let expectedAmount = mt.amount;
                    if (year === 2025 && mt.type === 'AIOD') {
                        expectedAmount = 400.00;
                    } else if (year === 2025 && mt.type === 'MIOD') {
                        expectedAmount = 800.00;
                    }

                    await pool.query(`
                        INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, membership_category, description)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, '')) DO NOTHING
                    `, [mt.type, year, expectedAmount, mt.category, mt.desc]);
                }
            }
            console.log('Default subscription rates initialized for years 2025-2035');
        }

        // Correct 2025 rates even when rows were seeded earlier with outdated values.
        const corrected2025Rates = [
            { type: 'AIOD', amount: 400.00, desc: 'Associate annual subscription (2025 corrected rate)' },
            { type: 'MIOD', amount: 800.00, desc: 'Member annual subscription (2025 corrected rate)' }
        ];

        for (const rate of corrected2025Rates) {
            await pool.query(`
                INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, membership_category, description)
                VALUES ($1, 2025, $2, NULL, $3)
                ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, ''))
                DO UPDATE SET
                    expected_amount = EXCLUDED.expected_amount,
                    description = EXCLUDED.description,
                    updated_at = CURRENT_TIMESTAMP
            `, [rate.type, rate.amount, rate.desc]);
        }
        
        // Clean up legacy flat Corporate rows (no category) — only per-category rows should exist
        await pool.query(
            "DELETE FROM subscription_rates WHERE member_type = 'Corporate' AND (membership_category IS NULL OR membership_category = '')"
        );

        // Seed Corporate category rates if they don't exist
        const existingCorpCatRates = await pool.query(
            "SELECT COUNT(*) FROM subscription_rates WHERE member_type = 'Corporate' AND membership_category IS NOT NULL"
        );
        if (parseInt(existingCorpCatRates.rows[0].count) === 0) {
            const corpCategories = [
                { category: 'Platinum', amount: 10000.00, desc: 'Corporate Platinum annual subscription' },
                { category: 'Gold', amount: 7500.00, desc: 'Corporate Gold annual subscription' },
                { category: 'Silver', amount: 5000.00, desc: 'Corporate Silver annual subscription' },
                { category: 'Bronze', amount: 3000.00, desc: 'Corporate Bronze annual subscription' }
            ];
            
            for (let year = 2025; year <= 2035; year++) {
                for (const cc of corpCategories) {
                    await pool.query(`
                        INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, membership_category, description)
                        VALUES ('Corporate', $1, $2, $3, $4)
                        ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, '')) DO NOTHING
                    `, [year, cc.amount, cc.category, cc.desc]);
                }
            }
            console.log('Corporate category rates initialized (Platinum/Gold/Silver/Bronze) for 2025-2035');
        }
        
        console.log('Subscription rates table initialized successfully');
    } catch (err) {
        console.error('Error initializing subscription rates table:', err);
    }
}

async function initializeApplication() {
    await initializeAdminUsers();
    await initializeSubscriptionRates();
}

// Run initialization
initializeApplication();

// ============================================================
// INPUT VALIDATION HELPERS
// ============================================================

function validateEmail(email) {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Support multiple emails separated by comma or newline
    const emails = email.split(/[,\n]+/).map(e => e.trim()).filter(e => e);
    return emails.every(e => emailRegex.test(e));
}

function validateMemberType(memberType) {
    const validTypes = ['AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate'];
    return validTypes.includes(memberType);
}

function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str.trim()
        .replace(/[<>]/g, '') // Remove angle brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+=/gi, ''); // Remove event handlers
}

function validateAndSanitizeMemberData(data) {
    const errors = [];
    
    // No required field validation - allow flexible CSV uploads
    // Email validation only if email is provided
    if (data.email && !validateEmail(data.email)) {
        errors.push('Invalid email format');
    }
    
    // Sanitize all string fields
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
    }
    
    return { errors, sanitized };
}

// ============================================================
// ROOT ROUTE
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// HELPER: Compute credit-aware paid_years and payment_status
// ============================================================
async function computeCreditAwarePaidYears(members, pool) {
    if (!members || members.length === 0) return members;

    const currentYear = new Date().getFullYear();
    const memberIds = members.map(m => m.id);

    // Fetch ALL subscriptions + rates for all members in one query
    const allSubsResult = await pool.query(`
        SELECT s.member_id, s.subscription_year, s.amount_paid, s.status,
               COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as rate_expected_amount,
               m.member_type, m.membership_category
        FROM subscriptions s
        JOIN members m ON m.id = s.member_id
        LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type 
            AND sr.subscription_year = s.subscription_year
            AND (
                (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
            )
        WHERE s.member_id = ANY($1)
        ORDER BY s.member_id, s.subscription_year ASC
    `, [memberIds]);

    // Fetch ALL rates (not just current year) for gap year chaining
    const allRatesResult = await pool.query(`
        SELECT member_type, membership_category, subscription_year, expected_amount 
        FROM subscription_rates
    `);

    // Build a rates lookup: key => { year => rate }
    const allRates = {};
    for (const r of allRatesResult.rows) {
        const key = (r.member_type === 'Corporate' && r.membership_category) ? `${r.member_type}:${r.membership_category}` : r.member_type;
        if (!allRates[key]) allRates[key] = {};
        allRates[key][r.subscription_year] = parseFloat(r.expected_amount || 0);
    }

    // Group subscriptions by member_id
    const subsByMember = {};
    for (const sub of allSubsResult.rows) {
        if (!subsByMember[sub.member_id]) subsByMember[sub.member_id] = [];
        subsByMember[sub.member_id].push(sub);
    }

    // Process each member
    for (const member of members) {
        const subs = subsByMember[member.id] || [];
        
        if (member.member_type === 'Honorary') {
            // Honorary members: all subscription years are "paid", status is always Waived
            member.payment_status = 'Waived';
            continue; // paid_years already set from SQL for Honorary
        }

        // Walk through years chronologically, carry forward excess
        let carryForwardCredit = 0;
        const creditPaidYears = new Set();
        const existingPaidYears = Array.isArray(member.paid_years) ? new Set(member.paid_years) : new Set();

        const rateKey = (member.member_type === 'Corporate' && member.membership_category) ? `${member.member_type}:${member.membership_category}` : member.member_type;
        const memberRates = allRates[rateKey] || {};

        for (let i = 0; i < subs.length; i++) {
            const sub = subs[i];

            // Chain credit through gap years between subscriptions
            if (i > 0 && carryForwardCredit > 0) {
                const prevSubYear = subs[i - 1].subscription_year;
                for (let gapYear = prevSubYear + 1; gapYear < sub.subscription_year; gapYear++) {
                    if (carryForwardCredit <= 0) break;
                    const gapRate = memberRates[gapYear] || 0;
                    const gapOutcome = calculateCreditOutcome({
                        subscriptionYear: gapYear,
                        memberType: member.member_type,
                        explicitStatus: 'Pending',
                        amountPaid: 0,
                        expectedAmount: gapRate,
                        availableCredit: carryForwardCredit
                    });

                    if (gapOutcome.status === 'Paid' || gapOutcome.status === 'Waived') {
                        creditPaidYears.add(gapYear);
                    }
                    carryForwardCredit = gapOutcome.creditBalance;
                }
            }

            const rateExpected = parseFloat(sub.rate_expected_amount || 0);
            const outcome = calculateCreditOutcome({
                subscriptionYear: sub.subscription_year,
                memberType: member.member_type,
                explicitStatus: sub.status,
                amountPaid: sub.amount_paid,
                expectedAmount: rateExpected,
                availableCredit: carryForwardCredit,
                isInductionYear: isInductionYearSubscription(member, sub.subscription_year, sub.status, sub.amount_paid)
            });

            if (outcome.status === 'Paid' || outcome.status === 'Waived') {
                creditPaidYears.add(sub.subscription_year);
            }
            carryForwardCredit = outcome.creditBalance;
        }

        // Chain credit through gap years from last subscription up to current year
        {
            const lastSubYear = subs.length > 0 ? subs[subs.length - 1].subscription_year : currentYear;
            
            for (let year = lastSubYear + 1; year <= currentYear; year++) {
                if (carryForwardCredit <= 0) break;
                const yearRate = memberRates[year] || 0;
                const outcome = calculateCreditOutcome({
                    subscriptionYear: year,
                    memberType: member.member_type,
                    explicitStatus: 'Pending',
                    amountPaid: 0,
                    expectedAmount: yearRate,
                    availableCredit: carryForwardCredit
                });
                if (outcome.status === 'Paid' || outcome.status === 'Waived') {
                    creditPaidYears.add(year);
                }
                carryForwardCredit = outcome.creditBalance;
            }
        }

        // Merge existing paid_years with credit-determined paid years
        for (const y of existingPaidYears) {
            creditPaidYears.add(y);
        }

        // Update paid_years - sorted descending
        member.paid_years = Array.from(creditPaidYears).sort((a, b) => b - a);

        // Also add credit-covered years to subscription_years if not already there
        const subYears = new Set(Array.isArray(member.subscription_years) ? member.subscription_years : []);
        for (const y of creditPaidYears) {
            subYears.add(y);
        }
        member.subscription_years = Array.from(subYears).sort((a, b) => b - a);

        // Recompute payment_status based on current year
        if (creditPaidYears.has(currentYear)) {
            member.payment_status = 'Paid';
        }
        // If not paid for current year but has some payment, keep existing status
    }

    return members;
}

// ============================================================
// UNIFIED MEMBERS ENDPOINTS
// ============================================================

// Get all members
app.get('/api/members', async (req, res) => {
    try {
        const { member_type } = req.query;
        let query = `
            SELECT m.*,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission,
                   TO_CHAR(m.registration_date, 'DD/MM/YYYY') as registration_date,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) as subscription_years,
                   (SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC) FROM subscriptions WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')) as paid_years,
                   COALESCE((SELECT s2.amount_paid FROM subscriptions s2 WHERE s2.member_id = m.id AND s2.amount_paid IS NOT NULL ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 0) as amount_paid,
                   COALESCE((SELECT s2.status FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 'Pending') as payment_status,
                   (SELECT s2.receipt_number FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1) as recorded_by,
                   (SELECT s2.payment_method FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1) as payment_method
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id
        `;

        let result;
        if (member_type) {
            query += ` WHERE m.member_type = $1`;
            query += ` GROUP BY m.id ORDER BY m.membership_number`;
            result = await pool.query(query, [member_type]);
        } else {
            query += ` GROUP BY m.id ORDER BY m.membership_number`;
            result = await pool.query(query);
        }

        // Post-process: recalculate paid_years and payment_status using credit chain logic
        const members = await computeCreditAwarePaidYears(result.rows, pool);
        res.json(members);
    } catch (err) {
        console.error('Error fetching members:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get member by ID
app.get('/api/members/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission,
                   TO_CHAR(m.registration_date, 'DD/MM/YYYY') as registration_date,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) as subscription_years,
                   (SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC) FROM subscriptions WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')) as paid_years,
                   COALESCE((SELECT s2.amount_paid FROM subscriptions s2 WHERE s2.member_id = m.id AND s2.amount_paid IS NOT NULL ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 0) as amount_paid,
                   COALESCE((SELECT s2.status FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1), 'Pending') as payment_status,
                   (SELECT s2.receipt_number FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1) as recorded_by,
                   (SELECT s2.payment_method FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1) as payment_method
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id
            WHERE m.id = $1
            GROUP BY m.id
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Post-process: recalculate paid_years and payment_status using credit chain logic
        const members = await computeCreditAwarePaidYears(result.rows, pool);
        res.json(members[0]);
    } catch (err) {
        console.error('Error fetching member:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create member
app.post('/api/members', async (req, res) => {
    // Validate and sanitize input
    const { errors, sanitized } = validateAndSanitizeMemberData(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            member_type,
            title,
            first_name,
            surname,
            last_name,
            other_names,
            membership_category,
            gender,
            organization,
            designation,
            position,
            sector,
            region,
            postal_address,
            date_of_admission,
            registration_date,
            phone_number,
            email,
            feedback_on_calls,
            expertise,
            years_served_on_boards,
            srl_no,
            reg_no,
            contact_person,
            contact_phone,
            contact_email,
            subscription_years,
            payment_status,
            amount_paid,
            recorded_by,
            payment_method
        } = sanitized;

        // Generate membership number based on member type
        const prefixMap = {
            'AIOD': 'A',
            'FIOD': 'F',
            'MIOD': 'M',
            'Corporate': 'C',
            'Honorary': 'H'
        };
        const prefix = prefixMap[member_type] || 'M';
        
        // Get the highest number for this member type (only matching new format: X00000)
        const maxResult = await client.query(`
            SELECT membership_number, 
                   CAST(SUBSTRING(membership_number FROM 2) AS INTEGER) as num_part
            FROM members 
            WHERE membership_number ~ $1
            ORDER BY num_part DESC LIMIT 1
        `, ['^' + prefix + '[0-9]+$']);
        
        let nextNumber = 1;
        if (maxResult.rows.length > 0) {
            const numPart = maxResult.rows[0].num_part;
            if (numPart !== null && !isNaN(numPart)) {
                nextNumber = numPart + 1;
            }
        }
        
        const membership_number = prefix + String(nextNumber).padStart(5, '0');

        const memberResult = await client.query(`
            INSERT INTO members (
                membership_number, member_type, title, first_name, surname, last_name,
                other_names, membership_category, gender, organization, designation,
                position, sector, region, postal_address, date_of_admission,
                registration_date, phone_number, email, feedback_on_calls,
                expertise, years_served_on_boards, srl_no, reg_no, contact_person,
                contact_phone, contact_email
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
            ) RETURNING *
        `, [
            membership_number, member_type, title, first_name, surname, last_name,
            other_names, membership_category, gender, organization, designation,
            position, sector, region, postal_address, date_of_admission || null,
            registration_date || null, phone_number, email, feedback_on_calls,
            expertise, years_served_on_boards, srl_no, reg_no, contact_person,
            contact_phone, contact_email
        ]);

        const memberId = memberResult.rows[0].id;
        const admissionOrRegDate = date_of_admission || registration_date;
        const inductionYear = getYearFromDateValue(admissionOrRegDate);

        // Add subscription years - default to admission/registration year if not provided
        let yearsToAdd = subscription_years && subscription_years.length > 0 ? subscription_years : [];
        yearsToAdd = yearsToAdd
            .map(year => parseInt(year, 10))
            .filter(year => Number.isFinite(year));

        if (Number.isFinite(inductionYear) && !yearsToAdd.includes(inductionYear)) {
            yearsToAdd.push(inductionYear);
        }

        if (yearsToAdd.length > 0) {
            for (const year of yearsToAdd) {
                const isInductionYear = year === inductionYear;
                const subscriptionStatus = isInductionYear ? 'Paid' : (payment_status || 'Paid');
                const subscriptionAmount = isInductionYear ? 0 : (amount_paid || 0);

                await client.query(`
                    INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date, receipt_number, payment_method)
                    VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)
                    ON CONFLICT (member_id, subscription_year) DO UPDATE SET status = $3, amount_paid = $4, payment_date = CURRENT_DATE, receipt_number = $5, payment_method = $6
                `, [memberId, year, subscriptionStatus, subscriptionAmount, recorded_by || null, payment_method || null]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json(memberResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating member:', err);
        // Return detailed error message for debugging
        res.status(500).json({ error: (err && (err.message || err.toString())) || 'Database error', details: err });
    } finally {
        client.release();
    }
});

// ============================================================
// CSV/EXCEL IMPORT ENDPOINT
// ============================================================

// Helper function to detect CSV delimiter
function detectDelimiter(content) {
    const firstLine = content.split('\n')[0] || '';
    const delimiters = [',', ';', '\t', '|'];
    let bestDelimiter = ',';
    let maxCount = 0;
    
    for (const delim of delimiters) {
        const count = (firstLine.match(new RegExp(delim === '|' ? '\\|' : delim, 'g')) || []).length;
        if (count > maxCount) {
            maxCount = count;
            bestDelimiter = delim;
        }
    }
    return bestDelimiter;
}

// Helper function to find header row in CSV content
function findHeaderRow(lines, delimiter) {
    const expectedHeaders = ['membership', 'title', 'first', 'surname', 'name', 'type', 'gender', 
                            'organization', 'organisation', 'sector', 'region', 'designation', 
                            'date', 'phone', 'email', 'no'];
    
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i].toLowerCase();
        const matchCount = expectedHeaders.filter(h => line.includes(h)).length;
        if (matchCount >= 3) {
            return i;
        }
    }
    return 0; // Default to first row
}

// Helper function to parse file (CSV or Excel)
function buildUniqueImportHeaders(rawHeaders) {
    const seenHeaders = new Map();

    return rawHeaders.map((header, index) => {
        const trimmedHeader = String(header ?? '').trim();
        const baseHeader = trimmedHeader || `UNNAMED_COLUMN_${index + 1}`;
        const existingCount = seenHeaders.get(baseHeader) || 0;
        const nextCount = existingCount + 1;
        seenHeaders.set(baseHeader, nextCount);

        return nextCount === 1 ? baseHeader : `${baseHeader}__${nextCount}`;
    });
}

function parseFile(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    
    if (ext === '.xlsx' || ext === '.xls') {
        // Parse Excel file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Find the header row by looking for cells with column-like names
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        let headerRow = 0;
        const expectedHeaders = ['membership', 'title', 'first', 'surname', 'name', 'type', 'gender', 
                                'organization', 'organisation', 'sector', 'region', 'designation', 
                                'date', 'phone', 'email', 'no'];
        
        for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
            let matchCount = 0;
            for (let c = range.s.c; c <= range.e.c; c++) {
                const cellAddress = XLSX.utils.encode_cell({ r, c });
                const cell = worksheet[cellAddress];
                if (cell && cell.v) {
                    const cellValue = String(cell.v).toLowerCase();
                    if (expectedHeaders.some(h => cellValue.includes(h))) {
                        matchCount++;
                    }
                }
            }
            if (matchCount >= 3) {
                headerRow = r;
                break;
            }
        }
        
        // Convert to JSON starting from the header row
        const records = XLSX.utils.sheet_to_json(worksheet, { 
            defval: '',
            raw: false,
            range: headerRow
        });
        
        const headers = records.length > 0 ? Object.keys(records[0]) : [];
        
        return { records, headers, format: 'Excel', headerRow: headerRow + 1 };
    } else {
        // Parse CSV file
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        const delimiter = detectDelimiter(fileContent);
        
        // Find the header row
        const headerRowIndex = findHeaderRow(lines, delimiter);
        
        // If header is not on first row, reconstruct the content starting from header row
        let contentToParse = fileContent;
        if (headerRowIndex > 0) {
            contentToParse = lines.slice(headerRowIndex).join('\n');
        }
        
        const records = parse(contentToParse, {
            columns: header => buildUniqueImportHeaders(header),
            skip_empty_lines: true,
            trim: true,
            bom: true,
            delimiter: delimiter,
            relax_column_count: true,
            relax_quotes: true
        });
        
        const headers = records.length > 0 ? Object.keys(records[0]) : [];
        
        return { records, headers, format: 'CSV', delimiter, headerRow: headerRowIndex + 1 };
    }
}

function parseFlexibleDate(value) {
    if (!value) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    const normalizedText = raw.replace(/(\d+)(st|nd|rd|th)/gi, '$1').trim();

    const match = normalizedText.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        const first = parseInt(match[1], 10);
        const second = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);

        let day;
        let month;

        if (first > 12) {
            day = first;
            month = second;
        } else if (second > 12) {
            month = first;
            day = second;
        } else {
            // For ambiguous numeric dates, prefer day/month/year.
            day = first;
            month = second;
        }

        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
            parsed.getUTCFullYear() !== year ||
            parsed.getUTCMonth() !== month - 1 ||
            parsed.getUTCDate() !== day
        ) {
            return null;
        }

        return parsed.toISOString().split('T')[0];
    }

    const nativeDate = new Date(normalizedText);
    if (!isNaN(nativeDate.getTime())) {
        return nativeDate.toISOString().split('T')[0];
    }

    return null;
}

function normalizeImportGender(value) {
    if (value === undefined || value === null) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    const normalized = raw.toLowerCase();
    if (normalized === 'male' || normalized === 'm') return 'Male';
    if (normalized === 'female' || normalized === 'f') return 'Female';

    return null;
}

function normalizeImportHeader(header) {
    return String(header || '').toUpperCase().trim();
}

function isUnnamedImportHeader(header) {
    const normalized = normalizeImportHeader(header).replace(/[^A-Z0-9]/g, '');
    return normalized === '' || /^UNNAMEDCOLUMN\d+$/.test(normalized);
}

function isImportPaymentLikeValue(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!raw) return false;

    const normalized = raw.toLowerCase();
    const paymentMarkers = ['waiver', 'waived', 'w', 'exempt', 'true', '1', 'yes', 'paid', 'y', 'x', 'p', 'âœ“'];
    if (paymentMarkers.includes(normalized)) {
        return true;
    }

    const numericMatch = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!numericMatch) {
        return false;
    }

    const amount = parseFloat(numericMatch[0]);
    return !isNaN(amount) && amount > 0;
}

function detectCorporateImportFromHeaders(headers) {
    const normalizedHeaders = headers.map(h => normalizeImportHeader(h).replace(/[^A-Z0-9]/g, ''));
    const corporateMarkers = [
        'SRLNO',
        'SERIALNUMBER',
        'REGNO',
        'REGISTRATIONNO',
        'REGISTRATIONNUMBER',
        'MEMBERSHIPCATEGORY',
        'CONTACTPERSON',
        'CONTACTPHONE',
        'CONTACTEMAIL'
    ];

    const hasExplicitCorporateMarkers = corporateMarkers.some(marker =>
        normalizedHeaders.some(header => header === marker || header.includes(marker))
    );

    if (hasExplicitCorporateMarkers) {
        return true;
    }

    // Legacy corporate CSVs use Full Name + Membership Type + Membership category,
    // but omit the newer corporate-specific headers.
    const hasLegacyCorporateShape =
        normalizedHeaders.includes('FULLNAME') &&
        normalizedHeaders.includes('MEMBERSHIPTYPE') &&
        normalizedHeaders.includes('MEMBERSHIP') &&
        !normalizedHeaders.includes('FIRSTNAME') &&
        !normalizedHeaders.includes('SURNAME');

    return hasLegacyCorporateShape;
}

function inferLegacyCorporateSubscriptionColumns(headers, records) {
    const normalizedHeaders = headers.map(h => normalizeImportHeader(h).replace(/[^A-Z0-9]/g, ''));
    const hasLegacyCorporateShape =
        normalizedHeaders.includes('FULLNAME') &&
        normalizedHeaders.includes('MEMBERSHIPTYPE') &&
        normalizedHeaders.includes('MEMBERSHIP') &&
        !normalizedHeaders.includes('FIRSTNAME') &&
        !normalizedHeaders.includes('SURNAME');

    if (!hasLegacyCorporateShape) {
        return [];
    }

    const unnamedHeaders = headers.filter(isUnnamedImportHeader);
    const paymentLikeHeaders = unnamedHeaders.filter(header =>
        records.some(row => isImportPaymentLikeValue(row[header]))
    );

    if (paymentLikeHeaders.length === 0) {
        return [];
    }

    // Legacy corporate exports placed unlabeled 2024 and 2025 payment columns
    // at the far right of the sheet, left-to-right.
    const mappedYears = paymentLikeHeaders.length === 1 ? [2025] : [2024, 2025];
    const relevantHeaders = paymentLikeHeaders.slice(-mappedYears.length);

    return relevantHeaders.map((colName, index) => ({
        colName,
        year: mappedYears[index]
    }));
}

function extractSubscriptionColumns(headers, records = []) {
    const explicitSubscriptionColumns = headers.map(col => {
        const normalized = normalizeImportHeader(col);
        const yearMatch = normalized.match(/\b(20\d{2})\b/);
        if (!yearMatch) return null;

        const year = parseInt(yearMatch[1], 10);
        const hasPaymentKeyword = ['SUBSCRIPTION', 'SUBSCRIPT', 'PAYMENT', 'PAID', 'AMOUNT', 'FEE', 'DUES'].some(keyword => normalized.includes(keyword));
        const hasDateKeyword = ['DATE', 'ADMISSION', 'REGISTRATION', 'BIRTH', 'DOB'].some(keyword => normalized.includes(keyword));

        // Accept explicit payment/subscription columns, and also legacy year-only columns used in some corporate files.
        if (hasDateKeyword && !hasPaymentKeyword) return null;

        return { colName: col, year };
    }).filter(x => x !== null).sort((a, b) => a.year - b.year);

    if (explicitSubscriptionColumns.length > 0) {
        return explicitSubscriptionColumns;
    }

    return inferLegacyCorporateSubscriptionColumns(headers, records);
}

function parseImportedSubscriptionValue(value, memberType) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    const normalized = raw.toLowerCase();

    if (memberType === 'Honorary') {
        return {
            hasValue: raw !== '',
            status: 'Waived',
            amountPaid: 0
        };
    }

    if (!raw) {
        return {
            hasValue: false,
            status: 'Pending',
            amountPaid: 0
        };
    }

    const waivedMarkers = ['waiver', 'waived', 'w', 'exempt'];
    if (waivedMarkers.includes(normalized)) {
        return {
            hasValue: true,
            status: 'Waived',
            amountPaid: 0
        };
    }

    const paidMarkers = ['true', '1', 'yes', 'paid', 'y', 'x', 'p', '✓'];
    if (paidMarkers.includes(normalized)) {
        return {
            hasValue: true,
            status: 'Paid',
            amountPaid: 0
        };
    }

    const numericMatch = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (numericMatch) {
        const amountPaid = parseFloat(numericMatch[0]);
        if (!isNaN(amountPaid) && amountPaid > 0) {
            return {
                hasValue: true,
                status: 'Paid',
                amountPaid
            };
        }
    }

    return {
        hasValue: true,
        status: 'Pending',
        amountPaid: 0
    };
}

function hasPositiveAmount(value) {
    const amount = parseFloat(value || 0);
    return !isNaN(amount) && amount > 0;
}

function isLegacy2025Satisfied(subscriptionYear, amountPaid, status) {
    return parseInt(subscriptionYear, 10) === 2025 && (
        status === 'Paid' ||
        status === 'Waived' ||
        hasPositiveAmount(amountPaid)
    );
}

function getYearFromDateValue(value) {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.getFullYear();
    }

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(raw)) {
        const year = parseInt(raw.slice(0, 4), 10);
        return Number.isFinite(year) ? year : null;
    }

    const slashParts = raw.split('/');
    if (slashParts.length === 3) {
        const year = parseInt(slashParts[2], 10);
        return Number.isFinite(year) ? year : null;
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed.getFullYear();
}

function getMemberInductionYear(member) {
    if (!member) return null;
    const explicitYear = parseInt(member.induction_year, 10);
    if (Number.isFinite(explicitYear)) return explicitYear;

    return getYearFromDateValue(member.date_of_admission) ||
        getYearFromDateValue(member.registration_date) ||
        getYearFromDateValue(member.created_at);
}

function isInductionYearSubscription(member, subscriptionYear, explicitStatus) {
    const inductionYear = getMemberInductionYear(member);
    const year = parseInt(subscriptionYear, 10);

    return Number.isFinite(inductionYear) &&
        Number.isFinite(year) &&
        year === inductionYear &&
        explicitStatus === 'Paid';
}

function determineSubscriptionStatus({ subscriptionYear, memberType, explicitStatus, amountPaid, totalAvailable, expectedAmount }) {
    if (explicitStatus === 'Waived' || memberType === 'Honorary') {
        return 'Waived';
    }

    if (isLegacy2025Satisfied(subscriptionYear, amountPaid, explicitStatus)) {
        return 'Paid';
    }

    if (expectedAmount > 0 && totalAvailable >= expectedAmount) {
        return 'Paid';
    }

    if (totalAvailable > 0) {
        return 'Partial';
    }

    return 'Pending';
}

function normalizeMoney(value) {
    const amount = parseFloat(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        return 0;
    }
    return amount;
}

function calculateCreditOutcome({
    subscriptionYear,
    memberType,
    explicitStatus,
    amountPaid,
    expectedAmount,
    availableCredit,
    isInductionYear = false
}) {
    const paid = normalizeMoney(amountPaid);
    const expected = Math.max(0, parseFloat(expectedAmount || 0) || 0);
    const previousCredit = Math.max(0, parseFloat(availableCredit || 0) || 0);

    const isWaived = explicitStatus === 'Waived' || memberType === 'Honorary';
    if (isWaived) {
        return {
            status: 'Waived',
            amountPaid: paid,
            creditApplied: 0,
            totalApplied: paid,
            creditBalance: previousCredit + paid,
            isLegacyPaid: false,
            isWaived: true,
            isInductionYear: false
        };
    }

    if (isInductionYear) {
        return {
            status: 'Paid',
            amountPaid: paid,
            creditApplied: 0,
            totalApplied: paid,
            creditBalance: previousCredit + paid,
            isLegacyPaid: false,
            isWaived: false,
            isInductionYear: true
        };
    }

    const legacy2025Satisfied = isLegacy2025Satisfied(subscriptionYear, paid, explicitStatus);
    if (legacy2025Satisfied) {
        const cashOverpayment = expected > 0 ? Math.max(0, paid - expected) : paid;
        return {
            status: 'Paid',
            amountPaid: paid,
            creditApplied: 0,
            totalApplied: paid,
            creditBalance: previousCredit + cashOverpayment,
            isLegacyPaid: true,
            isWaived: false,
            isInductionYear: false
        };
    }

    let creditApplied = 0;
    let totalApplied = paid;
    let creditBalance = previousCredit;

    if (expected > 0) {
        const requiredFromCredit = Math.max(0, expected - paid);
        creditApplied = Math.min(previousCredit, requiredFromCredit);
        totalApplied = paid + creditApplied;

        const remainingCredit = previousCredit - creditApplied;
        const cashOverpayment = Math.max(0, paid - expected);
        creditBalance = remainingCredit + cashOverpayment;
    } else {
        // No configured rate: carry forward unused credit plus all cash payment.
        creditBalance = previousCredit + paid;
    }

    const status = determineSubscriptionStatus({
        subscriptionYear,
        memberType,
        explicitStatus,
        amountPaid: paid,
        totalAvailable: totalApplied,
        expectedAmount: expected
    });

    return {
        status,
        amountPaid: paid,
        creditApplied,
        totalApplied,
        creditBalance,
        isLegacyPaid: false,
        isWaived: false,
        isInductionYear: false
    };
}

// Preview file (CSV or Excel - returns first 10 rows and headers)
app.post('/api/members/import/preview', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('Uploaded file:', req.file.originalname);
        
        const { records, headers, format, delimiter } = parseFile(req.file.path, req.file.originalname);
        
        console.log('File format:', format);
        console.log('Detected headers:', headers);
        console.log('Total records:', records.length);
        if (records.length > 0) {
            console.log('First record:', records[0]);
        }
        
        // Extract subscription year columns from headers (SUBSCRIPTION_YYYY format)
        const subscriptionCols = extractSubscriptionColumns(headers, records);

        // Preview first 10 rows
        const preview = records.slice(0, 10);

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            totalRows: records.length,
            headers: headers,
            preview: preview,
            format: format,
            delimiter: delimiter,
            subscriptionColumnsDetected: subscriptionCols.map(s => `SUBSCRIPTION_${s.year}`),
            subscriptionYearsProcessed: subscriptionCols.map(s => s.year)
        });
    } catch (err) {
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error previewing file:', err);
        res.status(500).json({ error: 'Failed to parse file: ' + err.message });
    }
});

// Import members from CSV or Excel
app.post('/api/members/import', upload.single('file'), async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get column mapping from request body
        const columnMapping = JSON.parse(req.body.columnMapping || '{}');
        const importType = req.body.importType || null;
        console.log('Column mapping received:', columnMapping);
        
        // Parse file (CSV or Excel)
        const { records, headers } = parseFile(req.file.path, req.file.originalname);
        console.log('Headers from file:', headers);
        console.log('First record:', records[0]);

        await client.query('BEGIN');

        const results = {
            success: 0,
            updated: 0,
            failed: 0,
            errors: []
        };

        // Prefix map for membership number generation
        const prefixMap = {
            'AIOD': 'A',
            'FIOD': 'F',
            'MIOD': 'M',
            'Corporate': 'C',
            'Honorary': 'H'
        };
        
        // Member type normalization map
        const memberTypeNormalize = {
            // AIOD variations
            'aiod': 'AIOD',
            'associate': 'AIOD',
            'a': 'AIOD',
            // FIOD variations
            'fiod': 'FIOD',
            'fellow': 'FIOD',
            'f': 'FIOD',
            // MIOD variations
            'miod': 'MIOD',
            'member': 'MIOD',
            'm': 'MIOD',
            // Corporate variations
            'corporate': 'Corporate',
            'corp': 'Corporate',
            'c': 'Corporate',
            // Honorary variations
            'honorary': 'Honorary',
            'honorary fellow': 'Honorary',
            'honorary fellows': 'Honorary',
            'hfiod': 'Honorary',
            'hf': 'Honorary',
            'hon': 'Honorary',
            'hon fellow': 'Honorary',
            'hon fellows': 'Honorary',
            'h': 'Honorary'
        };

        // Extract subscription year columns from headers (SUBSCRIPTION_YYYY format)
        const subscriptionCols = extractSubscriptionColumns(headers, records);
        const detectedCorporateImport = detectCorporateImportFromHeaders(headers) || importType === 'Corporate';

        console.log('Detected subscription columns:', subscriptionCols);

        for (let i = 0; i < records.length; i++) {
            const row = records[i];
            
            try {
                // Use SAVEPOINT so individual row failures don't abort the whole transaction
                await client.query(`SAVEPOINT row_${i}`);
                // Map CSV columns to database fields using the provided mapping
                // If no mapping provided, try direct field names
                const getMappedValue = (dbField) => {
                    // First try using the column mapping
                    const csvColumn = columnMapping[dbField];
                    if (csvColumn && row[csvColumn] !== undefined && row[csvColumn] !== null) {
                        const val = String(row[csvColumn]).trim();
                        return val || null;
                    }
                    // Fall back to direct field name match
                    if (row[dbField] !== undefined && row[dbField] !== null) {
                        const val = String(row[dbField]).trim();
                        return val || null;
                    }
                    return null;
                };

                // Get and normalize member type
                let member_type = getMappedValue('member_type') || getMappedValue('membership_type');
                
                if (member_type) {
                    // Try normalization map first
                    const normalizedType = memberTypeNormalize[member_type.toLowerCase()];
                    if (normalizedType) {
                        member_type = normalizedType;
                    } else {
                        // Try to capitalize first letter if valid in prefixMap
                        const capitalized = member_type.charAt(0).toUpperCase() + member_type.slice(1).toLowerCase();
                        if (capitalized in prefixMap) {
                            member_type = capitalized;
                        } else if (member_type.toUpperCase() in prefixMap) {
                            member_type = member_type.toUpperCase();
                        } else {
                            // Log issue and default to AIOD
                            console.log(`Row ${i + 1}: Invalid member type '${member_type}', defaulting to AIOD`);
                            member_type = 'AIOD';
                        }
                    }
                } else {
                    if (detectedCorporateImport) {
                        member_type = 'Corporate';
                    } else {
                        // No member type found, log error for user awareness
                        console.log(`Row ${i + 1}: No member type found, defaulting to AIOD`);
                        member_type = 'AIOD';
                    }
                }
                
                // Final validation - ensure it's a valid member type
                if (!prefixMap[member_type]) {
                    console.log(`Row ${i + 1}: Member type '${member_type}' not in valid list, defaulting to AIOD`);
                    member_type = 'AIOD';
                }

                const organization = getMappedValue('organization') || getMappedValue('full_name') || 'Not Specified';

                const importedMembershipNumber =
                    getMappedValue('membership_number') ||
                    getMappedValue('member_number') ||
                    getMappedValue('mem_no');

                let membership_number = importedMembershipNumber
                    ? importedMembershipNumber.replace(/\s+/g, '')
                    : null;

                if (!membership_number) {
                    const prefix = prefixMap[member_type];
                    const maxResult = await client.query(`
                        SELECT membership_number, 
                               CAST(SUBSTRING(membership_number FROM 2) AS INTEGER) as num_part
                        FROM members 
                        WHERE membership_number ~ $1
                        ORDER BY num_part DESC LIMIT 1
                    `, ['^' + prefix + '[0-9]+$']);
                    
                    let nextNumber = 1;
                    if (maxResult.rows.length > 0) {
                        const numPart = maxResult.rows[0].num_part;
                        if (numPart !== null && !isNaN(numPart)) {
                            nextNumber = numPart + 1;
                        }
                    }
                    membership_number = prefix + String(nextNumber).padStart(5, '0');
                }

                // Parse date of admission
                let date_of_admission = parseFlexibleDate(getMappedValue('date_of_admission'));
                const normalizedGender = normalizeImportGender(getMappedValue('gender'));

                // Insert member (handle Corporate vs Personal fields)
                let memberResult;
                if (member_type === 'Corporate') {
                    // Corporate member - use Corporate-specific fields
                    memberResult = await client.query(`
                        INSERT INTO members (
                            membership_number, member_type, organization, membership_category,
                            postal_address, date_of_admission, registration_date,
                            srl_no, reg_no, contact_person, contact_phone, contact_email,
                            phone_number, email
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
                        )
                        ON CONFLICT (membership_number) DO UPDATE SET
                            member_type = EXCLUDED.member_type,
                            organization = COALESCE(NULLIF(EXCLUDED.organization, ''), members.organization),
                            membership_category = COALESCE(NULLIF(EXCLUDED.membership_category, ''), members.membership_category),
                            postal_address = COALESCE(NULLIF(EXCLUDED.postal_address, ''), members.postal_address),
                            date_of_admission = COALESCE(EXCLUDED.date_of_admission, members.date_of_admission),
                            registration_date = COALESCE(EXCLUDED.registration_date, members.registration_date),
                            srl_no = COALESCE(EXCLUDED.srl_no, members.srl_no),
                            reg_no = COALESCE(NULLIF(EXCLUDED.reg_no, ''), members.reg_no),
                            contact_person = COALESCE(NULLIF(EXCLUDED.contact_person, ''), members.contact_person),
                            contact_phone = COALESCE(NULLIF(EXCLUDED.contact_phone, ''), members.contact_phone),
                            contact_email = COALESCE(NULLIF(EXCLUDED.contact_email, ''), members.contact_email),
                            phone_number = COALESCE(NULLIF(EXCLUDED.phone_number, ''), members.phone_number),
                            email = COALESCE(NULLIF(EXCLUDED.email, ''), members.email)
                        RETURNING id, (xmax = 0) AS inserted
                    `, [
                        membership_number,
                        member_type,
                        organization,
                        getMappedValue('membership_category') || 'Standard',
                        getMappedValue('postal_address'),
                        date_of_admission,
                        date_of_admission, // registration_date same as admission date
                        parseInt(getMappedValue('srl_no')) || null,
                        getMappedValue('reg_no'),
                        getMappedValue('contact_person'),
                        getMappedValue('contact_phone'),
                        getMappedValue('contact_email'),
                        getMappedValue('phone_number'),
                        getMappedValue('email')
                    ]);
                } else {
                    // Personal member - use personal fields
                    memberResult = await client.query(`
                        INSERT INTO members (
                            membership_number, member_type, title, first_name, surname, last_name,
                            other_names, gender, organization, designation, position, sector, region,
                            postal_address, phone_number, email, date_of_admission, expertise
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
                        )
                        ON CONFLICT (membership_number) DO UPDATE SET
                            member_type = EXCLUDED.member_type,
                            title = COALESCE(NULLIF(EXCLUDED.title, ''), members.title),
                            first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), members.first_name),
                            surname = COALESCE(NULLIF(EXCLUDED.surname, ''), members.surname),
                            last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), members.last_name),
                            other_names = COALESCE(NULLIF(EXCLUDED.other_names, ''), members.other_names),
                            gender = COALESCE(EXCLUDED.gender, members.gender),
                            organization = COALESCE(NULLIF(EXCLUDED.organization, ''), members.organization),
                            designation = COALESCE(NULLIF(EXCLUDED.designation, ''), members.designation),
                            position = COALESCE(NULLIF(EXCLUDED.position, ''), members.position),
                            sector = COALESCE(NULLIF(EXCLUDED.sector, ''), members.sector),
                            region = COALESCE(NULLIF(EXCLUDED.region, ''), members.region),
                            postal_address = COALESCE(NULLIF(EXCLUDED.postal_address, ''), members.postal_address),
                            phone_number = COALESCE(NULLIF(EXCLUDED.phone_number, ''), members.phone_number),
                            email = COALESCE(NULLIF(EXCLUDED.email, ''), members.email),
                            date_of_admission = COALESCE(EXCLUDED.date_of_admission, members.date_of_admission),
                            expertise = COALESCE(NULLIF(EXCLUDED.expertise, ''), members.expertise)
                        RETURNING id, (xmax = 0) AS inserted
                    `, [
                        membership_number,
                        member_type,
                        getMappedValue('title'),
                        getMappedValue('first_name'),
                        getMappedValue('surname'),
                        getMappedValue('last_name') || getMappedValue('surname'),
                        getMappedValue('other_names'),
                        normalizedGender,
                        organization,
                        getMappedValue('designation'),
                        getMappedValue('position') || getMappedValue('designation'),
                        getMappedValue('sector'),
                        getMappedValue('region'),
                        getMappedValue('postal_address'),
                        getMappedValue('phone_number'),
                        getMappedValue('email') || getMappedValue('emails'),
                        date_of_admission,
                        getMappedValue('expertise')
                    ]);
                }

                const newMemberId = memberResult.rows[0].id;
                const insertedFlag = memberResult.rows[0].inserted;
                const wasInserted = insertedFlag === true || insertedFlag === 't';
                if (!wasInserted) {
                    results.updated++;
                }

                // **ENHANCED: Always create subscription records**
                // Process subscription years from import file if available
                let subscriptionsCreated = false;
                if (subscriptionCols.length > 0) {
                    for (const subCol of subscriptionCols) {
                        const importedSubscription = parseImportedSubscriptionValue(row[subCol.colName], member_type);
                        
                        try {
                            // Insert subscription record
                            await client.query(`
                                INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid)
                                VALUES ($1, $2, $3, $4)
                                ON CONFLICT (member_id, subscription_year) DO UPDATE SET
                                    status = CASE
                                        WHEN EXCLUDED.status = 'Pending' AND COALESCE(EXCLUDED.amount_paid, 0) = 0
                                            THEN subscriptions.status
                                        ELSE EXCLUDED.status
                                    END,
                                    amount_paid = CASE
                                        WHEN COALESCE(EXCLUDED.amount_paid, 0) > 0
                                            THEN EXCLUDED.amount_paid
                                        ELSE COALESCE(subscriptions.amount_paid, 0)
                                    END
                            `, [newMemberId, subCol.year, importedSubscription.status, importedSubscription.amountPaid]);
                            subscriptionsCreated = true;
                        } catch (subErr) {
                            console.warn(`Warning: Could not insert subscription for ${membership_number} year ${subCol.year}: ${subErr.message}`);
                        }
                    }
                }
                
                // **NEW: Ensure current year (2025) has a subscription record**
                // Even if no subscription columns were in the file, create a Pending record for the current year
                const currentYear = new Date().getFullYear();
                try {
                    // Check if 2025 subscription exists
                    const existingSub = await client.query(
                        `SELECT id FROM subscriptions WHERE member_id = $1 AND subscription_year = $2 LIMIT 1`,
                        [newMemberId, currentYear]
                    );
                    
                    if (existingSub.rows.length === 0) {
                        // Create a Pending subscription for current year if it doesn't exist
                        let defaultStatus = 'Pending';
                        if (member_type === 'Honorary') {
                            defaultStatus = 'Waived';
                        }
                        
                        await client.query(`
                            INSERT INTO subscriptions (member_id, subscription_year, status)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (member_id, subscription_year) DO NOTHING
                        `, [newMemberId, currentYear, defaultStatus]);
                    }
                } catch (err) {
                    console.warn(`Warning: Could not ensure current year subscription for ${membership_number}: ${err.message}`);
                }

                // Log first few successful imports for debugging
                if (results.success < 3) {
                    const subYearsImported = subscriptionCols.map(s => s.year);
                    console.log(`Imported row ${i + 1}:`, {
                        membership_number,
                        importAction: wasInserted ? 'inserted' : 'updated',
                        member_type,
                        first_name: getMappedValue('first_name'),
                        surname: getMappedValue('surname'),
                        organization,
                        subscriptionYearsIncluded: subYearsImported,
                        subscriptionColumnsDetected: subscriptionCols.length
                    });
                }

                results.success++;
            } catch (err) {
                // Rollback just this row, not the whole transaction
                await client.query(`ROLLBACK TO SAVEPOINT row_${i}`);
                results.failed++;
                results.errors.push({
                    row: i + 2, // +2 for 1-based index and header row
                    error: err.message
                });
                // Log first few errors
                if (results.failed <= 3) {
                    console.error(`Row ${i + 1} error:`, err.message);
                }
            }
        }

        await client.query('COMMIT');

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            imported: results.success,
            updated: results.updated,
            failed: results.failed,
            errors: results.errors.slice(0, 20), // Limit errors to first 20
            subscriptionColumnsDetected: subscriptionCols.map(s => `SUBSCRIPTION_${s.year}`),
            subscriptionYearsProcessed: subscriptionCols.map(s => s.year)
        });
    } catch (err) {
        await client.query('ROLLBACK');
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error importing CSV:', err);
        res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
    } finally {
        client.release();
    }
});

// Update member
app.put('/api/members/:id', async (req, res) => {
    // Validate and sanitize input
    const { errors, sanitized } = validateAndSanitizeMemberData(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            membership_number,
            member_type,
            title,
            first_name,
            surname,
            last_name,
            other_names,
            membership_category,
            gender,
            organization,
            designation,
            position,
            sector,
            region,
            postal_address,
            date_of_admission,
            registration_date,
            phone_number,
            email,
            feedback_on_calls,
            expertise,
            years_served_on_boards,
            srl_no,
            reg_no,
            contact_person,
            contact_phone,
            contact_email,
            subscription_years,
            payment_status,
            amount_paid,
            recorded_by,
            payment_method
        } = sanitized;

        // Convert empty strings to null for date fields
        const dateOfAdmission = date_of_admission || null;
        const registrationDate = registration_date || null;

        // Check if member type has changed - if so, generate new membership number
        const currentMemberResult = await client.query('SELECT member_type, membership_number FROM members WHERE id = $1', [req.params.id]);
        if (currentMemberResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const currentMemberType = currentMemberResult.rows[0].member_type;
        let newMembershipNumber = membership_number;
        
        // If member type changed, generate new membership number for the new category
        if (currentMemberType !== member_type) {
            const prefixMap = {
                'AIOD': 'A',
                'FIOD': 'F',
                'MIOD': 'M',
                'Corporate': 'C',
                'Honorary': 'H'
            };
            const prefix = prefixMap[member_type] || 'M';
            
            // Get the highest number for this member type
            const maxResult = await client.query(`
                SELECT membership_number, 
                       CAST(SUBSTRING(membership_number FROM 2) AS INTEGER) as num_part
                FROM members 
                WHERE membership_number ~ $1
                ORDER BY num_part DESC LIMIT 1
            `, ['^' + prefix + '[0-9]+$']);
            
            let nextNumber = 1;
            if (maxResult.rows.length > 0) {
                const numPart = maxResult.rows[0].num_part;
                if (numPart !== null && !isNaN(numPart)) {
                    nextNumber = numPart + 1;
                }
            }
            
            newMembershipNumber = prefix + String(nextNumber).padStart(5, '0');
        }

        const result = await client.query(`
            UPDATE members SET
                membership_number = $1,
                member_type = $2,
                title = $3,
                first_name = $4,
                surname = $5,
                last_name = $6,
                other_names = $7,
                membership_category = $8,
                gender = $9,
                organization = $10,
                designation = $11,
                position = $12,
                sector = $13,
                region = $14,
                postal_address = $15,
                date_of_admission = $16,
                registration_date = $17,
                phone_number = $18,
                email = $19,
                feedback_on_calls = $20,
                expertise = $21,
                years_served_on_boards = $22,
                srl_no = $23,
                reg_no = $24,
                contact_person = $25,
                contact_phone = $26,
                contact_email = $27,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $28
            RETURNING *
        `, [
            newMembershipNumber, member_type, title, first_name, surname, last_name,
            other_names, membership_category, gender, organization, designation,
            position, sector, region, postal_address, dateOfAdmission,
            registrationDate, phone_number, email, feedback_on_calls,
            expertise, years_served_on_boards, srl_no, reg_no, contact_person,
            contact_phone, contact_email, req.params.id
        ]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Member not found' });
        }

        // Handle subscription years and payment updates
        if (subscription_years && subscription_years.length > 0) {
            // Get existing subscription years
            const existingResult = await client.query(
                'SELECT subscription_year FROM subscriptions WHERE member_id = $1',
                [req.params.id]
            );
            const existingYears = existingResult.rows.map(r => r.subscription_year);
            
            // For each subscription year in the form
            for (const year of subscription_years) {
                if (!existingYears.includes(year)) {
                    // Add new year that doesn't exist
                    await client.query(`
                        INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date, receipt_number, payment_method)
                        VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)
                    `, [req.params.id, year, payment_status || 'Pending', amount_paid || 0, recorded_by || null, payment_method || null]);
                } else {
                    // Update existing year with new payment information (if payment info is provided)
                    if (payment_status || amount_paid > 0 || payment_method || recorded_by) {
                        await client.query(`
                            UPDATE subscriptions 
                            SET status = COALESCE($3, status),
                                amount_paid = CASE WHEN $4 > 0 THEN $4 ELSE amount_paid END,
                                payment_method = COALESCE($5, payment_method),
                                receipt_number = COALESCE($6, receipt_number),
                                payment_date = COALESCE(payment_date, CURRENT_DATE)
                            WHERE member_id = $1 AND subscription_year = $2
                        `, [req.params.id, year, payment_status || null, amount_paid || 0, payment_method || null, recorded_by || null]);
                    }
                }
            }
            
            // Remove years that are no longer in the list (but only if they have no payment)
            for (const existingYear of existingYears) {
                if (!subscription_years.includes(existingYear)) {
                    // Only delete if amount_paid is 0 or null (no payment made)
                    await client.query(`
                        DELETE FROM subscriptions 
                        WHERE member_id = $1 AND subscription_year = $2 
                        AND (amount_paid IS NULL OR amount_paid = 0)
                    `, [req.params.id, existingYear]);
                }
            }
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating member:', err);
        // Return detailed error message for debugging
        res.status(500).json({ error: (err && (err.message || err.toString())) || 'Database error', details: err });
    } finally {
        client.release();
    }
});

// Delete member
app.delete('/api/members/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM members WHERE id = $1 RETURNING *', [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json({ message: 'Member deleted successfully', member: result.rows[0] });
    } catch (err) {
        console.error('Error deleting member:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================================
// SUBSCRIPTIONS ENDPOINTS
// ============================================================

// Get subscriptions for a member
app.get('/api/members/:id/subscriptions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM subscriptions
            WHERE member_id = $1
            ORDER BY subscription_year DESC
        `, [req.params.id]);

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching subscriptions:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add subscription for a member
app.post('/api/members/:id/subscriptions', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { subscription_year, status, amount_paid, expected_amount, payment_method, receipt_number, payment_date } = req.body;
        const memberId = req.params.id;
        
        // Get member info
        const memberResult = await client.query('SELECT member_type, membership_category, date_of_admission, registration_date, created_at FROM members WHERE id = $1', [memberId]);
        if (memberResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Member not found' });
        }
        const memberInfo = memberResult.rows[0];
        const memberType = memberInfo.member_type;
        const membershipCategory = memberInfo.membership_category;
        
        // Always look up expected amount from subscription rates table
        const rateResult = await client.query(`
            SELECT expected_amount FROM subscription_rates 
            WHERE member_type = $1 AND subscription_year = $2
            AND (
                ($1 != 'Corporate' AND membership_category IS NULL)
                OR ($1 = 'Corporate' AND membership_category = $3)
            )
        `, [memberType, subscription_year, membershipCategory]);
        let finalExpectedAmount = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].expected_amount) : 0;
        // Fallback to provided expected_amount only if no rate found
        if (finalExpectedAmount === 0 && expected_amount && parseFloat(expected_amount) > 0) {
            finalExpectedAmount = parseFloat(expected_amount);
        }
        
        // Check for credit from previous year
        // Recalculate from rate table since stored credit_balance may be wrong for old records
        const prevYearResult = await client.query(`
            SELECT s.amount_paid, s.credit_balance, s.credit_applied,
                   COALESCE(sr.expected_amount, 0) as prev_rate_expected
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = $3 
                AND sr.subscription_year = s.subscription_year
                AND (
                    ($3 != 'Corporate' AND sr.membership_category IS NULL)
                    OR ($3 = 'Corporate' AND sr.membership_category = $4)
                )
            WHERE s.member_id = $1 AND s.subscription_year = $2
        `, [memberId, subscription_year - 1, memberType, membershipCategory]);
        
        let previousCredit = 0;
        if (prevYearResult.rows.length > 0) {
            const prev = prevYearResult.rows[0];
            const prevPaid = parseFloat(prev.amount_paid || 0);
            const prevCreditApplied = parseFloat(prev.credit_applied || 0);
            const prevExpected = parseFloat(prev.prev_rate_expected || 0);
            const storedCreditBalance = parseFloat(prev.credit_balance || 0);
            // Use recalculated credit if stored credit is 0 but there should be credit
            if (storedCreditBalance > 0) {
                previousCredit = storedCreditBalance;
            } else if (prevExpected > 0 && (prevPaid + prevCreditApplied) > prevExpected) {
                previousCredit = (prevPaid + prevCreditApplied) - prevExpected;
            }
        }
        
        const paidAmount = parseFloat(amount_paid) || 0;
        const creditOutcome = calculateCreditOutcome({
            subscriptionYear: subscription_year,
            memberType,
            explicitStatus: status || null,
            amountPaid: paidAmount,
            expectedAmount: finalExpectedAmount,
            availableCredit: previousCredit,
            isInductionYear: isInductionYearSubscription(memberInfo, subscription_year, status || null, paidAmount)
        });

        const result = await client.query(`
            INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, expected_amount, credit_applied, credit_balance, payment_method, receipt_number, payment_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            memberId,
            subscription_year,
            creditOutcome.status,
            paidAmount,
            finalExpectedAmount,
            creditOutcome.creditApplied,
            creditOutcome.creditBalance,
            payment_method || null,
            receipt_number || null,
            payment_date || null
        ]);
        
        // Reduce only the credit that was actually used.
        if (creditOutcome.creditApplied > 0) {
            await client.query(`
                UPDATE subscriptions 
                SET credit_balance = GREATEST(0, COALESCE(credit_balance, 0) - $3)
                WHERE member_id = $1 AND subscription_year = $2
            `, [memberId, subscription_year - 1, creditOutcome.creditApplied]);
        }

        await client.query('COMMIT');
        
        res.status(201).json({
            ...result.rows[0],
            summary: {
                expected_amount: finalExpectedAmount,
                amount_paid: paidAmount,
                credit_applied: creditOutcome.creditApplied,
                total_applied: creditOutcome.totalApplied,
                credit_balance_for_next_year: creditOutcome.creditBalance,
                status: creditOutcome.status
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error adding subscription:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        client.release();
    }
});

// Update subscription with credit balance logic
app.put('/api/subscriptions/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { subscription_year, status, amount_paid, payment_method, receipt_number, payment_date } = req.body;
        
        // Get the current subscription details
        const currentSub = await client.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
        if (currentSub.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Subscription not found' });
        }
        const subRecord = currentSub.rows[0];
        const memberId = subRecord.member_id;
        const subYear = subscription_year || subRecord.subscription_year;
        
        // Get member type
        const memberResult = await client.query('SELECT member_type, membership_category, date_of_admission, registration_date, created_at FROM members WHERE id = $1', [memberId]);
        if (memberResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Member not found' });
        }
        const memberInfo = memberResult.rows[0];
        const memberType = memberInfo.member_type;
        const membershipCategory = memberInfo.membership_category;
        
        // Get expected amount for this year
        const paymentDateStr = payment_date || subRecord.payment_date || new Date().toISOString().split('T')[0];
        let rateQuery = `
            SELECT expected_amount, early_bird_amount, early_bird_deadline,
                CASE 
                    WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND $3::date <= early_bird_deadline 
                    THEN early_bird_amount 
                    ELSE expected_amount 
                END as applicable_amount
            FROM subscription_rates 
            WHERE member_type = $1 AND subscription_year = $2
            AND (
                ($1 != 'Corporate' AND membership_category IS NULL)
                OR ($1 = 'Corporate' AND membership_category = $4)
            )
        `;
        let rateParams = [memberType, subYear, paymentDateStr, membershipCategory];
        
        // For Corporate members with a specific category, look up their rate
        if (memberType === 'Corporate' && membershipCategory) {
            rateQuery = `
                SELECT expected_amount, early_bird_amount, early_bird_deadline,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND $3::date <= early_bird_deadline 
                        THEN early_bird_amount 
                        ELSE expected_amount 
                    END as applicable_amount
                FROM subscription_rates 
                WHERE member_type = $1 AND subscription_year = $2
                AND membership_category = $4
            `;
            rateParams = [memberType, subYear, paymentDateStr, membershipCategory];
        }
        
        const rateResult = await client.query(rateQuery, rateParams);
        const expectedAmount = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].applicable_amount) : (subRecord.expected_amount || 0);
        
        // Get any credit balance from previous year that hasn't been applied yet
        // Recalculate from rate table since stored credit_balance may be wrong for old records
        const prevYearResult = await client.query(`
            SELECT s.amount_paid, s.credit_balance, s.credit_applied,
                   COALESCE(sr.expected_amount, 0) as prev_rate_expected
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = $3 
                AND sr.subscription_year = s.subscription_year
                AND (
                    ($3 != 'Corporate' AND sr.membership_category IS NULL)
                    OR ($3 = 'Corporate' AND sr.membership_category = $4)
                )
            WHERE s.member_id = $1 AND s.subscription_year = $2
        `, [memberId, subYear - 1, memberType, membershipCategory]);
        
        let previousCredit = 0;
        if (prevYearResult.rows.length > 0) {
            const prev = prevYearResult.rows[0];
            const prevPaid = parseFloat(prev.amount_paid || 0);
            const prevCreditApplied = parseFloat(prev.credit_applied || 0);
            const prevExpected = parseFloat(prev.prev_rate_expected || 0);
            const storedCreditBalance = parseFloat(prev.credit_balance || 0);
            // Use recalculated credit if stored credit is 0 but there should be credit
            if (storedCreditBalance > 0) {
                previousCredit = storedCreditBalance;
            } else if (prevExpected > 0 && (prevPaid + prevCreditApplied) > prevExpected) {
                previousCredit = (prevPaid + prevCreditApplied) - prevExpected;
            }
        }
        
        // Get any credit already applied to this subscription
        const existingCreditApplied = parseFloat(subRecord.credit_applied) || 0;
        
        // Calculate the new payment amount (use new value if provided, otherwise keep existing)
        const newAmountPaid = amount_paid !== undefined ? parseFloat(amount_paid) : parseFloat(subRecord.amount_paid || 0);
        
        // Recalculate credit using both currently available previous-year credit and any previously applied credit.
        const availableCreditPool = previousCredit + existingCreditApplied;
        const creditOutcome = calculateCreditOutcome({
            subscriptionYear: subYear,
            memberType,
            explicitStatus: status || subRecord.status || null,
            amountPaid: newAmountPaid,
            expectedAmount,
            availableCredit: availableCreditPool,
            isInductionYear: isInductionYearSubscription(memberInfo, subYear, status || subRecord.status || null, newAmountPaid)
        });
        
        // Update the subscription record
        const result = await client.query(`
            UPDATE subscriptions
            SET status = $1,
                amount_paid = $2,
                expected_amount = $3,
                credit_applied = $4,
                credit_balance = $5,
                payment_method = COALESCE($6, payment_method),
                receipt_number = COALESCE($7, receipt_number),
                payment_date = COALESCE($8, payment_date)
            WHERE id = $9
            RETURNING *
        `, [
            creditOutcome.status, 
            newAmountPaid, 
            expectedAmount,
            creditOutcome.creditApplied,
            creditOutcome.creditBalance,
            payment_method || null, 
            receipt_number || null, 
            payment_date || null, 
            req.params.id
        ]);
        
        // Keep previous year credit balance in sync with the amount actually consumed here.
        if (prevYearResult.rows.length > 0) {
            const remainingPreviousCredit = Math.max(0, availableCreditPool - creditOutcome.creditApplied);
            await client.query(`
                UPDATE subscriptions 
                SET credit_balance = $3 
                WHERE member_id = $1 AND subscription_year = $2
            `, [memberId, subYear - 1, remainingPreviousCredit]);
        }
        
        await client.query('COMMIT');

        res.json({
            ...result.rows[0],
            summary: {
                expected_amount: expectedAmount,
                amount_paid: newAmountPaid,
                credit_applied: creditOutcome.creditApplied,
                total_applied: creditOutcome.totalApplied,
                credit_balance_for_next_year: creditOutcome.creditBalance,
                status: creditOutcome.status
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating subscription:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        client.release();
    }
});

// Delete subscription (with credit chain recalculation)
app.delete('/api/subscriptions/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get the subscription before deleting
        const subResult = await client.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id]);
        if (subResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Subscription not found' });
        }
        const deletedSub = subResult.rows[0];
        const memberId = deletedSub.member_id;
        const deletedYear = deletedSub.subscription_year;
        
        // If this subscription had credit applied from a previous year, restore that credit
        const creditApplied = parseFloat(deletedSub.credit_applied) || 0;
        if (creditApplied > 0) {
            await client.query(`
                UPDATE subscriptions 
                SET credit_balance = credit_balance + $1 
                WHERE member_id = $2 AND subscription_year = $3
            `, [creditApplied, memberId, deletedYear - 1]);
        }
        
        // If this subscription had credit_balance that was applied to the next year, clear that
        const creditBalance = parseFloat(deletedSub.credit_balance) || 0;
        if (creditBalance > 0) {
            // Check if next year subscription used this credit
            const nextYearSub = await client.query(`
                SELECT id, credit_applied, amount_paid, expected_amount FROM subscriptions 
                WHERE member_id = $1 AND subscription_year = $2
            `, [memberId, deletedYear + 1]);
            
            if (nextYearSub.rows.length > 0) {
                const nextSub = nextYearSub.rows[0];
                const nextCreditApplied = parseFloat(nextSub.credit_applied) || 0;
                
                if (nextCreditApplied > 0) {
                    // Remove the credit that was applied from the deleted year
                    const newCreditApplied = Math.max(0, nextCreditApplied - creditBalance);
                    const newAmountPaid = parseFloat(nextSub.amount_paid) || 0;
                    const nextExpected = parseFloat(nextSub.expected_amount) || 0;
                    const newTotalApplied = newAmountPaid + newCreditApplied;
                    const newNextCreditBalance = Math.max(0, newTotalApplied - nextExpected);
                    
                    let newNextStatus = 'Pending';
                    if (newTotalApplied >= nextExpected && nextExpected > 0) {
                        newNextStatus = 'Paid';
                    } else if (newTotalApplied > 0) {
                        newNextStatus = 'Partial';
                    }
                    
                    await client.query(`
                        UPDATE subscriptions 
                        SET credit_applied = $1, credit_balance = $2, status = $3
                        WHERE id = $4
                    `, [newCreditApplied, newNextCreditBalance, newNextStatus, nextSub.id]);
                }
            }
        }
        
        // Delete the subscription
        await client.query('DELETE FROM subscriptions WHERE id = $1', [req.params.id]);
        
        await client.query('COMMIT');
        res.json({ message: 'Subscription deleted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting subscription:', err);
        res.status(500).json({ error: 'Database error' });
    } finally {
        client.release();
    }
});

// ============================================================
// SUBSCRIPTION RATES ENDPOINTS (Deferred Payments System)
// ============================================================

// Get all subscription rates
app.get('/api/subscription-rates', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM subscription_rates
            ORDER BY subscription_year DESC, member_type
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching subscription rates:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get rates for a specific year
app.get('/api/subscription-rates/:year', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM subscription_rates
            WHERE subscription_year = $1
            ORDER BY member_type, membership_category
        `, [req.params.year]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching rates for year:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Set/Update subscription rate for a member type and year
app.post('/api/subscription-rates', async (req, res) => {
    try {
        const { member_type, subscription_year, expected_amount, early_bird_amount, early_bird_deadline, description, membership_category } = req.body;
        
        if (!member_type || !subscription_year || expected_amount === undefined) {
            return res.status(400).json({ error: 'member_type, subscription_year, and expected_amount are required' });
        }

        const result = await pool.query(`
            INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, early_bird_amount, early_bird_deadline, description, membership_category)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, '')) 
            DO UPDATE SET expected_amount = $3, early_bird_amount = $4, early_bird_deadline = $5, description = $6, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [member_type, subscription_year, expected_amount, early_bird_amount || null, early_bird_deadline || null, description || null, membership_category || null]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error setting subscription rate:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Bulk update rates for a year
app.post('/api/subscription-rates/bulk', async (req, res) => {
    try {
        const { subscription_year, rates, early_bird_deadline } = req.body;
        
        if (!subscription_year || !rates || !Array.isArray(rates)) {
            return res.status(400).json({ error: 'subscription_year and rates array are required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const results = [];
            for (const rate of rates) {
                const result = await client.query(`
                    INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, early_bird_amount, early_bird_deadline, description, membership_category)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, '')) 
                    DO UPDATE SET expected_amount = $3, early_bird_amount = $4, early_bird_deadline = $5, description = $6, updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `, [rate.member_type, subscription_year, rate.expected_amount, rate.early_bird_amount || null, early_bird_deadline || rate.early_bird_deadline || null, rate.description || null, rate.membership_category || null]);
                results.push(result.rows[0]);
            }
            
            await client.query('COMMIT');
            res.json({ message: 'Rates updated successfully', rates: results });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error bulk updating rates:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get expected rate for a specific member type and year
// Returns the applicable rate (early bird if before deadline, regular otherwise)
// Supports ?category= query param for Corporate members
app.get('/api/subscription-rates/:year/:memberType', async (req, res) => {
    try {
        const { category } = req.query;
        let query, params;
        
        if (req.params.memberType === 'Corporate' && category) {
            query = `
                SELECT *,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND CURRENT_DATE <= early_bird_deadline 
                        THEN early_bird_amount 
                        ELSE expected_amount 
                    END as applicable_amount,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND CURRENT_DATE <= early_bird_deadline 
                        THEN true 
                        ELSE false 
                    END as is_early_bird_active
                FROM subscription_rates
                WHERE subscription_year = $1 AND member_type = $2 AND membership_category = $3
            `;
            params = [req.params.year, req.params.memberType, category];
        } else {
            query = `
                SELECT *,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND CURRENT_DATE <= early_bird_deadline 
                        THEN early_bird_amount 
                        ELSE expected_amount 
                    END as applicable_amount,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND CURRENT_DATE <= early_bird_deadline 
                        THEN true 
                        ELSE false 
                    END as is_early_bird_active
                FROM subscription_rates
                WHERE subscription_year = $1 AND member_type = $2 AND membership_category IS NULL
            `;
            params = [req.params.year, req.params.memberType];
        }
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.json({ expected_amount: 0, applicable_amount: 0, member_type: req.params.memberType, subscription_year: req.params.year });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching rate:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Process payment with deferred/credit balance logic
app.post('/api/members/:id/process-payment', async (req, res) => {
    try {
        const memberId = req.params.id;
        const { subscription_year, amount_paid, payment_method, receipt_number, payment_date } = req.body;
        
        if (!subscription_year || amount_paid === undefined) {
            return res.status(400).json({ error: 'subscription_year and amount_paid are required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Get member type/category for rate lookup
            const memberResult = await client.query('SELECT member_type, membership_category, date_of_admission, registration_date, created_at FROM members WHERE id = $1', [memberId]);
            if (memberResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Member not found' });
            }
            const memberInfo = memberResult.rows[0];
            const memberType = memberInfo.member_type;
            const membershipCategory = memberInfo.membership_category;
            
            // Get expected amount for this year (check early bird)
            const paymentDateStr = payment_date || new Date().toISOString().split('T')[0];
            const rateResult = await client.query(`
                SELECT expected_amount, early_bird_amount, early_bird_deadline,
                    CASE 
                        WHEN early_bird_deadline IS NOT NULL AND early_bird_amount IS NOT NULL AND $3::date <= early_bird_deadline 
                        THEN early_bird_amount 
                        ELSE expected_amount 
                    END as applicable_amount
                FROM subscription_rates 
                WHERE member_type = $1 AND subscription_year = $2
                AND (
                    ($1 != 'Corporate' AND membership_category IS NULL)
                    OR ($1 = 'Corporate' AND membership_category = $4)
                )
            `, [memberType, subscription_year, paymentDateStr, membershipCategory]);
            const expectedAmount = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].applicable_amount) : 0;
            const isEarlyBird = rateResult.rows.length > 0 && rateResult.rows[0].early_bird_amount && parseFloat(rateResult.rows[0].applicable_amount) === parseFloat(rateResult.rows[0].early_bird_amount);
            
            // Get any credit balance from previous year
            const prevYearResult = await client.query(`
                SELECT credit_balance FROM subscriptions 
                WHERE member_id = $1 AND subscription_year = $2
            `, [memberId, subscription_year - 1]);
            const previousCredit = prevYearResult.rows.length > 0 ? parseFloat(prevYearResult.rows[0].credit_balance) || 0 : 0;
            
            // Check for existing subscription to handle accumulated payments and already-applied credit correctly
            const existingSub = await client.query(
                'SELECT amount_paid, credit_applied, status FROM subscriptions WHERE member_id = $1 AND subscription_year = $2',
                [memberId, subscription_year]
            );
            const existingPaid = existingSub.rows.length > 0 ? parseFloat(existingSub.rows[0].amount_paid || 0) : 0;
            const existingCreditApplied = existingSub.rows.length > 0 ? parseFloat(existingSub.rows[0].credit_applied || 0) : 0;
            const existingStatus = existingSub.rows.length > 0 ? existingSub.rows[0].status : null;
            const totalPaid = existingPaid + parseFloat(amount_paid);
            const availableCreditPool = previousCredit + existingCreditApplied;
            
            const creditOutcome = calculateCreditOutcome({
                subscriptionYear: subscription_year,
                memberType,
                explicitStatus: existingStatus,
                amountPaid: totalPaid,
                expectedAmount,
                availableCredit: availableCreditPool,
                isInductionYear: isInductionYearSubscription(memberInfo, subscription_year, existingStatus, totalPaid)
            });
            
            // Insert or update subscription record
            const subscriptionResult = await client.query(`
                INSERT INTO subscriptions (
                    member_id, subscription_year, status, amount_paid, 
                    expected_amount, credit_applied, credit_balance,
                    payment_method, receipt_number, payment_date
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (member_id, subscription_year) 
                DO UPDATE SET 
                    status = $3,
                    amount_paid = $4,
                    expected_amount = $5,
                    credit_applied = $6,
                    credit_balance = $7,
                    payment_method = COALESCE($8, subscriptions.payment_method),
                    receipt_number = COALESCE($9, subscriptions.receipt_number),
                    payment_date = COALESCE($10, subscriptions.payment_date)
                RETURNING *
            `, [
                memberId, 
                subscription_year, 
                creditOutcome.status, 
                totalPaid, 
                expectedAmount,
                creditOutcome.creditApplied,
                creditOutcome.creditBalance,
                payment_method || null,
                receipt_number || null,
                payment_date || new Date().toISOString().split('T')[0]
            ]);
            
            // Keep previous-year credit in sync with what was actually consumed.
            if (prevYearResult.rows.length > 0) {
                const remainingPreviousCredit = Math.max(0, availableCreditPool - creditOutcome.creditApplied);
                await client.query(`
                    UPDATE subscriptions 
                    SET credit_balance = $3 
                    WHERE member_id = $1 AND subscription_year = $2
                `, [memberId, subscription_year - 1, remainingPreviousCredit]);
            }
            
            await client.query('COMMIT');
            
            res.json({
                subscription: subscriptionResult.rows[0],
                summary: {
                    expected_amount: expectedAmount,
                    amount_paid: totalPaid,
                    credit_from_previous: creditOutcome.creditApplied,
                    total_applied: creditOutcome.totalApplied,
                    credit_balance_for_next_year: creditOutcome.creditBalance,
                    status: creditOutcome.status
                }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error processing payment:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get member payment summary with credit balances
app.get('/api/members/:id/payment-summary', async (req, res) => {
    try {
        const memberId = req.params.id;
        const currentYear = new Date().getFullYear();
        
        // Get member info (include membership_category for Corporate rate lookup)
        const memberResult = await pool.query(`
            SELECT id, member_type, membership_number, membership_category,
                   date_of_admission, registration_date, created_at,
                   EXTRACT(YEAR FROM COALESCE(date_of_admission, registration_date, created_at))::int as induction_year
            FROM members
            WHERE id = $1
        `, [memberId]);
        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }
        const member = memberResult.rows[0];
        
        // Get all subscriptions with expected amounts from rate table
        const subscriptionsResult = await pool.query(`
            SELECT 
                s.*,
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as rate_expected_amount
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = $2 
                AND sr.subscription_year = s.subscription_year
                AND (
                    ($2 != 'Corporate' AND sr.membership_category IS NULL)
                    OR ($2 = 'Corporate' AND sr.membership_category = $3)
                )
            WHERE s.member_id = $1
            ORDER BY s.subscription_year ASC
        `, [memberId, member.member_type, member.membership_category]);
        
        // ── RECALCULATE credit chain from scratch using rate table expected amounts ──
        // Walk through years chronologically, carrying forward excess as credit
        let subscriptions = subscriptionsResult.rows;
        let carryForwardCredit = 0;
        
        // First pass: walk existing subscriptions and fill in gap years between them
        let expandedSubs = [];
        for (let i = 0; i < subscriptions.length; i++) {
            const sub = subscriptions[i];
            
            // Fill gap years between previous subscription and this one
            if (i > 0 && carryForwardCredit > 0) {
                const prevYear = subscriptions[i - 1].subscription_year;
                for (let gapYear = prevYear + 1; gapYear < sub.subscription_year; gapYear++) {
                    // Get rate for gap year
                    const gapRateResult = await pool.query(`
                        SELECT expected_amount FROM subscription_rates 
                        WHERE member_type = $1 AND subscription_year = $2
                        AND (($1 != 'Corporate' AND membership_category IS NULL) OR ($1 = 'Corporate' AND membership_category = $3))
                    `, [member.member_type, gapYear, member.membership_category]);
                    const gapRate = gapRateResult.rows.length > 0 ? parseFloat(gapRateResult.rows[0].expected_amount) : 0;
                    
                    const gapOutcome = calculateCreditOutcome({
                        subscriptionYear: gapYear,
                        memberType: member.member_type,
                        explicitStatus: 'Pending',
                        amountPaid: 0,
                        expectedAmount: gapRate,
                        availableCredit: carryForwardCredit
                    });
                    
                    expandedSubs.push({
                        subscription_year: gapYear,
                        amount_paid: 0,
                        credit_applied: gapOutcome.creditApplied,
                        credit_balance: gapOutcome.creditBalance,
                        status: 'Pending',
                        rate_expected_amount: gapRate,
                        computed_status: gapOutcome.status,
                        is_virtual: true,
                        is_induction_year: false,
                        balance_due: Math.max(0, gapRate - gapOutcome.totalApplied)
                    });
                    carryForwardCredit = gapOutcome.creditBalance;
                }
            }
            
            const rateExpected = parseFloat(sub.rate_expected_amount || 0);
            const outcome = calculateCreditOutcome({
                subscriptionYear: sub.subscription_year,
                memberType: member.member_type,
                explicitStatus: sub.status,
                amountPaid: sub.amount_paid,
                expectedAmount: rateExpected,
                availableCredit: carryForwardCredit,
                isInductionYear: isInductionYearSubscription(member, sub.subscription_year, sub.status, sub.amount_paid)
            });

            sub.credit_applied = outcome.creditApplied;
            sub.credit_balance = outcome.creditBalance;
            sub.computed_status = outcome.status;
            sub.legacy_paid_override = outcome.isLegacyPaid && sub.status !== 'Paid';
            sub.is_induction_year = outcome.isInductionYear;
            sub.induction_note = outcome.isInductionYear ? 'Inducted this year' : null;
            sub.balance_due = outcome.isInductionYear ? null : Math.max(0, rateExpected - outcome.totalApplied);
            carryForwardCredit = outcome.creditBalance;
            
            expandedSubs.push(sub);
        }
        
        subscriptions = expandedSubs;
        
        // Fill gap years from last subscription to current year (including current year)
        // But only from 2025 onwards (payment history starts at 2025)
        const lastSubYear = subscriptions.length > 0 ? subscriptions[subscriptions.length - 1].subscription_year : currentYear - 1;
        const startFromYear = Math.max(lastSubYear + 1, 2025); // Start from 2025 at earliest
        
        if (member.member_type !== 'Honorary') {
            for (let fillYear = startFromYear; fillYear <= currentYear; fillYear++) {
                // Get the expected rate for this year
                const rateResult = await pool.query(`
                    SELECT expected_amount 
                    FROM subscription_rates 
                    WHERE member_type = $1 AND subscription_year = $2
                    AND (($1 != 'Corporate' AND membership_category IS NULL) OR ($1 = 'Corporate' AND membership_category = $3))
                `, [member.member_type, fillYear, member.membership_category]);
                
                const expectedAmount = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].expected_amount) : 0;
                const gapOutcome = calculateCreditOutcome({
                    subscriptionYear: fillYear,
                    memberType: member.member_type,
                    explicitStatus: 'Pending',
                    amountPaid: 0,
                    expectedAmount,
                    availableCredit: carryForwardCredit
                });
                
                subscriptions.push({
                    subscription_year: fillYear,
                    amount_paid: 0,
                    credit_applied: gapOutcome.creditApplied,
                    credit_balance: gapOutcome.creditBalance,
                    status: 'Pending',
                    rate_expected_amount: expectedAmount,
                    computed_status: gapOutcome.status,
                    is_virtual: true,
                    is_induction_year: false,
                    balance_due: Math.max(0, expectedAmount - gapOutcome.totalApplied)
                });

                carryForwardCredit = gapOutcome.creditBalance;
            }
        }
        
        // Sort descending for display (most recent year first)
        subscriptions.sort((a, b) => b.subscription_year - a.subscription_year);
        
        // The current credit balance is whatever is left after the most recent year
        const lastCreditBalance = carryForwardCredit;
        const lastCreditYear = subscriptions.length > 0 ? subscriptions[0].subscription_year : null;
        
        res.json({
            member: member,
            subscriptions: subscriptions,
            current_credit_balance: lastCreditBalance,
            credit_year: lastCreditBalance > 0 ? lastCreditYear : null
        });
    } catch (err) {
        console.error('Error fetching payment summary:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================================
// DASHBOARD ANALYTICS ENDPOINTS
// ============================================================

// Dashboard Metric 1: Current Year Overview (KPIs)
app.get('/api/dashboard/current-year-overview', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        const inductionPaidCondition = `
            COALESCE((
                s.status = 'Paid'
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::int
            ), false)
        `;
        const fullyPaidCondition = `
            (${inductionPaidCondition})
            OR (
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) > 0
                AND (COALESCE(s.amount_paid, 0) + COALESCE(s.credit_applied, 0))
                    >= COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0)
            )
        `;
        let query = `
            SELECT 
                EXTRACT(YEAR FROM CURRENT_DATE)::INT as year,
                COUNT(DISTINCT m.id) as total_members,
                COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) as members_paid,
                COUNT(DISTINCT CASE WHEN NOT (${fullyPaidCondition}) THEN m.id END) as members_unpaid,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) 
                    / NULLIF(COUNT(DISTINCT m.id), 0), 2) as payment_rate_percent,
                COALESCE(SUM(s.amount_paid), 0) as total_revenue,
                ROUND(AVG(CASE WHEN s.amount_paid > 0 THEN s.amount_paid ELSE NULL END), 2) as avg_payment
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id 
                AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
            LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type
                AND sr.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
                AND (
                    (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                    OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
                )
            WHERE m.member_type != 'Honorary'`;
        
        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }
        
        const result = await pool.query(query, params);
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('Error fetching current year overview:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 2: Paid vs Unpaid by Member Type (excludes Honorary - they have waived fees)
app.get('/api/dashboard/paid-by-type', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        const inductionPaidCondition = `
            COALESCE((
                s.status = 'Paid'
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::int
            ), false)
        `;
        const fullyPaidCondition = `
            (${inductionPaidCondition})
            OR (
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) > 0
                AND (COALESCE(s.amount_paid, 0) + COALESCE(s.credit_applied, 0))
                    >= COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0)
            )
        `;
        let query = `
            SELECT 
                m.member_type,
                COUNT(DISTINCT m.id) as total_members,
                COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) as paid_members,
                COUNT(DISTINCT CASE WHEN NOT (${fullyPaidCondition}) THEN m.id END) as unpaid_members,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) 
                    / NULLIF(COUNT(DISTINCT m.id), 0), 2) as paid_percent
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id 
                AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
            LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type
                AND sr.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
                AND (
                    (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                    OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
                )
            WHERE m.member_type != 'Honorary'`;
        
        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }
        
        query += ` GROUP BY m.member_type
            ORDER BY paid_percent DESC NULLS LAST`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching paid by type:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 3: Yearly Trend (Revenue Over Time) - Last 10 Years
app.get('/api/dashboard/yearly-trends', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        
        // Get the total actual members count (for context)
        let totalMembersQuery = 'SELECT COUNT(*) as total FROM members';
        if (memberType) {
            totalMembersQuery += ' WHERE member_type = $1';
        }
        
        // Main query for yearly trends - show years 2025-2035
        let query = `
            WITH yearly_data AS (
                SELECT 
                    s.subscription_year,
                    COUNT(DISTINCT CASE 
                        WHEN COALESCE((
                            s.status = 'Paid'
                            AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::int
                        ), false) OR (
                            COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) > 0
                            AND (COALESCE(s.amount_paid, 0) + COALESCE(s.credit_applied, 0))
                                >= COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0)
                        )
                        THEN m.id
                    END) as paid_members,
                    SUM(CASE WHEN COALESCE(s.amount_paid, 0) > 0 THEN COALESCE(s.amount_paid, 0) ELSE 0 END) as total_revenue
                FROM subscriptions s
                INNER JOIN members m ON m.id = s.member_id
                LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type
                    AND sr.subscription_year = s.subscription_year
                    AND (
                        (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                        OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
                    )
                WHERE s.subscription_year BETWEEN 2025 AND 2035`;
        
        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }
        
        query += `
                GROUP BY s.subscription_year
            ),
            total_members AS (
                SELECT COUNT(*) as total_count FROM members`;
        
        if (memberType) {
            query += ` WHERE member_type = $1`;
        }
        
        query += `
            )
            SELECT 
                yd.subscription_year,
                tm.total_count as members_count,
                yd.paid_members,
                ROUND(100.0 * yd.paid_members / NULLIF(tm.total_count, 0), 2) as payment_rate,
                yd.total_revenue
            FROM yearly_data yd
            CROSS JOIN total_members tm
            ORDER BY yd.subscription_year DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching yearly trends:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 4: Unpaid Subscriptions (Action List)
app.get('/api/dashboard/unpaid-subscriptions', async (req, res) => {
    try {
        const year = req.query.year || new Date().getFullYear();
        // Get all members who haven't fully paid for the year:
        // - Members with no subscription record for the year
        // - Members with Pending or Partial status
        const result = await pool.query(`
            SELECT 
                m.id as member_id,
                m.membership_number,
                m.member_type,
                CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) as member_name,
                m.phone_number,
                $1::int as subscription_year,
                COALESCE(s.status, 'Not Paid') as status,
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as expected_amount,
                COALESCE(s.amount_paid, 0) as amount_paid,
                COALESCE(s.credit_applied, 0) as credit_applied,
                GREATEST(0, COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) - COALESCE(s.amount_paid, 0) - COALESCE(s.credit_applied, 0)) as amount_owed
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id AND s.subscription_year = $1
            LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type 
                AND sr.subscription_year = $1
                AND (
                    (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                    OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
                )
            WHERE m.member_type != 'Honorary'
            AND (
                s.id IS NULL 
                OR (
                    NOT (
                        s.status = 'Paid'
                        AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::int
                    )
                    AND
                    COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) > 0
                    AND (COALESCE(s.amount_paid, 0) + COALESCE(s.credit_applied, 0)) < COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0)
                )
            )
            ORDER BY 
                m.member_type,
                m.membership_number
        `, [year]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching unpaid subscriptions:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 5: Gender Breakdown by Member Type (with optional year filter)
app.get('/api/dashboard/gender-by-type', async (req, res) => {
    try {
        const { year } = req.query;
        let query;
        let params = [];
        
        if (year && year !== 'all') {
            // Filter by admission year extracted from date_of_admission
            query = `
                SELECT 
                    m.member_type,
                    CASE 
                        WHEN UPPER(TRIM(m.gender)) = 'MALE' THEN 'Male'
                        WHEN UPPER(TRIM(m.gender)) = 'FEMALE' THEN 'Female'
                        ELSE 'Not Specified'
                    END as gender,
                    COUNT(*) as count
                FROM members m
                WHERE EXTRACT(YEAR FROM m.date_of_admission) = $1
                GROUP BY m.member_type,
                    CASE 
                        WHEN UPPER(TRIM(m.gender)) = 'MALE' THEN 'Male'
                        WHEN UPPER(TRIM(m.gender)) = 'FEMALE' THEN 'Female'
                        ELSE 'Not Specified'
                    END
                ORDER BY 
                    CASE m.member_type 
                        WHEN 'AIOD' THEN 1 
                        WHEN 'MIOD' THEN 2 
                        WHEN 'FIOD' THEN 3 
                        WHEN 'Honorary' THEN 4 
                        WHEN 'Corporate' THEN 5 
                        ELSE 6 
                    END,
                    gender
            `;
            params = [parseInt(year)];
        } else {
            // Return all members
            query = `
                SELECT 
                    m.member_type,
                    CASE 
                        WHEN UPPER(TRIM(m.gender)) = 'MALE' THEN 'Male'
                        WHEN UPPER(TRIM(m.gender)) = 'FEMALE' THEN 'Female'
                        ELSE 'Not Specified'
                    END as gender,
                    COUNT(*) as count
                FROM members m
                GROUP BY m.member_type,
                    CASE 
                        WHEN UPPER(TRIM(m.gender)) = 'MALE' THEN 'Male'
                        WHEN UPPER(TRIM(m.gender)) = 'FEMALE' THEN 'Female'
                        ELSE 'Not Specified'
                    END
                ORDER BY 
                    CASE m.member_type 
                        WHEN 'AIOD' THEN 1 
                        WHEN 'MIOD' THEN 2 
                        WHEN 'FIOD' THEN 3 
                        WHEN 'Honorary' THEN 4 
                        WHEN 'Corporate' THEN 5 
                        ELSE 6 
                    END,
                    gender
            `;
        }
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching gender by type:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard: Get available admission years
app.get('/api/dashboard/admission-years', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT EXTRACT(YEAR FROM date_of_admission)::integer as year
            FROM members
            WHERE date_of_admission IS NOT NULL
            ORDER BY year DESC
        `);
        res.json(result.rows.filter(r => r.year).map(r => r.year));
    } catch (err) {
        console.error('Error fetching admission years:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 6: Regional Performance
app.get('/api/dashboard/regional-performance', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        const inductionPaidCondition = `
            COALESCE((
                s.status = 'Paid'
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::int
            ), false)
        `;
        const fullyPaidCondition = `
            (${inductionPaidCondition})
            OR (
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) > 0
                AND (COALESCE(s.amount_paid, 0) + COALESCE(s.credit_applied, 0))
                    >= COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0)
            )
        `;
        let query = `
            SELECT 
                CASE 
                    WHEN UPPER(TRIM(m.region)) IN ('ACCRA', 'GREATER ACCRA') THEN 'Greater Accra'
                    WHEN m.region IS NULL OR TRIM(m.region) = '' THEN 'Unknown'
                    ELSE INITCAP(TRIM(m.region))
                END as region,
                COUNT(DISTINCT m.id) as total_members,
                COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) as paid_members,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN ${fullyPaidCondition} THEN m.id END) 
                    / NULLIF(COUNT(DISTINCT m.id), 0), 2) as payment_rate,
                SUM(CASE WHEN ${fullyPaidCondition} THEN COALESCE(s.amount_paid, 0) ELSE 0 END) as region_revenue
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id 
                AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
            LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type
                AND sr.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
                AND (
                    (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                    OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
                )
            WHERE 1=1`;

        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }

        query += `
            GROUP BY CASE 
                    WHEN UPPER(TRIM(m.region)) IN ('ACCRA', 'GREATER ACCRA') THEN 'Greater Accra'
                    WHEN m.region IS NULL OR TRIM(m.region) = '' THEN 'Unknown'
                    ELSE INITCAP(TRIM(m.region))
                END
            ORDER BY region_revenue DESC NULLS LAST
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching regional performance:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 6: Payment Method Breakdown
app.get('/api/dashboard/payment-methods', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        let query = `
            SELECT 
                COALESCE(s.payment_method, 'Not Specified') as payment_method,
                COUNT(*) as transactions,
                SUM(s.amount_paid) as total_paid,
                ROUND(AVG(s.amount_paid), 2) as avg_payment
            FROM subscriptions s
            INNER JOIN members m ON m.id = s.member_id
            WHERE s.payment_date >= CURRENT_DATE - INTERVAL '1 year'
              AND s.status = 'Paid'`;

        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }

        query += `
            GROUP BY s.payment_method
            ORDER BY total_paid DESC NULLS LAST
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching payment methods:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Metric 7: Member Growth Over Time
app.get('/api/dashboard/member-growth', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        let query = `
            SELECT 
                DATE_TRUNC('month', m.created_at)::DATE as month,
                COUNT(*) as new_members,
                SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', m.created_at)) as cumulative
            FROM members m
            WHERE m.created_at IS NOT NULL`;

        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }

        query += `
            GROUP BY DATE_TRUNC('month', m.created_at)
            ORDER BY month DESC
            LIMIT 12
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member growth:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Advanced: Churn Analysis
app.get('/api/dashboard/churn-analysis', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const currentYear = new Date().getFullYear();
        const params = [currentYear];
        let query = `
            SELECT 
                m.id as member_id,
                m.membership_number,
                m.member_type,
                CONCAT(m.first_name, ' ', COALESCE(m.surname, m.last_name)) as member_name,
                MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) as last_paid_year,
                CASE 
                    WHEN MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) IS NULL THEN NULL
                    ELSE $1::INT - MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END)
                END as years_since_paid
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id`;

        if (memberType) {
            params.push(memberType);
            query += ` WHERE m.member_type = $${params.length}`;
        }

        query += `
            GROUP BY m.id, m.membership_number, m.member_type, m.first_name, m.surname, m.last_name
            HAVING MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) IS NULL
               OR MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) < $1::INT
            ORDER BY 
                CASE 
                    WHEN MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END) IS NULL THEN 999
                    ELSE $1::INT - MAX(CASE WHEN s.status = 'Paid' THEN s.subscription_year END)
                END DESC,
                m.membership_number ASC
            LIMIT 100
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching churn analysis:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Advanced: Cohort Analysis
app.get('/api/dashboard/cohort-analysis', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        let query = `
            SELECT 
                EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::INT as cohort_year,
                EXTRACT(YEAR FROM CURRENT_DATE)::INT - EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))::INT as years_as_member,
                COUNT(*) as cohort_size,
                COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_in_latest,
                ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) 
                    / NULLIF(COUNT(*), 0), 2) as payment_rate
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id 
                AND s.subscription_year = EXTRACT(YEAR FROM CURRENT_DATE)
            WHERE COALESCE(m.date_of_admission, m.registration_date, m.created_at) IS NOT NULL`;

        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }

        query += `
            GROUP BY EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date, m.created_at))
            ORDER BY cohort_year DESC
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching cohort analysis:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Advanced: Revenue Forecast
app.get('/api/dashboard/revenue-forecast', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const params = [];
        let query = `
            WITH recent_trends AS (
                SELECT 
                    s.subscription_year,
                    SUM(CASE WHEN s.status = 'Paid' THEN COALESCE(s.amount_paid, 0) ELSE 0 END) as yearly_revenue,
                    COUNT(DISTINCT CASE WHEN s.status = 'Paid' THEN m.id END) as paid_members
                FROM members m
                JOIN subscriptions s ON m.id = s.member_id
                WHERE s.subscription_year >= EXTRACT(YEAR FROM CURRENT_DATE) - 3`;

        if (memberType) {
            params.push(memberType);
            query += ` AND m.member_type = $${params.length}`;
        }

        query += `
                GROUP BY s.subscription_year
            )
            SELECT 
                subscription_year,
                yearly_revenue,
                paid_members,
                ROUND(yearly_revenue / NULLIF(paid_members, 0), 2) as avg_per_member,
                (SELECT yearly_revenue FROM recent_trends ORDER BY subscription_year DESC LIMIT 1) 
                    as latest_revenue,
                ROUND(
                    (SELECT yearly_revenue FROM recent_trends ORDER BY subscription_year DESC LIMIT 1) * 1.05,
                    2
                ) as forecasted_revenue_5pct_growth
            FROM recent_trends
            ORDER BY subscription_year
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching revenue forecast:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================================
// STATISTICS ENDPOINTS (Original)
// ============================================================

// Get member statistics
app.get('/api/statistics/members', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM get_member_statistics()');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching statistics:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all distinct subscription years
app.get('/api/subscription-years', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT subscription_year 
            FROM subscriptions 
            WHERE subscription_year IS NOT NULL 
            ORDER BY subscription_year DESC
        `);
        const years = result.rows.map(r => r.subscription_year);
        res.json(years);
    } catch (err) {
        console.error('Error fetching subscription years:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get members in good standing for a specific year (fully paid or credit covers)
// Includes: members with subscription records + members whose carry-forward credit covers the year
// Excludes: Honorary Fellows are always included (Waived)
app.get('/api/good-standing/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        
        // Step 1: Get ALL members (non-Honorary) who have any subscription history
        //         plus all Honorary members
        const allMembersResult = await pool.query(`
            SELECT DISTINCT m.id, m.membership_number, m.member_type, m.membership_category,
                   m.title, m.first_name, m.surname, m.last_name, m.other_names,
                   m.organization, m.designation, m.position, m.region, m.email, m.phone_number,
                   TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission
            FROM members m
            WHERE m.member_type IN ('FIOD', 'MIOD', 'AIOD', 'Corporate', 'Honorary')
        `);
        
        const goodStandingMembers = [];
        
        for (const member of allMembersResult.rows) {
            // Honorary members are always in good standing
            if (member.member_type === 'Honorary') {
                goodStandingMembers.push({
                    ...member,
                    subscription_year: year,
                    status: 'Waived',
                    amount_paid: 0,
                    credit_applied: 0,
                    expected_amount: 0,
                    recorded_by: null,
                    payment_date: null
                });
                continue;
            }
            
            // Get all subscriptions for this member up to the requested year
            const subsResult = await pool.query(`
                SELECT s.*, COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as rate_expected_amount,
                       s.receipt_number as recorded_by,
                       TO_CHAR(s.payment_date, 'DD/MM/YYYY') as payment_date_fmt
                FROM subscriptions s
                LEFT JOIN subscription_rates sr ON sr.member_type = $2 
                    AND sr.subscription_year = s.subscription_year
                    AND (
                        ($2 != 'Corporate' AND sr.membership_category IS NULL)
                        OR ($2 = 'Corporate' AND sr.membership_category = $3)
                    )
                WHERE s.member_id = $1 AND s.subscription_year <= $4
                ORDER BY s.subscription_year ASC
            `, [member.id, member.member_type, member.membership_category, year]);
            
            if (subsResult.rows.length === 0) continue; // No subscription history at all
            
            // Recalculate credit chain through all years (including gap-year carry forward)
            let carryForwardCredit = 0;
            let targetYearData = null;

            // Pre-fetch rates for gap year chaining
            const memberRateResult = await pool.query(`
                SELECT subscription_year, expected_amount FROM subscription_rates 
                WHERE member_type = $1
                AND (
                    ($1 != 'Corporate' AND membership_category IS NULL)
                    OR ($1 = 'Corporate' AND membership_category = $2)
                )
            `, [member.member_type, member.membership_category]);
            const memberRatesMap = {};
            for (const r of memberRateResult.rows) {
                memberRatesMap[r.subscription_year] = parseFloat(r.expected_amount || 0);
            }
            
            for (let i = 0; i < subsResult.rows.length; i++) {
                const sub = subsResult.rows[i];

                // Chain credit through gap years between subscriptions
                if (i > 0 && carryForwardCredit > 0) {
                    const prevSubYear = subsResult.rows[i - 1].subscription_year;
                    for (let gapYear = prevSubYear + 1; gapYear < sub.subscription_year; gapYear++) {
                        if (carryForwardCredit <= 0) break;
                        const gapRate = memberRatesMap[gapYear] || 0;
                        const gapOutcome = calculateCreditOutcome({
                            subscriptionYear: gapYear,
                            memberType: member.member_type,
                            explicitStatus: 'Pending',
                            amountPaid: 0,
                            expectedAmount: gapRate,
                            availableCredit: carryForwardCredit
                        });

                        if (gapYear === year) {
                            targetYearData = {
                                amountPaid: 0,
                                creditApplied: gapOutcome.creditApplied,
                                totalAvailable: gapOutcome.totalApplied,
                                rateExpected: gapRate,
                                creditBalance: gapOutcome.creditBalance,
                                recorded_by: null,
                                payment_date: null,
                                isWaived: gapOutcome.isWaived,
                                isLegacyPaid: gapOutcome.isLegacyPaid,
                                status: gapOutcome.status
                            };
                        }
                        carryForwardCredit = gapOutcome.creditBalance;
                    }
                }

                const rateExpected = parseFloat(sub.rate_expected_amount || 0);
                const outcome = calculateCreditOutcome({
                    subscriptionYear: sub.subscription_year,
                    memberType: member.member_type,
                    explicitStatus: sub.status,
                    amountPaid: sub.amount_paid,
                    expectedAmount: rateExpected,
                    availableCredit: carryForwardCredit,
                    isInductionYear: isInductionYearSubscription(member, sub.subscription_year, sub.status, sub.amount_paid)
                });
                
                if (sub.subscription_year === year) {
                    targetYearData = {
                        amountPaid: outcome.amountPaid,
                        creditApplied: outcome.creditApplied,
                        totalAvailable: outcome.totalApplied,
                        rateExpected,
                        creditBalance: outcome.creditBalance,
                        recorded_by: sub.recorded_by,
                        payment_date: sub.payment_date_fmt,
                        isWaived: outcome.isWaived,
                        isLegacyPaid: outcome.isLegacyPaid,
                        isInductionYear: outcome.isInductionYear,
                        status: outcome.status
                    };
                }
                
                carryForwardCredit = outcome.creditBalance;
            }
            
            // If no subscription for the target year, check if carry-forward covers it
            if (!targetYearData) {
                // Chain credit through gap years from last subscription year to target year
                const lastSubYear = subsResult.rows.length > 0
                    ? subsResult.rows[subsResult.rows.length - 1].subscription_year : 0;

                for (let gapYear = lastSubYear + 1; gapYear <= year; gapYear++) {
                    if (carryForwardCredit <= 0) break;
                    const gapRate = memberRatesMap[gapYear] || 0;
                    const gapOutcome = calculateCreditOutcome({
                        subscriptionYear: gapYear,
                        memberType: member.member_type,
                        explicitStatus: 'Pending',
                        amountPaid: 0,
                        expectedAmount: gapRate,
                        availableCredit: carryForwardCredit
                    });

                    if (gapYear === year) {
                        targetYearData = {
                            amountPaid: 0,
                            creditApplied: gapOutcome.creditApplied,
                            totalAvailable: gapOutcome.totalApplied,
                            rateExpected: gapRate,
                            creditBalance: gapOutcome.creditBalance,
                            recorded_by: null,
                            payment_date: null,
                            isWaived: gapOutcome.isWaived,
                            isLegacyPaid: gapOutcome.isLegacyPaid,
                            status: gapOutcome.status
                        };
                    }
                    carryForwardCredit = gapOutcome.creditBalance;
                }
            }
            
            // Check if member qualifies for good standing
            const isGoodStanding = targetYearData && (
                targetYearData.status === 'Paid' ||
                targetYearData.status === 'Waived'
            );
            
            if (isGoodStanding) {
                goodStandingMembers.push({
                    ...member,
                    subscription_year: year,
                    status: targetYearData.status,
                    amount_paid: targetYearData.amountPaid,
                    credit_applied: targetYearData.creditApplied,
                    expected_amount: targetYearData.rateExpected,
                    is_induction_year: targetYearData.isInductionYear === true,
                    induction_note: targetYearData.isInductionYear ? 'Inducted this year' : null,
                    recorded_by: targetYearData.recorded_by,
                    payment_date: targetYearData.payment_date
                });
            }
        }
        
        // Sort by member_type, then membership_number
        goodStandingMembers.sort((a, b) => {
            if (a.member_type !== b.member_type) return a.member_type.localeCompare(b.member_type);
            return (a.membership_number || '').localeCompare(b.membership_number || '');
        });
        
        res.json(goodStandingMembers);
    } catch (err) {
        console.error('Error fetching good standing members:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================================
// MIGRATION: Update subscription amounts (run once)
// ============================================================
app.post('/api/migrate/update-subscription-amounts', async (req, res) => {
    try {
        // Update AIOD subscriptions (GHS 350 annual fee)
        await pool.query(`
            UPDATE subscriptions s
            SET amount_paid = 350.00
            FROM members m
            WHERE s.member_id = m.id
            AND m.member_type = 'AIOD'
            AND s.status = 'Paid'
            AND (s.amount_paid IS NULL OR s.amount_paid = 0)
        `);

        // Update FIOD subscriptions (GHS 500 annual fee)
        await pool.query(`
            UPDATE subscriptions s
            SET amount_paid = 500.00
            FROM members m
            WHERE s.member_id = m.id
            AND m.member_type = 'FIOD'
            AND s.status = 'Paid'
            AND (s.amount_paid IS NULL OR s.amount_paid = 0)
        `);

        // Update MIOD subscriptions (GHS 400 annual fee)
        await pool.query(`
            UPDATE subscriptions s
            SET amount_paid = 400.00
            FROM members m
            WHERE s.member_id = m.id
            AND m.member_type = 'MIOD'
            AND s.status = 'Paid'
            AND (s.amount_paid IS NULL OR s.amount_paid = 0)
        `);

        // Update Corporate subscriptions
        await pool.query(`
            UPDATE subscriptions s
            SET amount_paid = CASE 
                WHEN m.membership_category = 'Gold' THEN 1500.00
                WHEN m.membership_category = 'Silver' THEN 1000.00
                ELSE 1000.00
            END
            FROM members m
            WHERE s.member_id = m.id
            AND m.member_type = 'Corporate'
            AND s.status = 'Paid'
            AND (s.amount_paid IS NULL OR s.amount_paid = 0)
        `);

        // Honorary members have waived fees (set to 0)
        await pool.query(`
            UPDATE subscriptions s
            SET amount_paid = 0
            FROM members m
            WHERE s.member_id = m.id
            AND m.member_type = 'Honorary'
            AND s.status = 'Waived'
            AND s.amount_paid IS NULL
        `);

        res.json({ message: 'Migration completed successfully' });
    } catch (err) {
        console.error('Migration error:', err);
        res.status(500).json({ error: 'Migration failed' });
    }
});

// ============================================================
// SERVER SETUP
// ============================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
