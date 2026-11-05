import mysql from 'mysql2/promise';
import fs from 'node:fs';
let core;
export function coreDatabase(){
  if(!core){
    for(const key of ['CORE_DB_HOST','CORE_DB_USER','CORE_DB_NAME'])if(!process.env[key])throw new Error(`Configure ${key} for notification recipients`);
    core=mysql.createPool({host:process.env.CORE_DB_HOST,port:Number(process.env.CORE_DB_PORT||3306),
      user:process.env.CORE_DB_USER,password:process.env.CORE_DB_PASSWORD||'',database:process.env.CORE_DB_NAME,
      connectionLimit:3,connectTimeout:5000,
      ...(process.env.CORE_DB_SSL_CA_FILE?{ssl:{ca:fs.readFileSync(process.env.CORE_DB_SSL_CA_FILE),rejectUnauthorized:true}}:{})});
  }
  return core;
}
export async function closeCoreDatabase(){if(core){await core.end();core=undefined;}}
