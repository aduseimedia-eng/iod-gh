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

async function setup() {
    try {
        // Create table
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
        console.log('admin_users table created');

        // Check if any admin exists
        const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM admin_users');
        if (parseInt(rows[0].cnt) === 0) {
            const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || 'admin').trim();
            const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123!';
            const hash = await bcrypt.hash(defaultPassword, 10);
            await pool.query(
                'INSERT INTO admin_users (username, password_hash, email) VALUES ($1, $2, $3)',
                [defaultUsername, hash, process.env.ADMIN_DEFAULT_EMAIL || 'admin@iodghana.org']
            );
            console.log('Default admin inserted. Please change the password immediately.');
        } else {
            console.log('Admin user already exists, skipping insert');
        }

        // Show result
        const result = await pool.query('SELECT id, username, email, created_at FROM admin_users');
        console.log('Admin users:', result.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

setup();
