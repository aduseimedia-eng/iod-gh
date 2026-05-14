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

async function updatePassword() {
    try {
        const username = process.env.ADMIN_USERNAME || process.env.ADMIN_DEFAULT_USERNAME || 'admin';
        const password = process.env.ADMIN_NEW_PASSWORD || process.argv[2];

        if (!password || password.length < 8) {
            throw new Error('Provide a new password with ADMIN_NEW_PASSWORD or as the first command argument.');
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'UPDATE admin_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2 RETURNING id, username, email, updated_at',
            [hash, username]
        );

        if (result.rows.length === 0) {
            console.log('Admin user not found');
            return;
        }

        console.log('Password updated successfully');
        console.log('Admin user:', result.rows[0]);
    } catch (err) {
        console.error('Error updating password:', err.message || err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

updatePassword();
