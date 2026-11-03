import mysql from 'mysql2/promise';
import fs from 'node:fs';
export function createPool() {
  const pool=mysql.createPool({
    host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),
    user:process.env.DB_USER || 'sfc_cmr_app',password:process.env.DB_PASSWORD || '',
    database:process.env.DB_NAME || 'sfc_cmr',connectionLimit:Number(process.env.DB_POOL_LIMIT || 5),
    timezone:'Z',decimalNumbers:true,dateStrings:true,
    ...(process.env.DB_SSL_CA_FILE ? {ssl:{ca:fs.readFileSync(process.env.DB_SSL_CA_FILE),rejectUnauthorized:true}} : {})
  });
  pool.on('connection',connection=>connection.query("SET time_zone='+00:00'"));
  return pool;
}
export async function transaction(pool,work) {
  const connection=await pool.getConnection();
  try {
    await connection.query("SET time_zone='+00:00'");
    // Read the latest committed outbox state after taking the shipment lock.
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const result=await work(connection);
    await connection.commit();
    return result;
  } catch(error) {await connection.rollback();throw error;}
  finally {connection.release();}
}
export const sqlDate = value => new Date(value).toISOString().slice(0,19).replace('T',' ');
export const epoch = value => value == null ? null : typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ','T')+'Z');
