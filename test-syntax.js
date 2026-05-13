// Test syntax of server.js
try {
    require('./server.js');
    console.log('server.js syntax is OK');
} catch (err) {
    console.error('SYNTAX ERROR in server.js:');
    console.error(err.message);
    if (err.stack) {
        console.error(err.stack);
    }
}
