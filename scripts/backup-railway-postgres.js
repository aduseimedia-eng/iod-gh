const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
require('dotenv').config();

const args = new Set(process.argv.slice(2));
const syncRailwayToLocal = args.has('--sync-local') || args.has('--sync-railway-to-local');
const syncLocalToRailway = args.has('--sync-local-to-railway');
const syncTwoWay = args.has('--sync-two-way') || args.has('--sync-bidirectional');
const includeAdmin = args.has('--include-admin');

if ([syncRailwayToLocal, syncLocalToRailway, syncTwoWay].filter(Boolean).length > 1) {
    console.error('Choose only one sync direction.');
    process.exit(1);
}

function quoteIdent(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function createLocalPool() {
    return new Pool({
        user: process.env.DB_USER || process.env.PGUSER || 'postgres',
        host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
        database: process.env.DB_NAME || process.env.PGDATABASE || 'iod_ghana',
        password: (process.env.DB_PASSWORD || process.env.PGPASSWORD || '').replace(/['"]/g, ''),
        port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
}

function readRailwayTokenFromConfig() {
    const configPath = path.join(os.homedir(), '.railway', 'config.json');
    if (!fs.existsSync(configPath)) return null;

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config && config.user && config.user.token ? config.user.token : null;
    } catch {
        return null;
    }
}

function getRailwayDatabaseUrl() {
    if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;
    if (process.env.RAILWAY_DATABASE_PUBLIC_URL) return process.env.RAILWAY_DATABASE_PUBLIC_URL;

    const railwayCommand = process.platform === 'win32' ? 'cmd.exe' : 'railway';
    const railwayArgs = process.platform === 'win32'
        ? ['/c', 'railway.cmd', 'variable', 'list', '--service', 'Postgres', '--json']
        : ['variable', 'list', '--service', 'Postgres', '--json'];
    const env = { ...process.env };
    if (!env.RAILWAY_API_TOKEN) {
        const token = readRailwayTokenFromConfig();
        if (token) env.RAILWAY_API_TOKEN = token;
    }

    try {
        const output = execFileSync(
            railwayCommand,
            railwayArgs,
            { encoding: 'utf8', env }
        );
        const variables = JSON.parse(output);
        if (variables.DATABASE_PUBLIC_URL) return variables.DATABASE_PUBLIC_URL;
        if (variables.DATABASE_URL) return variables.DATABASE_URL;
    } catch (err) {
        throw new Error(
            'Could not read Railway Postgres variables. Run `railway.cmd login`, or set DATABASE_PUBLIC_URL before running this script.'
        );
    }

    throw new Error('Railway Postgres DATABASE_PUBLIC_URL was not found.');
}

function createRailwayPool(databaseUrl) {
    return new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
    });
}

async function getPublicTables(pool) {
    const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);
    return result.rows.map(row => row.table_name);
}

async function getColumns(pool, tableName) {
    const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position
    `, [tableName]);
    return result.rows.map(row => row.column_name);
}

async function ensureAdminSchema(pool) {
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
}

async function readTable(pool, tableName) {
    const columns = await getColumns(pool, tableName);
    const hasId = columns.includes('id');
    const orderBy = hasId ? ' ORDER BY "id"' : '';
    const result = await pool.query(`SELECT * FROM ${quoteIdent(tableName)}${orderBy}`);
    return { columns, rows: result.rows };
}

async function createBackup(pool, label) {
    const tables = await getPublicTables(pool);
    const backup = {
        createdAt: new Date().toISOString(),
        source: label,
        tables: {}
    };

    for (const table of tables) {
        backup.tables[table] = await readTable(pool, table);
    }

    const backupDir = path.join(process.cwd(), 'backups', 'railway');
    fs.mkdirSync(backupDir, { recursive: true });
    const filePath = path.join(backupDir, `${label}-backup-${timestamp()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
    return { backup, filePath };
}

function buildUpsertSql(tableName, columns, conflictTarget, updateColumns) {
    const columnSql = columns.map(quoteIdent).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updateSql = updateColumns.length > 0
        ? `DO UPDATE SET ${updateColumns.map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
        : 'DO NOTHING';

    return `
        INSERT INTO ${quoteIdent(tableName)} (${columnSql})
        VALUES (${placeholders})
        ON CONFLICT ${conflictTarget}
        ${updateSql}
    `;
}

async function upsertRows(pool, tableName, rows, columns, conflictTarget, conflictColumns) {
    if (!rows || rows.length === 0 || columns.length === 0) return 0;

    const updateColumns = columns.filter(column => !conflictColumns.includes(column));
    const updateSql = updateColumns.length > 0
        ? `DO UPDATE SET ${updateColumns.map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
        : 'DO NOTHING';
    const columnSql = columns.map(quoteIdent).join(', ');
    const batchSize = Math.max(1, Math.floor(30000 / columns.length));
    let synced = 0;

    for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        const values = [];
        const rowPlaceholders = batch.map(row => {
            const placeholders = columns.map(column => {
                values.push(row[column]);
                return `$${values.length}`;
            });
            return `(${placeholders.join(', ')})`;
        });

        const sql = `
            INSERT INTO ${quoteIdent(tableName)} (${columnSql})
            VALUES ${rowPlaceholders.join(', ')}
            ON CONFLICT ${conflictTarget}
            ${updateSql}
        `;

        await pool.query(sql, values);
        synced += batch.length;
    }

    return synced;
}

async function resetSerialSequence(pool, tableName, idColumn = 'id') {
    await pool.query(`
        SELECT setval(
            pg_get_serial_sequence($1, $2),
            COALESCE((SELECT MAX(${quoteIdent(idColumn)}) FROM ${quoteIdent(tableName)}), 1),
            true
        )
    `, [tableName, idColumn]);
}

function buildSourceMemberNumberById(backup) {
    const members = backup.tables.members;
    if (!members) return new Map();
    return new Map(members.rows.map(member => [member.id, member.membership_number]));
}

async function buildTargetMemberIdByNumber(targetPool, backup) {
    const members = backup.tables.members;
    if (!members || members.rows.length === 0) return new Map();

    const memberNumbers = [...new Set(members.rows.map(member => member.membership_number).filter(Boolean))];
    if (memberNumbers.length === 0) return new Map();

    const result = await targetPool.query(
        'SELECT id, membership_number FROM members WHERE membership_number = ANY($1)',
        [memberNumbers]
    );
    return new Map(result.rows.map(member => [member.membership_number, member.id]));
}

function buildSourceAdminUsernameById(backup) {
    const adminUsers = backup.tables.admin_users;
    if (!adminUsers) return new Map();
    return new Map(adminUsers.rows.map(admin => [admin.id, admin.username]));
}

async function buildTargetAdminIdByUsername(targetPool, rows, sourceAdminUsernameById) {
    const usernames = new Set();
    for (const row of rows || []) {
        if (row.recorded_by_admin_username) {
            usernames.add(row.recorded_by_admin_username);
        }
        const usernameFromId = sourceAdminUsernameById.get(row.recorded_by_admin_user_id);
        if (usernameFromId) {
            usernames.add(usernameFromId);
        }
    }

    if (usernames.size === 0) return new Map();

    try {
        const result = await targetPool.query(
            'SELECT id, username FROM admin_users WHERE username = ANY($1)',
            [[...usernames]]
        );
        return new Map(result.rows.map(admin => [admin.username, admin.id]));
    } catch {
        return new Map();
    }
}

function mapRecordedByAdmin(row, columns, sourceAdminUsernameById, targetAdminIdByUsername) {
    if (!columns.includes('recorded_by_admin_user_id') && !columns.includes('recorded_by_admin_username')) {
        return row;
    }

    const sourceUsername = row.recorded_by_admin_username
        || sourceAdminUsernameById.get(row.recorded_by_admin_user_id)
        || null;

    if (columns.includes('recorded_by_admin_username') && !row.recorded_by_admin_username) {
        row.recorded_by_admin_username = sourceUsername;
    }

    if (columns.includes('recorded_by_admin_user_id')) {
        row.recorded_by_admin_user_id = sourceUsername
            ? (targetAdminIdByUsername.get(sourceUsername) || null)
            : null;
    }

    return row;
}

async function syncSubscriptionRates(localPool, backup) {
    const table = backup.tables.subscription_rates;
    if (!table) return 0;

    const localColumns = await getColumns(localPool, 'subscription_rates');
    const columns = table.columns
        .filter(column => column !== 'id' && localColumns.includes(column));

    return upsertRows(
        localPool,
        'subscription_rates',
        table.rows,
        columns,
        "(member_type, subscription_year, COALESCE(membership_category, ''))",
        ['member_type', 'subscription_year', 'membership_category']
    );
}

async function syncMembers(localPool, backup) {
    const table = backup.tables.members;
    if (!table) return 0;

    const localColumns = await getColumns(localPool, 'members');
    const columns = table.columns
        .filter(column => column !== 'id' && localColumns.includes(column));

    return upsertRows(
        localPool,
        'members',
        table.rows,
        columns,
        '(membership_number)',
        ['membership_number']
    );
}

async function syncSubscriptions(localPool, backup) {
    const subscriptions = backup.tables.subscriptions;
    const members = backup.tables.members;
    if (!subscriptions || !members || subscriptions.rows.length === 0) return 0;

    const railwayMemberNumberById = buildSourceMemberNumberById(backup);
    const localMemberIdByNumber = await buildTargetMemberIdByNumber(localPool, backup);
    const sourceAdminUsernameById = buildSourceAdminUsernameById(backup);
    const targetAdminIdByUsername = await buildTargetAdminIdByUsername(
        localPool,
        subscriptions.rows,
        sourceAdminUsernameById
    );
    const localColumns = await getColumns(localPool, 'subscriptions');
    const dataColumns = subscriptions.columns
        .filter(column => column !== 'id' && column !== 'member_id' && localColumns.includes(column));
    const columns = ['member_id', ...dataColumns];
    const preparedRows = [];
    for (const subscription of subscriptions.rows) {
        const memberNumber = railwayMemberNumberById.get(subscription.member_id);
        const localMemberId = localMemberIdByNumber.get(memberNumber);
        if (!localMemberId) continue;

        preparedRows.push(mapRecordedByAdmin(
            { ...subscription, member_id: localMemberId },
            columns,
            sourceAdminUsernameById,
            targetAdminIdByUsername
        ));
    }

    return upsertRows(
        localPool,
        'subscriptions',
        preparedRows,
        columns,
        '(member_id, subscription_year)',
        ['member_id', 'subscription_year']
    );
}

async function syncPayments(localPool, backup) {
    const payments = backup.tables.payments;
    const members = backup.tables.members;
    if (!payments || !members || payments.rows.length === 0) return 0;

    const sourceMemberNumberById = buildSourceMemberNumberById(backup);
    const localMemberIdByNumber = await buildTargetMemberIdByNumber(localPool, backup);
    const sourceAdminUsernameById = buildSourceAdminUsernameById(backup);
    const targetAdminIdByUsername = await buildTargetAdminIdByUsername(
        localPool,
        payments.rows,
        sourceAdminUsernameById
    );
    const localColumns = await getColumns(localPool, 'payments');
    const columns = payments.columns.filter(column => localColumns.includes(column));

    if (!columns.includes('id') || !columns.includes('member_id')) return 0;

    const preparedRows = [];
    for (const payment of payments.rows) {
        const memberNumber = sourceMemberNumberById.get(payment.member_id);
        const localMemberId = localMemberIdByNumber.get(memberNumber);
        if (!localMemberId) continue;

        preparedRows.push(mapRecordedByAdmin(
            { ...payment, member_id: localMemberId },
            columns,
            sourceAdminUsernameById,
            targetAdminIdByUsername
        ));
    }

    const synced = await upsertRows(
        localPool,
        'payments',
        preparedRows,
        columns,
        '(id)',
        ['id']
    );

    if (synced > 0) {
        await resetSerialSequence(localPool, 'payments');
    }

    return synced;
}

async function syncAdminUsers(localPool, backup) {
    if (!includeAdmin || !backup.tables.admin_users) return 0;

    const table = backup.tables.admin_users;
    const localColumns = await getColumns(localPool, 'admin_users');
    const columns = table.columns
        .filter(column => column !== 'id' && column !== 'created_by_admin_id' && localColumns.includes(column));

    return upsertRows(
        localPool,
        'admin_users',
        table.rows,
        columns,
        '(username)',
        ['username']
    );
}

async function syncAdminActivityLogs(localPool, backup) {
    if (!includeAdmin || !backup.tables.admin_activity_logs) return 0;

    const table = backup.tables.admin_activity_logs;
    const localColumns = await getColumns(localPool, 'admin_activity_logs');
    const columns = table.columns
        .filter(column => column !== 'admin_user_id' && localColumns.includes(column));

    const synced = await upsertRows(
        localPool,
        'admin_activity_logs',
        table.rows,
        columns,
        '(id)',
        ['id']
    );

    if (synced > 0 && columns.includes('id')) {
        await resetSerialSequence(localPool, 'admin_activity_logs');
    }

    return synced;
}

async function syncBackupToDatabase(targetPool, backup) {
    if (includeAdmin) {
        await ensureAdminSchema(targetPool);
    }

    return {
        subscription_rates: await syncSubscriptionRates(targetPool, backup),
        members: await syncMembers(targetPool, backup),
        subscriptions: await syncSubscriptions(targetPool, backup),
        payments: await syncPayments(targetPool, backup),
        admin_users: await syncAdminUsers(targetPool, backup),
        admin_activity_logs: await syncAdminActivityLogs(targetPool, backup)
    };
}

async function main() {
    const railwayDatabaseUrl = getRailwayDatabaseUrl();
    const railwayPool = createRailwayPool(railwayDatabaseUrl);
    let localPool;

    try {
        if (includeAdmin) {
            await ensureAdminSchema(railwayPool);
        }

        if (syncTwoWay) {
            localPool = createLocalPool();
            if (includeAdmin) {
                await ensureAdminSchema(localPool);
            }

            const railwaySnapshot = await createBackup(railwayPool, 'railway-before-two-way-sync');
            console.log(`Railway pre-sync backup written: ${railwaySnapshot.filePath}`);

            const localSnapshot = await createBackup(localPool, 'local-before-two-way-sync');
            console.log(`Local pre-sync backup written: ${localSnapshot.filePath}`);

            const railwayToLocal = await syncBackupToDatabase(localPool, railwaySnapshot.backup);
            console.log('Step 1 synced Railway data into local Postgres:');
            console.log(JSON.stringify(railwayToLocal, null, 2));

            const mergedLocal = await createBackup(localPool, 'local-merged-for-railway');
            console.log(`Merged local backup written: ${mergedLocal.filePath}`);

            const localToRailway = await syncBackupToDatabase(railwayPool, mergedLocal.backup);
            console.log('Step 2 synced merged local data into Railway Postgres:');
            console.log(JSON.stringify(localToRailway, null, 2));
            return;
        }

        if (syncLocalToRailway) {
            localPool = createLocalPool();
            if (includeAdmin) {
                await ensureAdminSchema(localPool);
            }
            const source = await createBackup(localPool, 'local');
            console.log(`Local backup written: ${source.filePath}`);

            const railwaySnapshot = await createBackup(railwayPool, 'railway-before-sync');
            console.log(`Railway pre-sync backup written: ${railwaySnapshot.filePath}`);

            const synced = await syncBackupToDatabase(railwayPool, source.backup);
            console.log('Synced local Postgres data into Railway Postgres:');
            console.log(JSON.stringify(synced, null, 2));
            return;
        }

        const { backup, filePath } = await createBackup(railwayPool, 'railway');
        console.log(`Railway backup written: ${filePath}`);

        if (syncRailwayToLocal) {
            localPool = createLocalPool();
            if (includeAdmin) {
                await ensureAdminSchema(localPool);
            }
            const localSnapshot = await createBackup(localPool, 'local-before-sync');
            console.log(`Local pre-sync backup written: ${localSnapshot.filePath}`);

            const synced = await syncBackupToDatabase(localPool, backup);
            console.log('Synced Railway data into local Postgres:');
            console.log(JSON.stringify(synced, null, 2));
        } else {
            console.log('Backup only. Run `npm.cmd run sync:local-to-railway` to merge local Postgres data into Railway.');
        }
    } finally {
        await railwayPool.end();
        if (localPool) await localPool.end();
    }
}

main().catch(err => {
    console.error('Backup/sync failed:');
    console.error(err.message);
    process.exit(1);
});
