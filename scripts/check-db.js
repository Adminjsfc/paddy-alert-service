import {createPool} from '../src/config/database.js';
import {createRedis} from '../src/config/redis.js';
const pool=createPool();
const redis=createRedis();
try {
  for(const table of ['gps_alert_master','tbl_vehicle_alerts_details','tbl_vehicle_alert_event','gps_alert_outbox','shipment_routes'])await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
  await pool.query('SELECT shipment_id FROM gps_alert_outbox LIMIT 1');
  const [rows]=await pool.query("SELECT COUNT(*) total,SUM(status=1) enabled FROM gps_alert_master");
  const [excluded]=await pool.query("SELECT alert_short_name,status FROM gps_alert_master WHERE alert_short_name IN ('GF','DIST_DEV','WE','DA')");
  if(excluded.some(row=>Number(row.status)!==0))throw new Error('Run npm run db:setup to disable GF/DIST_DEV/WE/DA master records');
  await redis.connect();await redis.ping();
  console.log(JSON.stringify({database:'ready',redis:'ready',alert_types:rows[0].total,enabled_types:Number(rows[0].enabled),excluded:excluded.map(row=>row.alert_short_name),mqtt_configured:Boolean(process.env.MQTT_URL)}));
} finally {redis.disconnect();await pool.end();}
