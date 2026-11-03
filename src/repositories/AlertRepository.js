import {sqlDate} from '../config/database.js';
import {alertMetrics} from '../helpers/alert-metrics.js';
import {isExcludedAlertId} from '../config/alerts.js';
import * as outbox from './AlertOutboxRepository.js';
export async function settings(connection) {
  const [rows]=await connection.query(`SELECT id,alert_name,alert_short_name,alert_time,
    alert_reminder_time,threshold_value,status AS active FROM gps_alert_master ORDER BY id`);return rows;
}
export async function insertDetails(connection,shipment,input) {
  const alerts=input.filter(alert=>!isExcludedAlertId(alert.alert_id));
  if(!alerts.length)return;
  const records=alerts.map(alert=>{
    const metrics=alertMetrics(alert);
    return {
      shipment_id:shipment.id,vehicle_no:shipment.vehicle_no,alert_id:alert.alert_id,speed:alert.speed??null,
      geofence:alert.geofence??null,off_route:alert.off_route??null,deviation_quantity_kg:alert.deviation_quantity_kg??null,
      message:alert.message,latitude:alert.latitude,longitude:alert.longitude,
      last_date_time:sqlDate(alert.at),district_id:shipment.district_id??null,block_id:shipment.block_id??null,in_out_status:alert.in_out_status??null,
      off_route_in_km:alert.off_route_in_km??null,...metrics,
      long_halt_minutes:metrics.long_halt_minutes==null?null:Math.floor(metrics.long_halt_minutes),
      event_key:alert.event_key,alert_event_id:alert.episode_key??null
    };
  });
  const columns=Object.keys(records[0]);
  const placeholders=columns.slice(0,-1).map(()=>'?').concat('(SELECT id FROM tbl_vehicle_alert_event WHERE event_key=?)').join(',');
  await connection.execute(`INSERT INTO tbl_vehicle_alerts_details (${columns.join(',')}) VALUES ${records.map(()=>`(${placeholders})`).join(',')}
    ON DUPLICATE KEY UPDATE event_key=VALUES(event_key)`,records.flatMap(Object.values));
}
export async function save(connection,shipment,result,packet=null) {
  if(result.result==='OLD_OR_DUPLICATE')return;
  return outbox.stage(connection,{shipment:{id:shipment.id,vehicle_no:shipment.vehicle_no,district_id:shipment.district_id??null,block_id:shipment.block_id??null},result,packet});
}
