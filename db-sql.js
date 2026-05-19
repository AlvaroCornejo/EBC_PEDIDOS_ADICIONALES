const sql = require('mssql');

const config = {
  server: process.env.SQL_SERVER || '192.168.1.2',
  database: process.env.SQL_DATABASE || 'PedidosApp',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  port: parseInt(process.env.SQL_PORT || '1433'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

const connectSQL = async () => {
  try {
    pool = await sql.connect(config);
    console.log('SQL Server conectado');
    return pool;
  } catch (err) {
    console.error('Error conectando a SQL Server:', err.message);
    process.exit(1);
  }
};

const getPool = () => pool;

module.exports = { connectSQL, getPool, sql };
