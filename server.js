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
const sessionSameSite = process.env.SESSION_SAME_SITE || (isProduction ? 'none' : 'lax');

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
        sameSite: sessionSameSite,
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
    }
}));

const ADMIN_ROLE_SUPERADMIN = 'superadmin';
const ADMIN_ROLE_ADMIN = 'admin';
const ACTIVITY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeAdminRole(role) {
    return String(role || '').toLowerCase() === ADMIN_ROLE_SUPERADMIN ? ADMIN_ROLE_SUPERADMIN : ADMIN_ROLE_ADMIN;
}

function isSuperAdminSession(req) {
    return req.session && req.session.authenticated && normalizeAdminRole(req.session.role) === ADMIN_ROLE_SUPERADMIN;
}

function getSessionAdminRecorder(req) {
    return {
        adminUserId: req.session?.adminId || null,
        adminUsername: req.session?.user || null
    };
}

async function hydrateAdminSession(req) {
    if (!req.session || !req.session.authenticated || !req.session.adminId) {
        return false;
    }

    try {
        const result = await pool.query(
            'SELECT id, username, email, role, is_active FROM admin_users WHERE id = $1',
            [req.session.adminId]
        );

        if (result.rows.length === 0 || result.rows[0].is_active === false) {
            return false;
        }

        const admin = result.rows[0];
        req.session.user = admin.username;
        req.session.email = admin.email || '';
        req.session.role = normalizeAdminRole(admin.role);
        return true;
    } catch (err) {
        console.error('Error refreshing admin session:', err.message || err);
        return true;
    }
}

async function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.authenticated && req.session.adminId && !req.session.role) {
        await hydrateAdminSession(req);
    }

    if (!isSuperAdminSession(req)) {
        return res.status(403).json({ error: 'SuperAdmin access required' });
    }
    next();
}

function getRequestIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : (forwardedFor || req.ip || req.socket?.remoteAddress || '');
    return String(rawIp).split(',')[0].trim().slice(0, 100);
}

function inferActivityEntityType(apiPath) {
    const segments = String(apiPath || '').split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== 'api') return 'api';
    const resource = segments[1];
    if (resource === 'members') return 'member';
    if (resource === 'subscriptions') return 'subscription';
    if (resource === 'subscription-rates') return 'subscription_rate';
    if (resource === 'payments') return 'payment';
    if (resource === 'admin') return 'admin';
    return resource.replace(/-/g, '_');
}

async function recordAdminActivity(req, details) {
    if (!details || !details.action) return;

    const metadata = details.metadata && typeof details.metadata === 'object' ? details.metadata : {};
    try {
        await pool.query(`
            INSERT INTO admin_activity_logs (
                admin_user_id, admin_username, action, entity_type, entity_id,
                description, method, path, status_code, ip_address, user_agent, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            details.adminId || req.session?.adminId || null,
            details.adminUsername || req.session?.user || null,
            details.action,
            details.entityType || null,
            details.entityId ? String(details.entityId) : null,
            details.description || null,
            details.method || req.method || null,
            details.path || req.originalUrl || req.path || null,
            details.statusCode || null,
            getRequestIp(req),
            req.headers['user-agent'] || null,
            JSON.stringify(metadata)
        ]);
    } catch (err) {
        console.error('Error recording admin activity:', err.message || err);
    }
}

function adminActivityLogger(req, res, next) {
    const shouldLog = req.session
        && req.session.authenticated
        && req.path.startsWith('/api/')
        && ACTIVITY_METHODS.has(req.method)
        && req.path !== '/api/admin/activity-logs';

    if (!shouldLog) return next();

    const startedAt = Date.now();
    res.on('finish', () => {
        if (!req.session?.adminId) return;

        const routePath = req.route?.path || req.path;
        const action = res.locals.activityAction || `${req.method.toLowerCase()}_${String(routePath).replace(/^\/api\/?/, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
        const metadata = {
            method: req.method,
            path: req.originalUrl || req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt,
            ...(res.locals.activityMetadata || {})
        };

        recordAdminActivity(req, {
            action,
            entityType: res.locals.activityEntityType || inferActivityEntityType(req.path),
            entityId: res.locals.activityEntityId || req.params?.id || null,
            description: res.locals.activityDescription || `${req.session.user} performed ${req.method} ${req.originalUrl || req.path}`,
            statusCode: res.statusCode,
            metadata
        });
    });

    next();
}

// Login endpoint (no auth required)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    try {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username.trim()]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const admin = result.rows[0];
        if (admin.is_active === false) {
            await recordAdminActivity(req, {
                adminId: admin.id,
                adminUsername: admin.username,
                action: 'login_blocked_inactive_admin',
                entityType: 'admin_user',
                entityId: admin.id,
                description: `${admin.username} attempted to log in while inactive`,
                statusCode: 403
            });
            return res.status(403).json({ error: 'This admin account is inactive. Contact the SuperAdmin.' });
        }
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const role = normalizeAdminRole(admin.role);
        req.session.authenticated = true;
        req.session.user = admin.username;
        req.session.adminId = admin.id;
        req.session.role = role;
        req.session.email = admin.email || '';

        try {
            await pool.query('UPDATE admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [admin.id]);
        } catch (lastLoginErr) {
            console.error('Error updating last login timestamp:', lastLoginErr.message || lastLoginErr);
        }
        await recordAdminActivity(req, {
            adminId: admin.id,
            adminUsername: admin.username,
            action: 'login',
            entityType: 'admin_user',
            entityId: admin.id,
            description: `${admin.username} logged in`,
            statusCode: 200,
            metadata: { role }
        });

        res.json({ message: 'Login successful', user: admin.username, role, adminId: admin.id });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
    const adminId = req.session?.adminId || null;
    const adminUsername = req.session?.user || null;
    const role = req.session?.role || null;

    req.session.destroy(async (err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Failed to log out' });
        }

        if (adminId) {
            await recordAdminActivity(req, {
                adminId,
                adminUsername,
                action: 'logout',
                entityType: 'admin_user',
                entityId: adminId,
                description: `${adminUsername} logged out`,
                statusCode: 200,
                metadata: { role }
            });
        }

        res.json({ message: 'Logged out' });
    });
});

// Check auth status endpoint
app.get('/api/auth-status', async (req, res) => {
    if (req.session && req.session.authenticated) {
        const sessionStillValid = await hydrateAdminSession(req);
        if (!sessionStillValid) {
            req.session.destroy(() => {});
            return res.json({ authenticated: false });
        }

        const role = normalizeAdminRole(req.session.role);
        return res.json({
            authenticated: true,
            user: req.session.user,
            adminId: req.session.adminId,
            email: req.session.email || '',
            role,
            isSuperAdmin: role === ADMIN_ROLE_SUPERADMIN
        });
    }
    res.json({ authenticated: false });
});

// Public password reset is disabled. Logged-in admins can still change their own
// password, and SuperAdmins can reset other admin passwords from Settings.
app.post('/api/request-password-reset', async (req, res) => {
    res.status(410).json({
        error: 'Password reset from the login page is disabled. Please sign in and change your password from Settings, or ask a SuperAdmin to reset it.'
    });
});

