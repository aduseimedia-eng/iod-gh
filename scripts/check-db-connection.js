const { Pool } = require('pg');
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

function describeTarget() {
    if (process.env.DATABASE_URL) {
        try {
            const url = new URL(process.env.DATABASE_URL);
            return `${url.hostname}:${url.port || 5432}/${url.pathname.replace(/^\//, '')}`;
        } catch {
            return 'DATABASE_URL';
        }
    }

    const host = process.env.DB_HOST || process.env.PGHOST || 'localhost';
    const port = process.env.DB_PORT || process.env.PGPORT || '5432';
    const database = process.env.DB_NAME || process.env.PGDATABASE || 'iod_ghana';
    return `${host}:${port}/${database}`;
}

async function main() {
    const pool = new Pool(createDatabasePoolConfig());

    try {
        const result = await pool.query('SELECT NOW() AS now');
        console.log(`Database connection OK: ${describeTarget()}`);
        console.log(`Server time: ${result.rows[0].now.toISOString()}`);
    } catch (err) {
        console.error(`Database connection failed: ${describeTarget()}`);
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
