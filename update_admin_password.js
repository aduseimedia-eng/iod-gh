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
        const password = 'Iodghana@123';
        const hash = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'UPDATE admin_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2 RETURNING *',
            [hash, 'admin']
        );

        if (result.rows.length > 0) {
            console.log('✅ Password updated successfully');
            console.log('Admin user:', {
                id: result.rows[0].id,
                username: result.rows[0].username,
                email: result.rows[0].email,
                updated_at: result.rows[0].updated_at
            });
            console.log('\nYou can now login with:');
            console.log('Username: admin');
            console.log('Password: Iodghana@123');
        } else {
            console.log('❌ Admin user not found');
        }
    } catch (err) {
        console.error('Error updating password:', err);
    } finally {
        await pool.end();
    }
}

updatePassword();