app.post('/api/reset-password', async (req, res) => {
    res.status(410).json({
        error: 'Password reset from the login page is disabled. Please sign in and change your password from Settings, or ask a SuperAdmin to reset it.'
    });
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
        await recordAdminActivity(req, {
            action: 'change_username',
            entityType: 'admin_user',
            entityId: admin.id,
            description: `${admin.username} changed username to ${newUsername.trim()}`,
            statusCode: 200,
            metadata: {
                previousUsername: admin.username,
                newUsername: newUsername.trim()
            }
        });
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
        await recordAdminActivity(req, {
            action: 'change_password',
            entityType: 'admin_user',
            entityId: admin.id,
            description: `${admin.username} changed their password`,
            statusCode: 200
        });
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
            query += ` GROUP BY m.id ORDER BY ${membershipNumberOrderSql}`;
            result = await pool.query(query, [member_type]);
        } else {
            query += ` GROUP BY m.id ORDER BY ${membershipNumberOrderSql}`;
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

// Staff: Get pending induction candidates (read-only, no auth required)
app.get('/api/staff/pending-members', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, candidate_code, member_type, title, first_name, surname, last_name,
                   other_names, organization, designation, position, sector, region,
                   phone_number, email, expertise, years_served_on_boards,
                   TO_CHAR(proposed_induction_date, 'DD/MM/YYYY') as proposed_induction_date,
                   status
            FROM pending_members
            WHERE status = 'Pending'
            ORDER BY proposed_induction_date NULLS LAST, created_at DESC, id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending members for staff:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

function toStaffGoodStandingMember(member, year) {
    return {
        id: member.id,
        membership_number: member.membership_number,
        member_type: member.member_type,
        membership_category: member.membership_category,
        title: member.title,
        first_name: member.first_name,
        surname: member.surname,
        last_name: member.last_name,
        other_names: member.other_names,
        organization: member.organization,
        expertise: member.expertise,
        designation: member.designation,
        position: member.position,
        region: member.region,
        email: member.email,
        phone_number: member.phone_number,
        date_of_admission: member.date_of_admission,
        subscription_year: year
    };
}

// Staff: Good Standing report (read-only, no auth required, no payment details exposed)
app.get('/api/staff/good-standing/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year, 10);
        if (!Number.isFinite(year)) {
            return res.status(400).json({ error: 'Invalid year' });
        }
        const goodStandingMembers = await getGoodStandingMembersForYear(year, { includePaymentDetails: false });
        res.json(goodStandingMembers.map(member => toStaffGoodStandingMember(member, year)));
    } catch (err) {
        console.error('Error fetching good standing for staff:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Auth middleware - protect everything else
async function requireAuth(req, res, next) {
    // Allow static assets (CSS, JS, fonts, images) without auth
    const ext = path.extname(req.path).toLowerCase();
    const publicExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    if (publicExts.includes(ext)) {
        return next();
    }
    
    if (req.session && req.session.authenticated) {
        const sessionStillValid = await hydrateAdminSession(req);
        if (sessionStillValid) {
            return next();
        }

        req.session.destroy(() => {});
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Admin account is inactive or no longer available' });
        }
        return res.redirect('/login.html');
    }
    
    // Allow staff read-only API without auth
    if (req.path.startsWith('/api/staff/')) {
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
app.use(adminActivityLogger);

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
// SUPERADMIN ADMINISTRATION ENDPOINTS
// ============================================================

app.get('/api/admin/users', requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                au.id,
                au.username,
                au.email,
                au.role,
                au.is_active,
                au.last_login_at,
                au.created_at,
                au.updated_at,
                au.created_by_admin_id,
                creator.username AS created_by_username
            FROM admin_users au
            LEFT JOIN admin_users creator ON creator.id = au.created_by_admin_id
            ORDER BY
                CASE WHEN au.role = $1 THEN 0 ELSE 1 END,
                au.created_at DESC
        `, [ADMIN_ROLE_SUPERADMIN]);

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching admin users:', err);
        res.status(500).json({ error: 'Failed to fetch admin users' });
    }
});

app.post('/api/admin/users', requireSuperAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (email && !validateEmail(email)) {
        return res.status(400).json({ error: 'Enter a valid email address' });
    }

    try {
        const existing = await pool.query('SELECT id FROM admin_users WHERE LOWER(username) = LOWER($1)', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(`
            INSERT INTO admin_users (username, email, password_hash, role, is_active, created_by_admin_id)
            VALUES ($1, $2, $3, $4, TRUE, $5)
            RETURNING id, username, email, role, is_active, last_login_at, created_at, updated_at, created_by_admin_id
        `, [username, email || null, passwordHash, ADMIN_ROLE_ADMIN, req.session.adminId]);

        const createdAdmin = result.rows[0];
        res.locals.activityAction = 'create_admin_user';
        res.locals.activityEntityType = 'admin_user';
        res.locals.activityEntityId = createdAdmin.id;
        res.locals.activityDescription = `${req.session.user} created admin user ${createdAdmin.username}`;
        res.locals.activityMetadata = { createdUsername: createdAdmin.username, createdRole: createdAdmin.role };

        res.status(201).json(createdAdmin);
    } catch (err) {
        console.error('Error creating admin user:', err);
        if (err.code === '23505') return res.status(400).json({ error: 'Username already taken' });
        res.status(500).json({ error: 'Failed to create admin user' });
    }
});

app.patch('/api/admin/users/:id/status', requireSuperAdmin, async (req, res) => {
    const adminId = parseInt(req.params.id, 10);
    const isActive = req.body.isActive === true;

    if (!Number.isFinite(adminId)) {
        return res.status(400).json({ error: 'Invalid admin id' });
    }

    if (adminId === req.session.adminId) {
        return res.status(400).json({ error: 'You cannot change your own account status' });
    }

    try {
        const existing = await pool.query('SELECT id, username, role FROM admin_users WHERE id = $1', [adminId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Admin user not found' });
        }

        const admin = existing.rows[0];
        if (normalizeAdminRole(admin.role) === ADMIN_ROLE_SUPERADMIN) {
            return res.status(400).json({ error: 'SuperAdmin status cannot be changed here' });
        }

        const result = await pool.query(`
            UPDATE admin_users
            SET is_active = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, username, email, role, is_active, last_login_at, created_at, updated_at, created_by_admin_id
        `, [isActive, adminId]);

        res.locals.activityAction = isActive ? 'activate_admin_user' : 'deactivate_admin_user';
        res.locals.activityEntityType = 'admin_user';
        res.locals.activityEntityId = adminId;
        res.locals.activityDescription = `${req.session.user} ${isActive ? 'activated' : 'deactivated'} admin user ${admin.username}`;
        res.locals.activityMetadata = { targetUsername: admin.username, isActive };

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating admin status:', err);
        res.status(500).json({ error: 'Failed to update admin status' });
    }
});

app.patch('/api/admin/users/:id/password', requireSuperAdmin, async (req, res) => {
    const adminId = parseInt(req.params.id, 10);
    const newPassword = String(req.body.newPassword || '');

    if (!Number.isFinite(adminId)) {
        return res.status(400).json({ error: 'Invalid admin id' });
    }

    if (adminId === req.session.adminId) {
        return res.status(400).json({ error: 'Use the Password tab to change your own password' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });
    }

    try {
        const existing = await pool.query('SELECT id, username, role FROM admin_users WHERE id = $1', [adminId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Admin user not found' });
        }

        const admin = existing.rows[0];
        if (normalizeAdminRole(admin.role) === ADMIN_ROLE_SUPERADMIN) {
            return res.status(400).json({ error: 'SuperAdmin passwords cannot be reset here' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        const result = await pool.query(`
            UPDATE admin_users
            SET password_hash = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, username, email, role, is_active, last_login_at, created_at, updated_at, created_by_admin_id
        `, [passwordHash, adminId]);

        res.locals.activityAction = 'reset_admin_password';
        res.locals.activityEntityType = 'admin_user';
        res.locals.activityEntityId = adminId;
        res.locals.activityDescription = `${req.session.user} reset password for admin user ${admin.username}`;
        res.locals.activityMetadata = { targetUsername: admin.username, targetRole: admin.role };

        res.json({
            message: 'Admin password reset successfully',
            admin: result.rows[0]
        });
    } catch (err) {
        console.error('Error resetting admin password:', err);
        res.status(500).json({ error: 'Failed to reset admin password' });
    }
});

app.delete('/api/admin/users/:id', requireSuperAdmin, async (req, res) => {
    const adminId = parseInt(req.params.id, 10);

    if (!Number.isFinite(adminId)) {
        return res.status(400).json({ error: 'Invalid admin id' });
    }

    if (adminId === req.session.adminId) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    try {
        const existing = await pool.query('SELECT id, username, role FROM admin_users WHERE id = $1', [adminId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Admin user not found' });
        }

        const admin = existing.rows[0];
        if (normalizeAdminRole(admin.role) === ADMIN_ROLE_SUPERADMIN) {
            return res.status(400).json({ error: 'SuperAdmin accounts cannot be deleted here' });
        }

        const result = await pool.query(`
            DELETE FROM admin_users
            WHERE id = $1
            RETURNING id, username, email, role
        `, [adminId]);

        res.locals.activityAction = 'delete_admin_user';
        res.locals.activityEntityType = 'admin_user';
        res.locals.activityEntityId = adminId;
        res.locals.activityDescription = `${req.session.user} deleted admin user ${admin.username}`;
        res.locals.activityMetadata = { targetUsername: admin.username, targetRole: admin.role };

        res.json({ message: 'Admin user deleted successfully', admin: result.rows[0] });
    } catch (err) {
        console.error('Error deleting admin user:', err);
        res.status(500).json({ error: 'Failed to delete admin user' });
    }
});

app.get('/api/admin/activity-logs', requireSuperAdmin, async (req, res) => {
    const requestedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50;

    try {
        const result = await pool.query(`
            SELECT
                aal.id,
                aal.admin_user_id,
                COALESCE(au.username, aal.admin_username) AS admin_username,
                COALESCE(au.role, 'admin') AS admin_role,
                aal.action,
                aal.entity_type,
                aal.entity_id,
                aal.description,
                aal.method,
                aal.path,
                aal.status_code,
                aal.ip_address,
                aal.metadata,
                aal.created_at
            FROM admin_activity_logs aal
            LEFT JOIN admin_users au ON au.id = aal.admin_user_id
            ORDER BY aal.created_at DESC
            LIMIT $1
        `, [limit]);

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching admin activity logs:', err);
        res.status(500).json({ error: 'Failed to fetch admin activity logs' });
    }
});

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

const membershipNumberOrderSql = `
    NULLIF(SUBSTRING(m.membership_number FROM '^[^0-9]*'), ''),
    COALESCE(NULLIF(SUBSTRING(m.membership_number FROM '[0-9]+'), '')::INTEGER, 0),
    m.membership_number
`;

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
                role VARCHAR(20) NOT NULL DEFAULT 'admin',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                last_login_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT admin_users_role_check CHECK (role IN ('superadmin', 'admin'))
            )
        `);

        await pool.query(`
            ALTER TABLE admin_users
                ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin',
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP
        `);

        await pool.query(`
            UPDATE admin_users
            SET role = 'admin'
            WHERE role IS NULL OR role NOT IN ('superadmin', 'admin')
        `);

        await pool.query(`
            UPDATE admin_users
            SET is_active = TRUE
            WHERE is_active IS NULL
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'admin_users_role_check'
                ) THEN
                    ALTER TABLE admin_users
                    ADD CONSTRAINT admin_users_role_check CHECK (role IN ('superadmin', 'admin'));
                END IF;
            END $$
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_activity_logs (
                id SERIAL PRIMARY KEY,
                admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                admin_username VARCHAR(100),
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(100),
                entity_id VARCHAR(100),
                description TEXT,
                method VARCHAR(10),
                path TEXT,
                status_code INTEGER,
                ip_address VARCHAR(100),
                user_agent TEXT,
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at
            ON admin_activity_logs(created_at DESC)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_user_id
            ON admin_activity_logs(admin_user_id)
        `);

        const adminCount = await pool.query('SELECT COUNT(*) FROM admin_users');
        if (parseInt(adminCount.rows[0].count, 10) === 0) {
            const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim();
            const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123!';
            const passwordHash = await bcrypt.hash(defaultPassword, 10);

            await pool.query(
                'INSERT INTO admin_users (username, password_hash, email, role, is_active) VALUES ($1, $2, $3, $4, TRUE)',
                [defaultUsername, passwordHash, process.env.ADMIN_DEFAULT_EMAIL || 'admin@iodghana.org', ADMIN_ROLE_SUPERADMIN]
            );

            console.log(`Default SuperAdmin user "${defaultUsername}" created`);
        }

        const superAdminCount = await pool.query('SELECT COUNT(*) FROM admin_users WHERE role = $1', [ADMIN_ROLE_SUPERADMIN]);
        if (parseInt(superAdminCount.rows[0].count, 10) === 0) {
            const firstAdmin = await pool.query('SELECT id, username FROM admin_users ORDER BY id ASC LIMIT 1');
            if (firstAdmin.rows.length > 0) {
                await pool.query('UPDATE admin_users SET role = $1, is_active = TRUE, updated_at = NOW() WHERE id = $2', [ADMIN_ROLE_SUPERADMIN, firstAdmin.rows[0].id]);
                console.log(`Existing admin user "${firstAdmin.rows[0].username}" promoted to SuperAdmin`);
            }
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
        
        // Create payments table for payment history tracking
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                subscription_year INTEGER,
                payment_amount DECIMAL(10, 2) NOT NULL,
                payment_date DATE NOT NULL,
                payment_method VARCHAR(50) CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Cheque', 'Card', 'Not Specified', NULL)),
                receipt_number VARCHAR(50),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'payments' AND column_name = 'subscription_year'
                ) THEN
                    ALTER TABLE payments ADD COLUMN subscription_year INTEGER;
                END IF;
            END $$
        `);

        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'subscriptions'
                ) THEN
                    ALTER TABLE subscriptions
                        ADD COLUMN IF NOT EXISTS recorded_by_admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                        ADD COLUMN IF NOT EXISTS recorded_by_admin_username VARCHAR(100);
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'payments'
                ) THEN
                    ALTER TABLE payments
                        ADD COLUMN IF NOT EXISTS recorded_by_admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                        ADD COLUMN IF NOT EXISTS recorded_by_admin_username VARCHAR(100);
                END IF;
            END $$
        `);

        // Create index for payments table
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_payments_member_id 
            ON payments(member_id)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_payments_payment_date 
            ON payments(payment_date)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_payments_recorded_by_admin_user_id
            ON payments(recorded_by_admin_user_id)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_subscriptions_recorded_by_admin_user_id
            ON subscriptions(recorded_by_admin_user_id)
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

        // Backfill any missing non-corporate future rates without changing customized rates.
        // Older databases may already have 2025-2028 rows, leaving overpayment credits
        // unable to roll into later years.
        const defaultIndividualRates = [
            { type: 'AIOD', amount: 350.00, desc: 'Associate annual subscription' },
            { type: 'FIOD', amount: 500.00, desc: 'Fellow annual subscription' },
            { type: 'MIOD', amount: 400.00, desc: 'Member annual subscription' },
            { type: 'Honorary', amount: 0.00, desc: 'Honorary - waived' }
        ];

        for (let year = 2025; year <= 2035; year++) {
            for (const rate of defaultIndividualRates) {
                let expectedAmount = rate.amount;
                if (year === 2025 && rate.type === 'AIOD') {
                    expectedAmount = 400.00;
                } else if (year === 2025 && rate.type === 'MIOD') {
                    expectedAmount = 800.00;
                }

                await pool.query(`
                    INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, membership_category, description)
                    VALUES ($1, $2, $3, NULL, $4)
                    ON CONFLICT (member_type, subscription_year, COALESCE(membership_category, '')) DO NOTHING
                `, [rate.type, year, expectedAmount, rate.desc]);
            }
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

async function initializePendingMembers() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_members (
                id SERIAL PRIMARY KEY,
                candidate_code TEXT UNIQUE,
                member_type VARCHAR(50) NOT NULL CHECK (member_type IN ('AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate')),
                title VARCHAR(20),
                first_name VARCHAR(100),
                surname VARCHAR(100),
                last_name VARCHAR(100),
                other_names VARCHAR(100),
                membership_category VARCHAR(50),
                gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', NULL)),
                organization VARCHAR(255) NOT NULL,
                designation VARCHAR(150),
                position VARCHAR(150),
                sector VARCHAR(100),
                region VARCHAR(100),
                postal_address TEXT,
                proposed_induction_date DATE,
                phone_number VARCHAR(50),
                email TEXT,
                feedback_on_calls TEXT,
                expertise TEXT,
                years_served_on_boards INTEGER DEFAULT 0,
                srl_no INTEGER,
                reg_no VARCHAR(50),
                contact_person VARCHAR(150),
                contact_phone VARCHAR(50),
                contact_email VARCHAR(150),
                status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Inducted', 'Archived')),
                category_confirmed BOOLEAN DEFAULT FALSE,
                notes TEXT,
                promoted_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                promoted_at TIMESTAMP,
                created_by_admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                created_by_admin_username VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            ALTER TABLE pending_members
                ADD COLUMN IF NOT EXISTS candidate_code TEXT UNIQUE,
                ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending',
                ADD COLUMN IF NOT EXISTS category_confirmed BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS notes TEXT,
                ADD COLUMN IF NOT EXISTS promoted_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS created_by_admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS created_by_admin_username VARCHAR(100),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pending_members_status
            ON pending_members(status)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pending_members_member_type
            ON pending_members(member_type)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_pending_members_created_at
            ON pending_members(created_at DESC)
        `);

        console.log('Pending members table initialized successfully');
    } catch (err) {
        console.error('Error initializing pending members table:', err);
    }
}

async function initializeApplication() {
    await initializeAdminUsers();
    await initializeSubscriptionRates();
    await initializePendingMembers();
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

async function generateMembershipNumber(client, memberType) {
    const prefixMap = {
        'AIOD': 'A',
        'FIOD': 'F',
        'MIOD': 'M',
        'Corporate': 'C',
        'Honorary': 'H'
    };
    const prefix = prefixMap[memberType] || 'M';

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

    return prefix + String(nextNumber).padStart(5, '0');
}

// ============================================================
// ROOT ROUTE
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// PENDING / INDUCTION MEMBER ENDPOINTS
// ============================================================

const pendingMemberColumns = [
    'member_type', 'title', 'first_name', 'surname', 'last_name', 'other_names',
    'membership_category', 'gender', 'organization', 'designation', 'position',
    'sector', 'region', 'postal_address', 'proposed_induction_date',
    'phone_number', 'email', 'feedback_on_calls', 'expertise',
    'years_served_on_boards', 'srl_no', 'reg_no', 'contact_person',
    'contact_phone', 'contact_email', 'notes'
];

function buildPendingMemberValues(data) {
    return pendingMemberColumns.map(column => {
        if (column === 'years_served_on_boards') {
            return parseInt(data[column], 10) || 0;
        }
        if (column === 'proposed_induction_date') {
            return data[column] || null;
        }
        if (column === 'srl_no') {
            const value = parseInt(data[column], 10);
            return Number.isFinite(value) ? value : null;
        }
        return data[column] || null;
    });
}

async function promotePendingMemberFromRow(client, pending, options, req) {
    const selectedMemberType = sanitizeString(options.member_type || pending.member_type || '');
    if (!validateMemberType(selectedMemberType)) {
        throw new Error('Select a valid member type before importing');
    }

    const selectedMembershipCategory = selectedMemberType === 'Corporate'
        ? sanitizeString(options.membership_category || pending.membership_category || 'Gold')
        : null;
    const membershipNumber = await generateMembershipNumber(client, selectedMemberType);
    const inductionDate = options.induction_date || pending.proposed_induction_date || new Date().toISOString().slice(0, 10);
    const recorder = getSessionAdminRecorder(req);

    const memberResult = await client.query(`
        INSERT INTO members (
            membership_number, member_type, title, first_name, surname, last_name,
            other_names, membership_category, gender, organization, designation,
            position, sector, region, postal_address, date_of_admission,
            registration_date, phone_number, email, feedback_on_calls,
            expertise, years_served_on_boards, srl_no, reg_no, contact_person,
            contact_phone, contact_email
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
        )
        RETURNING *
    `, [
        membershipNumber, selectedMemberType, pending.title, pending.first_name, pending.surname,
        pending.last_name, pending.other_names, selectedMembershipCategory, pending.gender,
        pending.organization, pending.designation, pending.position, pending.sector, pending.region,
        pending.postal_address, selectedMemberType === 'Corporate' ? null : inductionDate,
        selectedMemberType === 'Corporate' ? inductionDate : null, pending.phone_number, pending.email,
        pending.feedback_on_calls, pending.expertise, pending.years_served_on_boards || 0,
        pending.srl_no, pending.reg_no, pending.contact_person, pending.contact_phone, pending.contact_email
    ]);

    const member = memberResult.rows[0];
    const inductionYear = new Date(inductionDate).getFullYear();
    if (Number.isFinite(inductionYear)) {
        await client.query(`
            INSERT INTO subscriptions (
                member_id, subscription_year, status, amount_paid, payment_date,
                payment_method, recorded_by_admin_user_id, recorded_by_admin_username
            )
            VALUES ($1, $2, 'Paid', 0, $3, 'Not Specified', $4, $5)
            ON CONFLICT (member_id, subscription_year) DO NOTHING
        `, [member.id, inductionYear, inductionDate, recorder.adminUserId, recorder.adminUsername]);
    }

    const deletedPending = await client.query(`
        DELETE FROM pending_members
        WHERE id = $1
        RETURNING *
    `, [pending.id]);

    return { member, pending_member: deletedPending.rows[0] };
}

app.get('/api/pending-members', async (req, res) => {
    try {
        const includeAll = req.query.include_all === 'true';
        const result = await pool.query(`
            SELECT *
            FROM pending_members
            ${includeAll ? '' : "WHERE status = 'Pending'"}
            ORDER BY created_at DESC, id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending members:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/pending-members/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pending_members WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pending member not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching pending member:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/pending-members', async (req, res) => {
    const { errors, sanitized } = validateAndSanitizeMemberData(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    if (!sanitized.member_type) {
        return res.status(400).json({ error: 'Member type is required' });
    }
    if (!sanitized.organization || !String(sanitized.organization).trim()) {
        return res.status(400).json({ error: 'Organization is required' });
    }

    const recorder = getSessionAdminRecorder(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const values = buildPendingMemberValues(sanitized);
        const columnsSql = pendingMemberColumns.join(', ');
        const placeholders = pendingMemberColumns.map((_, index) => `$${index + 1}`).join(', ');

        const result = await client.query(`
            INSERT INTO pending_members (
                ${columnsSql}, created_by_admin_user_id, created_by_admin_username
            )
            VALUES (${placeholders}, $${values.length + 1}, $${values.length + 2})
            RETURNING *
        `, [...values, recorder.adminUserId, recorder.adminUsername]);

        const candidate = result.rows[0];
        const candidateCode = `IND-${new Date().getFullYear()}-${String(candidate.id).padStart(4, '0')}`;
        const updated = await client.query(
            'UPDATE pending_members SET candidate_code = $1 WHERE id = $2 RETURNING *',
            [candidateCode, candidate.id]
        );

        await client.query('COMMIT');
        res.locals.activityAction = 'create_pending_member';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityEntityId = candidate.id;
        res.locals.activityDescription = `${req.session.user} added induction candidate ${candidateCode}`;
        res.status(201).json(updated.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating pending member:', err);
        res.status(500).json({ error: err.message || 'Database error' });
    } finally {
        client.release();
    }
});

app.put('/api/pending-members/:id', async (req, res) => {
    const { errors, sanitized } = validateAndSanitizeMemberData(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    if (!sanitized.member_type) {
        return res.status(400).json({ error: 'Member type is required' });
    }
    if (!sanitized.organization || !String(sanitized.organization).trim()) {
        return res.status(400).json({ error: 'Organization is required' });
    }

    try {
        const values = buildPendingMemberValues(sanitized);
        const assignments = pendingMemberColumns.map((column, index) => `${column} = $${index + 1}`).join(', ');
        const result = await pool.query(`
            UPDATE pending_members
            SET ${assignments}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length + 1} AND status = 'Pending'
            RETURNING *
        `, [...values, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pending member not found or already promoted' });
        }

        res.locals.activityAction = 'update_pending_member';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityEntityId = req.params.id;
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating pending member:', err);
        res.status(500).json({ error: err.message || 'Database error' });
    }
});

app.post('/api/pending-members/:id/promote', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pendingResult = await client.query(`
            SELECT *
            FROM pending_members
            WHERE id = $1
            FOR UPDATE
        `, [req.params.id]);

        if (pendingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pending member not found' });
        }

        const pending = pendingResult.rows[0];
        if (pending.status !== 'Pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Candidate has already been processed' });
        }

        const { member, pending_member: deletedPending } = await promotePendingMemberFromRow(client, pending, {
            induction_date: req.body.induction_date,
            member_type: req.body.member_type,
            membership_category: req.body.membership_category
        }, req);

        await client.query('COMMIT');

        res.locals.activityAction = 'promote_pending_member';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityEntityId = pending.id;
        res.locals.activityDescription = `${req.session.user} promoted ${pending.candidate_code || pending.id} to ${member.membership_number}`;
        res.json({ member, pending_member: deletedPending });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error promoting pending member:', err);
        res.status(500).json({ error: err.message || 'Database error' });
    } finally {
        client.release();
    }
});

app.patch('/api/pending-members/bulk-category', async (req, res) => {
    const ids = Array.isArray(req.body.ids)
        ? req.body.ids.map(id => parseInt(id, 10)).filter(Number.isFinite)
        : [];
    const memberType = sanitizeString(req.body.member_type || '');
    const membershipCategory = memberType === 'Corporate'
        ? sanitizeString(req.body.membership_category || 'Gold')
        : null;

    if (ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one candidate' });
    }
    if (!validateMemberType(memberType)) {
        return res.status(400).json({ error: 'Select a valid member category' });
    }

    try {
        const result = await pool.query(`
            UPDATE pending_members
            SET member_type = $1,
                membership_category = $2,
                category_confirmed = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ANY($3::int[]) AND status = 'Pending'
            RETURNING *
        `, [memberType, membershipCategory, ids]);

        res.locals.activityAction = 'bulk_sort_pending_members';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityDescription = `${req.session.user} sorted ${result.rowCount} induction candidate${result.rowCount === 1 ? '' : 's'} as ${memberType}`;
        res.locals.activityMetadata = { ids, member_type: memberType, membership_category: membershipCategory };

        res.json({ updated_count: result.rowCount, candidates: result.rows });
    } catch (err) {
        console.error('Error bulk sorting pending members:', err);
        res.status(500).json({ error: err.message || 'Database error' });
    }
});

app.post('/api/pending-members/bulk-import', async (req, res) => {
    const ids = Array.isArray(req.body.ids)
        ? req.body.ids.map(id => parseInt(id, 10)).filter(Number.isFinite)
        : [];

    if (ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one sorted candidate to import' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pendingResult = await client.query(`
            SELECT *
            FROM pending_members
            WHERE id = ANY($1::int[])
            ORDER BY proposed_induction_date NULLS LAST, id ASC
            FOR UPDATE
        `, [ids]);

        const imported = [];
        const skipped = [];
        const foundIds = new Set(pendingResult.rows.map(row => Number(row.id)));
        for (const id of ids) {
            if (!foundIds.has(id)) {
                skipped.push({ id, reason: 'Candidate not found' });
            }
        }

        for (const pending of pendingResult.rows) {
            if (pending.status !== 'Pending') {
                skipped.push({ id: pending.id, candidate_code: pending.candidate_code, reason: 'Already processed' });
                continue;
            }
            if (pending.category_confirmed !== true) {
                skipped.push({ id: pending.id, candidate_code: pending.candidate_code, reason: 'Category not confirmed' });
                continue;
            }
            if (!validateMemberType(pending.member_type)) {
                skipped.push({ id: pending.id, candidate_code: pending.candidate_code, reason: 'Invalid member category' });
                continue;
            }

            const result = await promotePendingMemberFromRow(client, pending, {
                induction_date: pending.proposed_induction_date,
                member_type: pending.member_type,
                membership_category: pending.membership_category
            }, req);
            imported.push({
                id: pending.id,
                candidate_code: pending.candidate_code,
                membership_number: result.member.membership_number,
                member_type: result.member.member_type
            });
        }

        if (imported.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'No candidates were imported. Confirm each candidate category first.',
                skipped
            });
        }

        await client.query('COMMIT');

        res.locals.activityAction = 'bulk_import_pending_members';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityDescription = `${req.session.user} bulk imported ${imported.length} induction candidate${imported.length === 1 ? '' : 's'}`;
        res.locals.activityMetadata = { imported, skipped };

        res.json({ imported_count: imported.length, imported, skipped });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error bulk importing pending members:', err);
        res.status(500).json({ error: err.message || 'Database error' });
    } finally {
        client.release();
    }
});

app.delete('/api/pending-members/history', async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM pending_members
            WHERE status <> 'Pending'
            RETURNING id
        `);

        res.locals.activityAction = 'clear_pending_member_history';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityDescription = `${req.session.user} cleared ${result.rowCount} induction history record${result.rowCount === 1 ? '' : 's'}`;
        res.locals.activityMetadata = { deletedCount: result.rowCount };

        res.json({
            message: 'Induction history cleared',
            deleted_count: result.rowCount
        });
    } catch (err) {
        console.error('Error clearing induction history:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/pending-members/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE pending_members
            SET status = 'Archived', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'Pending'
            RETURNING *
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pending member not found or already processed' });
        }

        res.locals.activityAction = 'archive_pending_member';
        res.locals.activityEntityType = 'pending_member';
        res.locals.activityEntityId = req.params.id;
        res.json({ message: 'Pending member archived', pending_member: result.rows[0] });
    } catch (err) {
        console.error('Error archiving pending member:', err);
        res.status(500).json({ error: 'Database error' });
    }
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
                   (SELECT COALESCE(rau.username, s2.recorded_by_admin_username, s2.receipt_number)
                    FROM subscriptions s2
                    LEFT JOIN admin_users rau ON rau.id = s2.recorded_by_admin_user_id
                    WHERE s2.member_id = m.id
                    ORDER BY s2.subscription_year DESC, s2.payment_date DESC
                    LIMIT 1) as recorded_by,
                   (SELECT s2.payment_method FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC, s2.payment_date DESC LIMIT 1) as payment_method
            FROM members m
            LEFT JOIN subscriptions s ON m.id = s.member_id
        `;

        let result;
        if (member_type) {
            query += ` WHERE m.member_type = $1`;
            query += ` GROUP BY m.id ORDER BY ${membershipNumberOrderSql}`;
            result = await pool.query(query, [member_type]);
        } else {
            query += ` GROUP BY m.id ORDER BY ${membershipNumberOrderSql}`;
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
                   (SELECT COALESCE(rau.username, s2.recorded_by_admin_username, s2.receipt_number)
                    FROM subscriptions s2
                    LEFT JOIN admin_users rau ON rau.id = s2.recorded_by_admin_user_id
                    WHERE s2.member_id = m.id
                    ORDER BY s2.subscription_year DESC, s2.payment_date DESC
                    LIMIT 1) as recorded_by,
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
            payment_method
        } = sanitized;
        const recorder = getSessionAdminRecorder(req);

        const membership_number = await generateMembershipNumber(client, member_type);

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
                    INSERT INTO subscriptions (
                        member_id, subscription_year, status, amount_paid, payment_date,
                        payment_method, recorded_by_admin_user_id, recorded_by_admin_username
                    )
                    VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
                    ON CONFLICT (member_id, subscription_year) DO UPDATE SET
                        status = $3,
                        amount_paid = $4,
                        payment_date = CURRENT_DATE,
                        payment_method = $5,
                        recorded_by_admin_user_id = $6,
                        recorded_by_admin_username = $7
                `, [
                    memberId,
                    year,
                    subscriptionStatus,
                    subscriptionAmount,
                    payment_method || null,
                    recorder.adminUserId,
                    recorder.adminUsername
                ]);
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
        getYearFromDateValue(member.registration_date);
}

function isInductionYearSubscription(member, subscriptionYear, explicitStatus, amountPaid) {
    const inductionYear = getMemberInductionYear(member);
    const year = parseInt(subscriptionYear, 10);

    return Number.isFinite(inductionYear) &&
        Number.isFinite(year) &&
        year === inductionYear;
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

async function getGoodStandingMembersForYear(year, { includePaymentDetails = false } = {}) {
    const allMembersResult = await pool.query(`
        SELECT DISTINCT m.id, m.membership_number, m.member_type, m.membership_category,
               m.title, m.first_name, m.surname, m.last_name, m.other_names,
               m.organization, m.expertise, m.designation, m.position, m.region, m.email, m.phone_number,
               TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') as date_of_admission,
               TO_CHAR(m.registration_date, 'DD/MM/YYYY') as registration_date,
               m.created_at
        FROM members m
        WHERE m.member_type IN ('FIOD', 'MIOD', 'AIOD', 'Corporate', 'Honorary')
    `);

    const subscriptionsResult = await pool.query(`
        SELECT s.*,
               COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as rate_expected_amount,
               COALESCE(rau.username, s.recorded_by_admin_username, s.receipt_number) as recorded_by,
               TO_CHAR(s.payment_date, 'DD/MM/YYYY') as payment_date_fmt
        FROM subscriptions s
        JOIN members m ON m.id = s.member_id
        LEFT JOIN subscription_rates sr ON sr.member_type = m.member_type
            AND sr.subscription_year = s.subscription_year
            AND (
                (m.member_type != 'Corporate' AND sr.membership_category IS NULL)
                OR (m.member_type = 'Corporate' AND sr.membership_category = m.membership_category)
            )
        LEFT JOIN admin_users rau ON rau.id = s.recorded_by_admin_user_id
        WHERE s.subscription_year <= $1
        ORDER BY s.member_id ASC, s.subscription_year ASC
    `, [year]);

    const ratesResult = await pool.query(`
        SELECT member_type, membership_category, subscription_year, expected_amount
        FROM subscription_rates
    `);

    const subscriptionsByMember = new Map();
    for (const subscription of subscriptionsResult.rows) {
        if (!subscriptionsByMember.has(subscription.member_id)) {
            subscriptionsByMember.set(subscription.member_id, []);
        }
        subscriptionsByMember.get(subscription.member_id).push(subscription);
    }

    const rateKey = (memberType, category) => `${memberType || ''}::${category || ''}`;
    const ratesByMemberType = new Map();
    for (const rate of ratesResult.rows) {
        const key = rateKey(rate.member_type, rate.member_type === 'Corporate' ? rate.membership_category : '');
        if (!ratesByMemberType.has(key)) {
            ratesByMemberType.set(key, {});
        }
        ratesByMemberType.get(key)[rate.subscription_year] = parseFloat(rate.expected_amount || 0);
    }

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
                is_induction_year: false,
                induction_note: null,
                recorded_by: null,
                payment_date: null
            });
            continue;
        }

        const memberSubscriptions = subscriptionsByMember.get(member.id) || [];
        const memberInductionYear = getMemberInductionYear(member);
        if (memberSubscriptions.length === 0) {
            if (memberInductionYear === year) {
                goodStandingMembers.push({
                    ...member,
                    subscription_year: year,
                    status: 'Paid',
                    amount_paid: 0,
                    credit_applied: 0,
                    expected_amount: 0,
                    is_induction_year: true,
                    induction_note: 'Inducted this year',
                    recorded_by: null,
                    payment_date: null
                });
            }
            continue;
        }

        const memberRatesMap = ratesByMemberType.get(
            rateKey(member.member_type, member.member_type === 'Corporate' ? member.membership_category : '')
        ) || {};
        let carryForwardCredit = 0;
        let targetYearData = null;

        for (let i = 0; i < memberSubscriptions.length; i++) {
            const sub = memberSubscriptions[i];

            if (i > 0 && carryForwardCredit > 0) {
                const prevSubYear = memberSubscriptions[i - 1].subscription_year;
                for (let gapYear = prevSubYear + 1; gapYear < sub.subscription_year; gapYear++) {
                    if (carryForwardCredit <= 0) break;
                    const gapRate = memberRatesMap[gapYear] || 0;
                    const gapOutcome = calculateCreditOutcome({
                        subscriptionYear: gapYear,
                        memberType: member.member_type,
                        explicitStatus: 'Pending',
                        amountPaid: 0,
                        expectedAmount: gapRate,
                        availableCredit: carryForwardCredit,
                        isInductionYear: isInductionYearSubscription(member, gapYear, 'Pending', 0)
                    });

                    if (gapYear === year) {
                        targetYearData = {
                            amountPaid: 0,
                            creditApplied: gapOutcome.creditApplied,
                            rateExpected: gapRate,
                            creditBalance: gapOutcome.creditBalance,
                            recorded_by: null,
                            payment_date: null,
                            isWaived: gapOutcome.isWaived,
                            isLegacyPaid: gapOutcome.isLegacyPaid,
                            isInductionYear: gapOutcome.isInductionYear,
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
            const lastSubYear = memberSubscriptions.length > 0
                ? memberSubscriptions[memberSubscriptions.length - 1].subscription_year
                : 0;

            for (let gapYear = lastSubYear + 1; gapYear <= year; gapYear++) {
                if (carryForwardCredit <= 0) break;
                const gapRate = memberRatesMap[gapYear] || 0;
                const gapOutcome = calculateCreditOutcome({
                    subscriptionYear: gapYear,
                    memberType: member.member_type,
                    explicitStatus: 'Pending',
                    amountPaid: 0,
                    expectedAmount: gapRate,
                    availableCredit: carryForwardCredit,
                    isInductionYear: isInductionYearSubscription(member, gapYear, 'Pending', 0)
                });

                if (gapYear === year) {
                    targetYearData = {
                        amountPaid: 0,
                        creditApplied: gapOutcome.creditApplied,
                        rateExpected: gapRate,
                        creditBalance: gapOutcome.creditBalance,
                        recorded_by: null,
                        payment_date: null,
                        isWaived: gapOutcome.isWaived,
                        isLegacyPaid: gapOutcome.isLegacyPaid,
                        isInductionYear: gapOutcome.isInductionYear,
                        status: gapOutcome.status
                    };
                }
                carryForwardCredit = gapOutcome.creditBalance;
            }
        }

        if (!targetYearData && memberInductionYear === year) {
            targetYearData = {
                amountPaid: 0,
                creditApplied: 0,
                rateExpected: 0,
                creditBalance: carryForwardCredit,
                recorded_by: null,
                payment_date: null,
                isWaived: false,
                isLegacyPaid: false,
                isInductionYear: true,
                status: 'Paid'
            };
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
                amount_paid: includePaymentDetails ? targetYearData.amountPaid : 0,
                credit_applied: includePaymentDetails ? targetYearData.creditApplied : 0,
                expected_amount: includePaymentDetails ? targetYearData.rateExpected : 0,
                is_induction_year: targetYearData.isInductionYear === true,
                induction_note: targetYearData.isInductionYear ? 'Inducted this year' : null,
                recorded_by: includePaymentDetails ? targetYearData.recorded_by : null,
                payment_date: includePaymentDetails ? targetYearData.payment_date : null
            });
        }
    }

    goodStandingMembers.sort((a, b) => {
        if (a.member_type !== b.member_type) return a.member_type.localeCompare(b.member_type);
        return (a.membership_number || '').localeCompare(b.membership_number || '');
    });

    return goodStandingMembers;
}

function moneyValue(value) {
    const amount = parseFloat(value);
    return Number.isFinite(amount) ? amount : 0;
}

function resolvePaymentYear(paymentDate, fallbackYear = new Date().getFullYear()) {
    return getYearFromDateValue(paymentDate) || fallbackYear;
}

async function getMemberLedgerContext(client, memberId) {
    const result = await client.query(`
        SELECT id, member_type, membership_number, membership_category,
               date_of_admission, registration_date, created_at,
               EXTRACT(YEAR FROM COALESCE(date_of_admission, registration_date))::int as induction_year
        FROM members
        WHERE id = $1
    `, [memberId]);

    if (result.rows.length === 0) {
        const error = new Error('Member not found');
        error.statusCode = 404;
        throw error;
    }

    return result.rows[0];
}

async function getMemberRates(client, memberType, membershipCategory) {
    const result = await client.query(`
        SELECT subscription_year, expected_amount
        FROM subscription_rates
        WHERE member_type = $1
        AND (
            ($1 != 'Corporate' AND membership_category IS NULL)
            OR ($1 = 'Corporate' AND membership_category = $2)
        )
        ORDER BY subscription_year ASC
    `, [memberType, membershipCategory]);

    const ratesByYear = {};
    let maxRateYear = null;
    for (const row of result.rows) {
        const year = parseInt(row.subscription_year, 10);
        ratesByYear[year] = Math.max(0, moneyValue(row.expected_amount));
        if (Number.isFinite(year)) {
            maxRateYear = maxRateYear === null ? year : Math.max(maxRateYear, year);
        }
    }

    return { ratesByYear, maxRateYear };
}

async function getApplicableExpectedAmount(client, memberType, membershipCategory, subscriptionYear, paymentDate) {
    const paymentDateStr = paymentDate || new Date().toISOString().split('T')[0];
    const result = await client.query(`
        SELECT
            CASE
                WHEN early_bird_deadline IS NOT NULL
                    AND early_bird_amount IS NOT NULL
                    AND $3::date <= early_bird_deadline
                THEN early_bird_amount
                ELSE expected_amount
            END as applicable_amount
        FROM subscription_rates
        WHERE member_type = $1 AND subscription_year = $2
        AND (
            ($1 != 'Corporate' AND membership_category IS NULL)
            OR ($1 = 'Corporate' AND membership_category = $4)
        )
    `, [memberType, subscriptionYear, paymentDateStr, membershipCategory]);

    return result.rows.length > 0 ? Math.max(0, moneyValue(result.rows[0].applicable_amount)) : 0;
}

function resolveExpectedAmount(sub, ratesByYear, year) {
    const storedExpected = moneyValue(sub && sub.expected_amount);
    if (storedExpected > 0) {
        return storedExpected;
    }

    return Math.max(0, moneyValue(ratesByYear[year]));
}

async function recalculateMemberCreditLedger(client, memberId, options = {}) {
    const {
        persistAutoYears = false,
        includeCurrentYear = true,
        includeFutureCreditYears = true,
        recorder = null
    } = options;

    const currentYear = new Date().getFullYear();
    const member = await getMemberLedgerContext(client, memberId);
    const { ratesByYear, maxRateYear } = await getMemberRates(client, member.member_type, member.membership_category);
    const lockClause = persistAutoYears ? ' FOR UPDATE OF s' : '';

    const subscriptionsResult = await client.query(`
        SELECT
            s.*,
            COALESCE(rau.username, s.recorded_by_admin_username, s.receipt_number) AS recorded_by
        FROM subscriptions s
        LEFT JOIN admin_users rau ON rau.id = s.recorded_by_admin_user_id
        WHERE s.member_id = $1
        ORDER BY s.subscription_year ASC, s.id ASC${lockClause}
    `, [memberId]);

    const subscriptionsByYear = new Map();
    for (const sub of subscriptionsResult.rows) {
        subscriptionsByYear.set(parseInt(sub.subscription_year, 10), sub);
    }

    const existingYears = subscriptionsResult.rows
        .map(sub => parseInt(sub.subscription_year, 10))
        .filter(Number.isFinite);
    const startYear = existingYears.length > 0 ? Math.min(...existingYears) : currentYear;
    const maxExistingYear = existingYears.length > 0 ? Math.max(...existingYears) : currentYear;
    const endYear = includeCurrentYear ? Math.max(maxExistingYear, currentYear) : maxExistingYear;
    const timeline = [];
    let carryForwardCredit = 0;
    let currentYearCreditBalance = 0;
    const membershipStartYear = getMemberInductionYear(member);

    const hasRealSubscriptionActivity = (sub) => {
        if (!sub) return false;
        return hasPositiveAmount(sub.amount_paid) ||
            hasPositiveAmount(sub.credit_applied) ||
            hasPositiveAmount(sub.credit_balance) ||
            sub.status === 'Paid' ||
            sub.status === 'Waived';
    };

    const persistTimelineRow = async (row, existingSub) => {
        if (!persistAutoYears) return row;

        if (existingSub) {
            await client.query(`
                UPDATE subscriptions
                SET status = $1,
                    expected_amount = $2,
                    credit_applied = $3,
                    credit_balance = $4
                WHERE id = $5
            `, [
                row.status,
                row.expected_amount,
                row.credit_applied,
                row.credit_balance,
                existingSub.id
            ]);
            return row;
        }

        if (row.credit_applied <= 0 && row.amount_paid <= 0 && row.status !== 'Waived') {
            return row;
        }

        const inserted = await client.query(`
            INSERT INTO subscriptions (
                member_id, subscription_year, status, amount_paid,
                expected_amount, credit_applied, credit_balance,
                recorded_by_admin_user_id, recorded_by_admin_username
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (member_id, subscription_year)
            DO UPDATE SET
                status = EXCLUDED.status,
                amount_paid = subscriptions.amount_paid,
                expected_amount = EXCLUDED.expected_amount,
                credit_applied = EXCLUDED.credit_applied,
                credit_balance = EXCLUDED.credit_balance,
                recorded_by_admin_user_id = COALESCE(subscriptions.recorded_by_admin_user_id, EXCLUDED.recorded_by_admin_user_id),
                recorded_by_admin_username = COALESCE(subscriptions.recorded_by_admin_username, EXCLUDED.recorded_by_admin_username)
            RETURNING *
        `, [
            memberId,
            row.subscription_year,
            row.status,
            row.amount_paid,
            row.expected_amount,
            row.credit_applied,
            row.credit_balance,
            recorder?.adminUserId || null,
            recorder?.adminUsername || null
        ]);

        return {
            ...row,
            ...inserted.rows[0],
            rate_expected_amount: row.expected_amount,
            computed_status: row.status,
            is_virtual: false,
            is_auto_generated: true
        };
    };

    const addYearToTimeline = async (year, existingSub = null) => {
        if (
            Number.isFinite(membershipStartYear) &&
            year < membershipStartYear &&
            !hasRealSubscriptionActivity(existingSub)
        ) {
            return;
        }

        const isBeforeMembershipStart = Number.isFinite(membershipStartYear) && year < membershipStartYear;
        const expectedAmount = isBeforeMembershipStart ? 0 : resolveExpectedAmount(existingSub, ratesByYear, year);
        const amountPaid = Math.max(0, moneyValue(existingSub && existingSub.amount_paid));
        const explicitStatus = existingSub ? existingSub.status : 'Pending';
        const outcome = calculateCreditOutcome({
            subscriptionYear: year,
            memberType: member.member_type,
            explicitStatus,
            amountPaid,
            expectedAmount,
            availableCredit: carryForwardCredit,
            isInductionYear: isInductionYearSubscription(member, year, explicitStatus, amountPaid)
        });

        let row = {
            ...(existingSub || {}),
            member_id: parseInt(memberId, 10),
            subscription_year: year,
            amount_paid: amountPaid,
            expected_amount: expectedAmount,
            rate_expected_amount: expectedAmount,
            credit_applied: outcome.creditApplied,
            credit_balance: outcome.creditBalance,
            status: outcome.status,
            computed_status: outcome.status,
            legacy_paid_override: outcome.isLegacyPaid && explicitStatus !== 'Paid',
            is_induction_year: outcome.isInductionYear,
            induction_note: outcome.isInductionYear ? 'Inducted this year' : null,
            balance_due: outcome.isInductionYear ? null : Math.max(0, expectedAmount - outcome.totalApplied),
            is_virtual: !existingSub
        };

        row = await persistTimelineRow(row, existingSub);
        timeline.push(row);
        carryForwardCredit = outcome.creditBalance;

        if (year <= currentYear) {
            currentYearCreditBalance = carryForwardCredit;
        }
    };

    for (let year = startYear; year <= endYear; year++) {
        await addYearToTimeline(year, subscriptionsByYear.get(year) || null);
    }

    let nextYear = endYear + 1;
    while (
        includeFutureCreditYears &&
        carryForwardCredit > 0 &&
        maxRateYear !== null &&
        nextYear <= maxRateYear
    ) {
        const expectedAmount = Math.max(0, moneyValue(ratesByYear[nextYear]));
        if (expectedAmount <= 0) {
            break;
        }

        await addYearToTimeline(nextYear, null);
        nextYear += 1;
    }

    return {
        member,
        subscriptions: timeline,
        current_credit_balance: currentYearCreditBalance,
        projected_credit_balance: carryForwardCredit,
        max_rate_year: maxRateYear
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
        const recorder = getSessionAdminRecorder(req);

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
                                INSERT INTO subscriptions (
                                    member_id, subscription_year, status, amount_paid,
                                    recorded_by_admin_user_id, recorded_by_admin_username
                                )
                                VALUES ($1, $2, $3, $4, $5, $6)
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
                                    END,
                                    recorded_by_admin_user_id = EXCLUDED.recorded_by_admin_user_id,
                                    recorded_by_admin_username = EXCLUDED.recorded_by_admin_username
                            `, [
                                newMemberId,
                                subCol.year,
                                importedSubscription.status,
                                importedSubscription.amountPaid,
                                recorder.adminUserId,
                                recorder.adminUsername
                            ]);
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
                            INSERT INTO subscriptions (
                                member_id, subscription_year, status,
                                recorded_by_admin_user_id, recorded_by_admin_username
                            )
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (member_id, subscription_year) DO NOTHING
                        `, [
                            newMemberId,
                            currentYear,
                            defaultStatus,
                            recorder.adminUserId,
                            recorder.adminUsername
                        ]);
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
            payment_method
        } = sanitized;
        const recorder = getSessionAdminRecorder(req);

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
                        INSERT INTO subscriptions (
                            member_id, subscription_year, status, amount_paid, payment_date,
                            payment_method, recorded_by_admin_user_id, recorded_by_admin_username
                        )
                        VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
                    `, [
                        req.params.id,
                        year,
                        payment_status || 'Pending',
                        amount_paid || 0,
                        payment_method || null,
                        recorder.adminUserId,
                        recorder.adminUsername
                    ]);
                } else {
                    // Update existing year with new payment information (if payment info is provided)
                    if (payment_status || amount_paid > 0 || payment_method) {
                        await client.query(`
                            UPDATE subscriptions 
                            SET status = COALESCE($3, status),
                                amount_paid = CASE WHEN $4 > 0 THEN $4 ELSE amount_paid END,
                                payment_method = COALESCE($5, payment_method),
                                payment_date = COALESCE(payment_date, CURRENT_DATE),
                                recorded_by_admin_user_id = $6,
                                recorded_by_admin_username = $7
                            WHERE member_id = $1 AND subscription_year = $2
                        `, [
                            req.params.id,
                            year,
                            payment_status || null,
                            amount_paid || 0,
                            payment_method || null,
                            recorder.adminUserId,
                            recorder.adminUsername
                        ]);
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
            SELECT
                s.*,
                COALESCE(rau.username, s.recorded_by_admin_username, s.receipt_number) AS recorded_by
            FROM subscriptions s
            LEFT JOIN admin_users rau ON rau.id = s.recorded_by_admin_user_id
            WHERE s.member_id = $1
            ORDER BY s.subscription_year DESC
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
        const recorder = getSessionAdminRecorder(req);
        
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
            INSERT INTO subscriptions (
                member_id, subscription_year, status, amount_paid,
                expected_amount, credit_applied, credit_balance,
                payment_method, receipt_number, payment_date,
                recorded_by_admin_user_id, recorded_by_admin_username
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
            payment_date || null,
            recorder.adminUserId,
            recorder.adminUsername
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
        const recorder = getSessionAdminRecorder(req);
        
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
                payment_date = COALESCE($8, payment_date),
                recorded_by_admin_user_id = $9,
                recorded_by_admin_username = $10
            WHERE id = $11
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
            recorder.adminUserId,
            recorder.adminUsername,
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
        const recorder = getSessionAdminRecorder(req);
        
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
                    payment_method, receipt_number, payment_date,
                    recorded_by_admin_user_id, recorded_by_admin_username
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (member_id, subscription_year) 
                DO UPDATE SET 
                    status = $3,
                    amount_paid = $4,
                    expected_amount = $5,
                    credit_applied = $6,
                    credit_balance = $7,
                    payment_method = COALESCE($8, subscriptions.payment_method),
                    receipt_number = COALESCE($9, subscriptions.receipt_number),
                    payment_date = COALESCE($10, subscriptions.payment_date),
                    recorded_by_admin_user_id = $11,
                    recorded_by_admin_username = $12
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
                payment_date || new Date().toISOString().split('T')[0],
                recorder.adminUserId,
                recorder.adminUsername
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

            const updatedTimeline = await recalculateMemberCreditLedger(client, memberId, {
                persistAutoYears: true,
                includeCurrentYear: true,
                includeFutureCreditYears: true,
                recorder
            });
            
            await client.query('COMMIT');
            
            res.json({
                subscription: subscriptionResult.rows[0],
                summary: {
                    expected_amount: expectedAmount,
                    amount_paid: totalPaid,
                    credit_from_previous: creditOutcome.creditApplied,
                    total_applied: creditOutcome.totalApplied,
                    credit_balance_for_next_year: creditOutcome.creditBalance,
                    current_credit_balance: updatedTimeline.current_credit_balance,
                    projected_credit_balance: updatedTimeline.projected_credit_balance,
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
        const creditTimeline = await recalculateMemberCreditLedger(pool, memberId, {
            persistAutoYears: false,
            includeCurrentYear: true,
            includeFutureCreditYears: true
        });
        const summarySubscriptions = creditTimeline.subscriptions.sort((a, b) => b.subscription_year - a.subscription_year);
        const latestTimelineYear = summarySubscriptions.length > 0 ? summarySubscriptions[0].subscription_year : null;

        return res.json({
            member: creditTimeline.member,
            subscriptions: summarySubscriptions,
            current_credit_balance: creditTimeline.current_credit_balance,
            projected_credit_balance: creditTimeline.projected_credit_balance,
            credit_year: creditTimeline.current_credit_balance > 0 ? latestTimelineYear : null,
            max_rate_year: creditTimeline.max_rate_year
        });

        const currentYear = new Date().getFullYear();
        
        // Get member info (include membership_category for Corporate rate lookup)
        const memberResult = await pool.query(`
            SELECT id, member_type, membership_number, membership_category,
                   date_of_admission, registration_date, created_at,
                   EXTRACT(YEAR FROM COALESCE(date_of_admission, registration_date))::int as induction_year
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
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Database error' });
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
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::int
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
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::int
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
                            AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::int
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
                        AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::int
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
                AND s.subscription_year = EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::int
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

// Advanced: Members inducted in the current year
app.get('/api/dashboard/inducted-this-year', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const currentYear = parseInt(req.query.year, 10) || new Date().getFullYear();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 500);
        const params = [currentYear];

        let typeFilter = '';
        if (memberType) {
            params.push(memberType);
            typeFilter = ` AND m.member_type = $${params.length}`;
        }

        const membersQuery = `
            WITH inducted AS (
                SELECT
                    m.id,
                    m.membership_number,
                    m.member_type,
                    m.membership_category,
                    COALESCE(
                        NULLIF(TRIM(CONCAT_WS(' ', NULLIF(m.first_name, ''), COALESCE(NULLIF(m.surname, ''), NULLIF(m.last_name, '')), NULLIF(m.other_names, ''))), ''),
                        NULLIF(m.organization, ''),
                        'Unknown'
                    ) AS member_name,
                    m.organization,
                    m.region,
                    m.email,
                    COALESCE(m.date_of_admission, m.registration_date)::DATE AS induction_date
                FROM members m
                WHERE COALESCE(m.date_of_admission, m.registration_date) IS NOT NULL
                  AND EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::INT = $1
                  ${typeFilter}
            )
            SELECT
                i.*,
                TO_CHAR(i.induction_date, 'DD/MM/YYYY') AS induction_date_display,
                COALESCE(SUM(CASE WHEN s.status = 'Paid' THEN COALESCE(s.amount_paid, 0) ELSE 0 END), 0) AS next_year_credit_paid,
                MAX(CASE WHEN s.status = 'Paid' THEN TO_CHAR(s.payment_date, 'DD/MM/YYYY') END) AS last_payment_date,
                MAX(CASE WHEN s.status = 'Paid' THEN s.payment_method END) AS last_payment_method,
                COALESCE(
                    MAX(CASE WHEN s.status = 'Paid' THEN rau.username END),
                    MAX(CASE WHEN s.status = 'Paid' THEN s.recorded_by_admin_username END),
                    MAX(CASE WHEN s.status = 'Paid' THEN s.receipt_number END)
                ) AS recorded_by
            FROM inducted i
            LEFT JOIN subscriptions s ON s.member_id = i.id
                AND s.subscription_year = $1
            LEFT JOIN admin_users rau ON rau.id = s.recorded_by_admin_user_id
            GROUP BY
                i.id,
                i.membership_number,
                i.member_type,
                i.membership_category,
                i.member_name,
                i.organization,
                i.region,
                i.email,
                i.induction_date
            ORDER BY i.induction_date DESC NULLS LAST, i.membership_number
            LIMIT ${limit}
        `;

        const summaryQuery = `
            WITH inducted AS (
                SELECT
                    m.id,
                    m.member_type,
                    m.membership_category
                FROM members m
                WHERE COALESCE(m.date_of_admission, m.registration_date) IS NOT NULL
                  AND EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::INT = $1
                  ${typeFilter}
            ),
            member_credits AS (
                SELECT
                    i.id,
                    i.member_type,
                    i.membership_category,
                    COALESCE(SUM(CASE WHEN s.status = 'Paid' THEN COALESCE(s.amount_paid, 0) ELSE 0 END), 0) AS next_year_credit_paid
                FROM inducted i
                LEFT JOIN subscriptions s ON s.member_id = i.id
                    AND s.subscription_year = $1
                GROUP BY i.id, i.member_type, i.membership_category
            )
            SELECT
                COUNT(*) AS total_inducted,
                COUNT(*) FILTER (WHERE next_year_credit_paid > 0) AS members_with_next_year_credit,
                COALESCE(SUM(next_year_credit_paid), 0) AS next_year_credit_total
            FROM member_credits
        `;

        const byTypeQuery = `
            WITH inducted AS (
                SELECT
                    m.id,
                    m.member_type
                FROM members m
                WHERE COALESCE(m.date_of_admission, m.registration_date) IS NOT NULL
                  AND EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::INT = $1
                  ${typeFilter}
            ),
            member_credits AS (
                SELECT
                    i.id,
                    i.member_type,
                    COALESCE(SUM(CASE WHEN s.status = 'Paid' THEN COALESCE(s.amount_paid, 0) ELSE 0 END), 0) AS next_year_credit_paid
                FROM inducted i
                LEFT JOIN subscriptions s ON s.member_id = i.id
                    AND s.subscription_year = $1
                GROUP BY i.id, i.member_type
            )
            SELECT
                member_type,
                COUNT(*) AS total_inducted,
                COUNT(*) FILTER (WHERE next_year_credit_paid > 0) AS members_with_next_year_credit,
                COALESCE(SUM(next_year_credit_paid), 0) AS next_year_credit_total
            FROM member_credits
            GROUP BY member_type
            ORDER BY total_inducted DESC, member_type
        `;

        const [membersResult, summaryResult, byTypeResult] = await Promise.all([
            pool.query(membersQuery, params),
            pool.query(summaryQuery, params),
            pool.query(byTypeQuery, params)
        ]);

        const summary = summaryResult.rows[0] || {};
        res.json({
            current_year: currentYear,
            next_subscription_year: currentYear + 1,
            summary: {
                total_inducted: parseInt(summary.total_inducted || 0, 10),
                members_with_next_year_credit: parseInt(summary.members_with_next_year_credit || 0, 10),
                next_year_credit_total: parseFloat(summary.next_year_credit_total || 0)
            },
            by_type: byTypeResult.rows,
            members: membersResult.rows
        });
    } catch (err) {
        console.error('Error fetching inducted-this-year analytics:', err);
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

// Advanced: Members not in good standing for consecutive years through the current year
app.get('/api/dashboard/lapsed-good-standing', async (req, res) => {
    try {
        const memberType = req.query.memberType || null;
        const currentYear = parseInt(req.query.year, 10) || new Date().getFullYear();
        const minYears = Math.max(2, parseInt(req.query.minYears, 10) || 2);
        const band = String(req.query.band || 'all').toLowerCase();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 10000);
        const params = [];

        let membersQuery = `
            SELECT
                m.id,
                m.membership_number,
                m.member_type,
                m.membership_category,
                COALESCE(
                    NULLIF(TRIM(CONCAT_WS(' ', NULLIF(m.first_name, ''), COALESCE(NULLIF(m.surname, ''), NULLIF(m.last_name, '')), NULLIF(m.other_names, ''))), ''),
                    NULLIF(m.organization, ''),
                    'Unknown'
                ) AS member_name,
                m.organization,
                m.region,
                m.phone_number,
                m.email,
                COALESCE(m.date_of_admission, m.registration_date, m.created_at)::DATE AS membership_start_date,
                TO_CHAR(m.date_of_admission, 'DD/MM/YYYY') AS date_of_admission,
                TO_CHAR(m.registration_date, 'DD/MM/YYYY') AS registration_date,
                m.created_at,
                EXTRACT(YEAR FROM COALESCE(m.date_of_admission, m.registration_date))::INT AS induction_year,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) AS subscription_years,
                (
                    SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC)
                    FROM subscriptions
                    WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')
                ) AS paid_years
            FROM members m
            LEFT JOIN subscriptions s ON s.member_id = m.id
            WHERE m.member_type != 'Honorary'`;

        if (memberType) {
            params.push(memberType);
            membersQuery += ` AND m.member_type = $${params.length}`;
        }

        membersQuery += `
            GROUP BY
                m.id,
                m.membership_number,
                m.member_type,
                m.membership_category,
                m.first_name,
                m.surname,
                m.last_name,
                m.other_names,
                m.organization,
                m.region,
                m.phone_number,
                m.email,
                m.date_of_admission,
                m.registration_date,
                m.created_at
            ORDER BY m.member_type, m.membership_number
        `;

        const membersResult = await pool.query(membersQuery, params);
        const members = await computeCreditAwarePaidYears(membersResult.rows, pool);

        const ratesResult = await pool.query(`
            SELECT member_type, membership_category, subscription_year, expected_amount
            FROM subscription_rates
        `);
        const ratesByMemberType = {};
        for (const rate of ratesResult.rows) {
            const key = rate.member_type === 'Corporate' && rate.membership_category
                ? `${rate.member_type}:${rate.membership_category}`
                : rate.member_type;
            if (!ratesByMemberType[key]) ratesByMemberType[key] = {};
            ratesByMemberType[key][parseInt(rate.subscription_year, 10)] = parseFloat(rate.expected_amount || 0);
        }

        function getMembershipStartYear(value) {
            if (!value) return null;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date.getFullYear();
        }

        const lapsedMembers = [];
        for (const member of members) {
            const paidYears = new Set((Array.isArray(member.paid_years) ? member.paid_years : [])
                .map(year => parseInt(year, 10))
                .filter(Number.isFinite));
            const startYear = getMembershipStartYear(member.membership_start_date);
            const inductionYear = parseInt(member.induction_year, 10);

            let yearsNotInGoodStanding = 0;
            const missedYears = [];

            for (let year = currentYear; year >= 1900; year--) {
                if (startYear && year < startYear) break;
                if (Number.isFinite(inductionYear) && year === inductionYear) continue;
                if (paidYears.has(year)) break;
                yearsNotInGoodStanding += 1;
                missedYears.unshift(year);
            }

            if (yearsNotInGoodStanding < minYears) continue;
            if (band === '2' && yearsNotInGoodStanding !== 2) continue;
            if ((band === '3' || band === 'exact3' || band === '3exact') && yearsNotInGoodStanding !== 3) continue;
            if ((band === '3plus' || band === '3+') && yearsNotInGoodStanding < 3) continue;

            const rateKey = member.member_type === 'Corporate' && member.membership_category
                ? `${member.member_type}:${member.membership_category}`
                : member.member_type;
            const memberRates = ratesByMemberType[rateKey] || {};
            const estimatedOutstanding = missedYears.includes(currentYear) ? (memberRates[currentYear] || 0) : 0;
            const lastGoodStandingYear = Array.from(paidYears)
                .filter(year => year < currentYear)
                .sort((a, b) => b - a)[0] || null;

            lapsedMembers.push({
                member_id: member.id,
                membership_number: member.membership_number,
                member_type: member.member_type,
                membership_category: member.membership_category,
                member_name: member.member_name,
                organization: member.organization,
                region: member.region,
                phone_number: member.phone_number,
                email: member.email,
                date_of_admission: member.date_of_admission,
                last_good_standing_year: lastGoodStandingYear,
                years_not_in_good_standing: yearsNotInGoodStanding,
                missed_years: missedYears,
                lapsed_band: yearsNotInGoodStanding === 2
                    ? '2 years'
                    : yearsNotInGoodStanding === 3
                    ? '3 years'
                    : '3+ years',
                estimated_outstanding: estimatedOutstanding
            });
        }

        lapsedMembers.sort((a, b) =>
            b.years_not_in_good_standing - a.years_not_in_good_standing ||
            parseFloat(b.estimated_outstanding || 0) - parseFloat(a.estimated_outstanding || 0) ||
            String(a.membership_number || '').localeCompare(String(b.membership_number || ''))
        );

        const limitedMembers = lapsedMembers.slice(0, limit);
        const twoYearCount = lapsedMembers.filter(member => member.years_not_in_good_standing === 2).length;
        const exactThreeYearCount = lapsedMembers.filter(member => member.years_not_in_good_standing === 3).length;
        const threePlusCount = lapsedMembers.filter(member => member.years_not_in_good_standing >= 3).length;
        const totalOutstanding = lapsedMembers.reduce((sum, member) => sum + parseFloat(member.estimated_outstanding || 0), 0);
        const byType = lapsedMembers.reduce((acc, member) => {
            const key = member.member_type || 'Unknown';
            if (!acc[key]) {
                acc[key] = {
                    member_type: key,
                    total_count: 0,
                    two_year_count: 0,
                    exact_three_year_count: 0,
                    three_plus_count: 0,
                    estimated_outstanding: 0
                };
            }
            acc[key].total_count += 1;
            if (member.years_not_in_good_standing === 2) acc[key].two_year_count += 1;
            if (member.years_not_in_good_standing === 3) acc[key].exact_three_year_count += 1;
            if (member.years_not_in_good_standing >= 3) acc[key].three_plus_count += 1;
            acc[key].estimated_outstanding += parseFloat(member.estimated_outstanding || 0);
            return acc;
        }, {});

        res.json({
            current_year: currentYear,
            min_years: minYears,
            band,
            summary: {
                total_count: lapsedMembers.length,
                two_year_count: twoYearCount,
                exact_three_year_count: exactThreeYearCount,
                three_plus_count: threePlusCount,
                estimated_outstanding: totalOutstanding
            },
            by_type: Object.values(byType).sort((a, b) =>
                b.total_count - a.total_count ||
                String(a.member_type || '').localeCompare(String(b.member_type || ''))
            ),
            members: limitedMembers
        });
    } catch (err) {
        console.error('Error fetching lapsed good standing report:', err);
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
        const year = parseInt(req.params.year, 10);
        if (!Number.isFinite(year)) {
            return res.status(400).json({ error: 'Invalid year' });
        }
        const goodStandingMembers = await getGoodStandingMembersForYear(year, { includePaymentDetails: true });
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
// PAYMENT HISTORY ENDPOINTS
// ============================================================

// Record a new payment (adds to payments table and triggers subscription update)
app.post('/api/payments', async (req, res) => {
    const client = await pool.connect();
    try {
        const { member_id, payment_amount, payment_date, payment_method, receipt_number, notes, subscription_year } = req.body;
        const recorder = getSessionAdminRecorder(req);
        
        if (!member_id || !payment_amount || !payment_date) {
            return res.status(400).json({ error: 'member_id, payment_amount, and payment_date are required' });
        }

        const paymentAmount = moneyValue(payment_amount);
        if (paymentAmount <= 0) {
            return res.status(400).json({ error: 'payment_amount must be greater than zero' });
        }

        const memberId = parseInt(member_id, 10);
        const appliedYear = parseInt(subscription_year, 10) || resolvePaymentYear(payment_date);

        await client.query('BEGIN');

        const member = await getMemberLedgerContext(client, memberId);
        const expectedAmount = await getApplicableExpectedAmount(
            client,
            member.member_type,
            member.membership_category,
            appliedYear,
            payment_date
        );
        
        // Record the cash receipt, then apply it to the selected subscription year.
        const paymentResult = await client.query(`
            INSERT INTO payments (
                member_id, subscription_year, payment_amount, payment_date,
                payment_method, receipt_number, notes,
                recorded_by_admin_user_id, recorded_by_admin_username
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            memberId,
            appliedYear,
            paymentAmount,
            payment_date,
            payment_method || null,
            receipt_number || null,
            notes || null,
            recorder.adminUserId,
            recorder.adminUsername
        ]);

        await client.query(`
            INSERT INTO subscriptions (
                member_id, subscription_year, status, amount_paid,
                expected_amount, credit_applied, credit_balance,
                payment_method, receipt_number, payment_date,
                recorded_by_admin_user_id, recorded_by_admin_username
            )
            VALUES ($1, $2, 'Pending', $3, $4, 0, 0, $5, $6, $7, $8, $9)
            ON CONFLICT (member_id, subscription_year)
            DO UPDATE SET
                amount_paid = COALESCE(subscriptions.amount_paid, 0) + EXCLUDED.amount_paid,
                expected_amount = CASE
                    WHEN COALESCE(subscriptions.expected_amount, 0) > 0 THEN subscriptions.expected_amount
                    ELSE EXCLUDED.expected_amount
                END,
                payment_method = COALESCE(EXCLUDED.payment_method, subscriptions.payment_method),
                receipt_number = COALESCE(EXCLUDED.receipt_number, subscriptions.receipt_number),
                payment_date = COALESCE(EXCLUDED.payment_date, subscriptions.payment_date),
                recorded_by_admin_user_id = EXCLUDED.recorded_by_admin_user_id,
                recorded_by_admin_username = EXCLUDED.recorded_by_admin_username
        `, [
            memberId,
            appliedYear,
            paymentAmount,
            expectedAmount,
            payment_method || null,
            receipt_number || null,
            payment_date,
            recorder.adminUserId,
            recorder.adminUsername
        ]);

        const updatedTimeline = await recalculateMemberCreditLedger(client, memberId, {
            persistAutoYears: true,
            includeCurrentYear: true,
            includeFutureCreditYears: true,
            recorder
        });

        const appliedSubscription = updatedTimeline.subscriptions.find(sub => sub.subscription_year === appliedYear);

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Payment recorded successfully',
            payment: paymentResult.rows[0],
            applied_year: appliedYear,
            subscription: appliedSubscription || null,
            summary: {
                expected_amount: appliedSubscription ? appliedSubscription.expected_amount : expectedAmount,
                amount_paid: appliedSubscription ? appliedSubscription.amount_paid : paymentAmount,
                credit_applied: appliedSubscription ? appliedSubscription.credit_applied : 0,
                total_applied: appliedSubscription
                    ? Math.max(0, moneyValue(appliedSubscription.amount_paid) + moneyValue(appliedSubscription.credit_applied) - moneyValue(appliedSubscription.credit_balance))
                    : paymentAmount,
                credit_balance_for_next_year: appliedSubscription ? appliedSubscription.credit_balance : 0,
                current_credit_balance: updatedTimeline.current_credit_balance,
                projected_credit_balance: updatedTimeline.projected_credit_balance,
                status: appliedSubscription ? appliedSubscription.status : 'Pending'
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error recording payment:', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to record payment' });
    } finally {
        client.release();
    }
});

// Get payment history for a member
app.get('/api/payments/:memberId', async (req, res) => {
    try {
        const memberId = req.params.memberId;
        
        const payments = await pool.query(`
            SELECT
                p.*,
                COALESCE(au.username, p.recorded_by_admin_username) AS recorded_by
            FROM payments p
            LEFT JOIN admin_users au ON au.id = p.recorded_by_admin_user_id
            WHERE p.member_id = $1
            ORDER BY p.payment_date DESC, p.created_at DESC
        `, [memberId]);

        res.json(payments.rows);
    } catch (err) {
        console.error('Error fetching payments:', err);
        res.status(500).json({ error: 'Failed to fetch payment history' });
    }
});

// Get member's current balance across all years
app.get('/api/member-balance/:memberId', async (req, res) => {
    try {
        const memberId = req.params.memberId;
        const balanceTimeline = await recalculateMemberCreditLedger(pool, memberId, {
            persistAutoYears: false,
            includeCurrentYear: true,
            includeFutureCreditYears: true
        });
        const paymentsResult = await pool.query(`
            SELECT COALESCE(SUM(payment_amount), 0) as total_paid
            FROM payments
            WHERE member_id = $1
        `, [memberId]);

        return res.json({
            member_id: memberId,
            current_balance: balanceTimeline.current_credit_balance,
            projected_balance: balanceTimeline.projected_credit_balance,
            max_rate_year: balanceTimeline.max_rate_year,
            total_paid: moneyValue(paymentsResult.rows[0] && paymentsResult.rows[0].total_paid),
            subscriptions: balanceTimeline.subscriptions.sort((a, b) => b.subscription_year - a.subscription_year)
        });
        
        // Get member info
        const memberResult = await pool.query(
            'SELECT member_type, membership_category FROM members WHERE id = $1',
            [memberId]
        );
        
        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const member = memberResult.rows[0];

        // Get all subscriptions with calculated balances
        const subs = await pool.query(`
            SELECT 
                s.subscription_year,
                s.amount_paid,
                COALESCE(NULLIF(s.expected_amount, 0), sr.expected_amount, 0) as expected_amount,
                s.credit_applied,
                s.credit_balance,
                s.status
            FROM subscriptions s
            LEFT JOIN subscription_rates sr ON sr.member_type = $2 
                AND sr.subscription_year = s.subscription_year
                AND (
                    ($2 != 'Corporate' AND sr.membership_category IS NULL)
                    OR ($2 = 'Corporate' AND sr.membership_category = $3)
                )
            WHERE s.member_id = $1
            ORDER BY s.subscription_year DESC
        `, [memberId, member.member_type, member.membership_category]);

        // Calculate total balance available for future years
        let totalBalance = 0;
        subs.rows.forEach(sub => {
            totalBalance += (parseFloat(sub.credit_balance) || 0);
        });

        res.json({
            member_id: memberId,
            current_balance: totalBalance,
            subscriptions: subs.rows
        });
    } catch (err) {
        console.error('Error fetching member balance:', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to fetch member balance' });
    }
});

// Get subscription details with balance information for a specific year
app.get('/api/subscription-with-balance/:memberId/:year', async (req, res) => {
    try {
        const { memberId, year } = req.params;
        const yearInt = parseInt(year, 10);
        const detailTimeline = await recalculateMemberCreditLedger(pool, memberId, {
            persistAutoYears: false,
            includeCurrentYear: true,
            includeFutureCreditYears: true
        });
        const timelineSubscription = detailTimeline.subscriptions.find(sub => sub.subscription_year === yearInt);

        if (!timelineSubscription) {
            return res.json({
                member_id: memberId,
                subscription_year: yearInt,
                message: 'No subscription found for this year',
                amount_paid: 0,
                expected_amount: 0,
                credit_applied: 0,
                credit_balance: 0,
                total_paid: 0,
                total_with_credit: 0,
                balance_needed: 0,
                status: 'Pending',
                is_good_standing: false
            });
        }

        const timelinePaid = moneyValue(timelineSubscription.amount_paid);
        const timelineCredit = moneyValue(timelineSubscription.credit_applied);
        const timelineExpected = moneyValue(timelineSubscription.expected_amount || timelineSubscription.rate_expected_amount);

        return res.json({
            ...timelineSubscription,
            total_paid_from_subscription_table: timelinePaid,
            total_paid_from_payments_table: null,
            total_paid: timelinePaid,
            expected_amount: timelineExpected,
            credit_applied: timelineCredit,
            total_with_credit: timelinePaid + timelineCredit,
            balance_needed: moneyValue(timelineSubscription.balance_due),
            is_good_standing: timelineSubscription.status === 'Paid' || timelineSubscription.status === 'Waived'
        });
        
        const memberResult = await pool.query(
            'SELECT member_type, membership_category FROM members WHERE id = $1',
            [memberId]
        );
        
        if (memberResult.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        const member = memberResult.rows[0];

        // Get subscription details with expected amount from rates
        const sub = await pool.query(`
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
            WHERE s.member_id = $1 AND s.subscription_year = $4
        `, [memberId, member.member_type, member.membership_category, year]);

        if (sub.rows.length === 0) {
            return res.json({
                member_id: memberId,
                subscription_year: year,
                message: 'No subscription found for this year',
                amount_paid: 0,
                expected_amount: 0,
                credit_applied: 0,
                credit_balance: 0,
                status: 'Pending'
            });
        }

        const subscription = sub.rows[0];
        
        // Get total paid including any payments recorded in payments table for this year
        const paymentsForYear = await pool.query(`
            SELECT COALESCE(SUM(payment_amount), 0) as total_payments
            FROM payments
            WHERE member_id = $1 AND EXTRACT(YEAR FROM payment_date) = $2
        `, [memberId, year]);

        const totalPaid = parseFloat(subscription.amount_paid || 0) + parseFloat(paymentsForYear.rows[0].total_payments || 0);
        const expectedAmount = parseFloat(subscription.rate_expected_amount || subscription.expected_amount || 0);
        const creditApplied = parseFloat(subscription.credit_applied || 0);
        const totalWithCredit = totalPaid + creditApplied;

        res.json({
            ...subscription,
            total_paid_from_subscription_table: parseFloat(subscription.amount_paid || 0),
            total_paid_from_payments_table: parseFloat(paymentsForYear.rows[0].total_payments || 0),
            total_paid: totalPaid,
            expected_amount: expectedAmount,
            credit_applied: creditApplied,
            total_with_credit: totalWithCredit,
            balance_needed: Math.max(0, expectedAmount - totalWithCredit),
            is_good_standing: totalWithCredit >= expectedAmount || subscription.status === 'Waived'
        });
    } catch (err) {
        console.error('Error fetching subscription with balance:', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to fetch subscription details' });
    }
});

// ============================================================
// SERVER SETUP
// ============================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
