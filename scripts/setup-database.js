const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const schemaPath = path.join(__dirname, '..', 'database_schema_new.sql');
const includeSampleData = process.argv.includes('--with-sample-data');

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

function loadSchemaSql() {
    const sql = fs.readFileSync(schemaPath, 'utf8');

    if (includeSampleData) {
        return sql;
    }

    const sampleDataMarker = '-- SAMPLE DATA';
    const sampleDataIndex = sql.indexOf(sampleDataMarker);
    return sampleDataIndex === -1 ? sql : sql.slice(0, sampleDataIndex);
}

async function main() {
    const pool = new Pool(createDatabasePoolConfig());

    try {
        const existing = await pool.query(`
            SELECT
                to_regclass('public.members') AS members_table,
                to_regclass('public.subscriptions') AS subscriptions_table
        `);

        const hasMembersTable = Boolean(existing.rows[0].members_table);
        const hasSubscriptionsTable = Boolean(existing.rows[0].subscriptions_table);
        const hasCoreTables = hasMembersTable && hasSubscriptionsTable;
        if (hasCoreTables) {
            console.log('Core database tables already exist; skipping schema setup.');
            console.log('Use server startup for admin_users and subscription_rates maintenance.');
            return;
        }

        if (hasMembersTable || hasSubscriptionsTable) {
            console.error('Partial database schema detected.');
            console.error('Expected both members and subscriptions tables, or neither of them.');
            process.exitCode = 1;
            return;
        }

        await pool.query(loadSchemaSql());
        console.log(includeSampleData
            ? 'Database schema and sample data created successfully.'
            : 'Database schema created successfully.');
    } catch (err) {
        console.error('Database setup failed:');
        console.error(err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
