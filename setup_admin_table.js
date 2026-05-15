const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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
const ADMIN_ROLE_SUPERADMIN = 'superadmin';

async function setup() {
    try {
        // Create table
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
        console.log('admin_users table created');

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
        console.log('admin_activity_logs table created');

        // Check if any admin exists
        const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM admin_users');
        if (parseInt(rows[0].cnt) === 0) {
            const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim();
            const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123!';
            const hash = await bcrypt.hash(defaultPassword, 10);
            await pool.query(
                'INSERT INTO admin_users (username, password_hash, email, role, is_active) VALUES ($1, $2, $3, $4, TRUE)',
                [defaultUsername, hash, process.env.ADMIN_DEFAULT_EMAIL || 'admin@iodghana.org', ADMIN_ROLE_SUPERADMIN]
            );
            console.log('Default SuperAdmin inserted. Please change the password immediately.');
        } else {
            console.log('Admin user already exists, skipping insert');
        }

        const superAdminCount = await pool.query('SELECT COUNT(*) FROM admin_users WHERE role = $1', [ADMIN_ROLE_SUPERADMIN]);
        if (parseInt(superAdminCount.rows[0].count, 10) === 0) {
            const firstAdmin = await pool.query('SELECT id, username FROM admin_users ORDER BY id ASC LIMIT 1');
            if (firstAdmin.rows.length > 0) {
                await pool.query('UPDATE admin_users SET role = $1, is_active = TRUE, updated_at = NOW() WHERE id = $2', [ADMIN_ROLE_SUPERADMIN, firstAdmin.rows[0].id]);
                console.log(`Existing admin user "${firstAdmin.rows[0].username}" promoted to SuperAdmin`);
            }
        }

        // Show result
        const result = await pool.query('SELECT id, username, email, role, is_active, created_at FROM admin_users');
        console.log('Admin users:', result.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

setup();
