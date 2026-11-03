import {sqlDate} from '../config/database.js';
import {alertMetrics,metricColumns} from '../helpers/alert-metrics.js';
import {isExcludedAlertId} from '../config/alerts.js';
export async function apply(connection,shipment,event){
  if(isExcludedAlertId(event.alert_id))return;
  const closed=event.action==='CLOSE';
  const record={
    shipment_id:shipment.id,vehicle_no:shipment.vehicle_no,alert_id:event.alert_id,event_key:event.event_key,
    district_id:shipment.district_id??null,block_id:shipment.block_id??null,
    start_date_time:sqlDate(event.start_at),end_date_time:closed?sqlDate(event.at):null,
    start_lat:event.start_lat??null,start_lng:event.start_lng??null,end_lat:event.latitude??null,end_lng:event.longitude??null,
    off_route_in_km:event.off_route_in_km??null,last_sample_at:sqlDate(event.at),status:closed?0:1,
    speed:event.speed??null,max_speed:event.speed??null,...alertMetrics(event)
  };
  const [existing]=await connection.execute('SELECT id FROM tbl_vehicle_alert_event WHERE event_key=? FOR UPDATE',[event.event_key]);
  if(!existing.length){
    const columns=Object.keys(record);
    await connection.execute(`INSERT INTO tbl_vehicle_alert_event (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,Object.values(record));
    return;
  }

  const assignments=[],values=[];
  for(const field of ['end_lat','end_lng','speed','ignition_status']){
    assignments.push(`${field}=IF(? >= last_sample_at,?,${field})`);
    values.push(record.last_sample_at,record[field]);
  }
  for(const field of ['max_speed',...metricColumns,'off_route_in_km']){
    assignments.push(`${field}=CASE WHEN ? IS NULL THEN ${field} ELSE GREATEST(COALESCE(${field},0),?) END`);
    values.push(record[field],record[field]);
  }
  assignments.push('duration_minutes=GREATEST(duration_minutes,?)','end_date_time=COALESCE(end_date_time,?)',
    'status=IF(end_date_time IS NULL,1,0)','last_sample_at=GREATEST(last_sample_at,?)','d_date=UTC_TIMESTAMP()');
  values.push(record.duration_minutes,record.end_date_time,record.last_sample_at,existing[0].id);
  await connection.execute(`UPDATE tbl_vehicle_alert_event SET ${assignments.join(',')} WHERE id=?`,values);
}
