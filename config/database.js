const sql = require('mssql');

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let poolPromise;

const connectDB = async () => {
    try {
        if (!poolPromise) {
            poolPromise = sql.connect(config);
        }

        const pool = await poolPromise;
        console.log('✅ Connected to SQL Server successfully');
        return pool;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        throw error;
    }
};

const getPool = () => {
    if (!poolPromise) {
        throw new Error('Database not initialized. Call connectDB first.');
    }
    return poolPromise;
};

const closeDB = async () => {
    try {
        if (poolPromise) {
            await (await poolPromise).close();
            poolPromise = null;
            console.log('✅ Database connection closed');
        }
    } catch (error) {
        console.error('❌ Error closing database connection:', error.message);
        throw error;
    }
};

module.exports = {
    sql,
    connectDB,
    getPool,
    closeDB,
    config
};