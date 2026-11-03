export function lockVehicle(connection,id){
  return connection.execute('SELECT id FROM vehicles WHERE id=? FOR UPDATE',[id]);
}
export async function findRunningByNumber(connection,number){
  const [candidates]=await connection.execute(`SELECT s.vehicle_id FROM shipments s
    JOIN vehicles v ON v.id=s.vehicle_id
    WHERE UPPER(REPLACE(REPLACE(v.registration_no,' ',''),'-',''))=?
      AND ${runningTripSql()}
    ORDER BY s.id LIMIT 1`,[number]);
  if(!candidates.length)return [];
  await lockVehicle(connection,candidates[0].vehicle_id);
  const [rows]=await connection.execute(`SELECT ${shipmentColumns},i.imei mapped_imei FROM shipments s
    JOIN vehicles v ON v.id=s.vehicle_id
    JOIN gps_devices d ON d.vehicle_id=s.vehicle_id AND d.active=1
    JOIN imeis i ON i.id=d.imei_id AND i.active=1
    WHERE s.vehicle_id=? AND UPPER(REPLACE(REPLACE(v.registration_no,' ',''),'-',''))=?
      AND ${runningTripSql()}
    ORDER BY s.id FOR UPDATE`,[candidates[0].vehicle_id,number]);
  return rows;
}
export async function findByVehicle(connection,vehicleId,id=null) {
  const [rows]=await connection.execute(`SELECT ${shipmentColumns} FROM shipments s
    JOIN vehicles v ON v.id=s.vehicle_id WHERE s.vehicle_id=? AND ${id==null?runningTripSql():'s.id=?'} ORDER BY s.id FOR UPDATE`,id==null?[vehicleId]:[vehicleId,id]);
  return rows;
}
export async function scanCandidates(pool,after,limit) {
  const [rows]=await pool.execute(`SELECT s.id,s.vehicle_id FROM shipments s
    LEFT JOIN gps_alert_outbox latest ON latest.id=(SELECT MAX(o.id) FROM gps_alert_outbox o WHERE o.shipment_id=s.id)
    WHERE s.id>?
    AND ((${runningTripSql()})
      OR JSON_LENGTH(JSON_EXTRACT(latest.payload_json,'$.result.state.conditions'))>0
      OR EXISTS (SELECT 1 FROM tbl_vehicle_alert_event e WHERE e.shipment_id=s.id AND e.status=1 AND e.end_date_time IS NULL))
    ORDER BY s.id LIMIT ${limit}`,[after]);return rows;
}
export async function alertLocation(connection,id){
  const [rows]=await connection.execute('SELECT district_id,block_id FROM shipments WHERE id=?',[id]);
  return rows[0]??{};
}
export async function lastKnownLocation(connection,vehicleId,now){
  const [rows]=await connection.execute(`SELECT d.latitude,d.longitude,d.last_gps_at
    FROM gps_devices d JOIN imeis i ON i.id=d.imei_id AND i.active=1
    WHERE d.vehicle_id=? AND d.active=1 AND d.last_gps_at<=?
      AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
    ORDER BY d.last_gps_at DESC LIMIT 1`,[vehicleId,new Date(now)]);
  return rows[0]??null;
}
import {runningTripSql} from '../config/alerts.js';
export const shipmentColumns=`s.id,s.vehicle_id,s.status,s.trip_status,s.dispatched_at,s.expected_completion_at,
  s.district_id,s.block_id,s.source_lat,s.source_lng,s.source_radius_m,
  s.destination_lat,s.destination_lng,s.destination_radius_m,v.registration_no vehicle_no`;
