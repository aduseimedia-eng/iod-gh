const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'iod_ghana',
    password: '',
    port: 5432,
});

async function clearMembers() {
    try {
        const result = await pool.query('TRUNCATE TABLE members RESTART IDENTITY CASCADE');
        console.log('All members deleted. Table structure preserved.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

clearMembers();
