import {sqlDate} from '../config/database.js';
import {alertMetrics,metricColumns} from '../helpers/alert-metrics.js';
import {isExcludedAlertId} from '../config/alerts.js';
export async function apply(connection,shipment,event){
  if(isExcludedAlertId(event.alert_id))return;
  const closed=event.action==='CLOSE';
  const record={
    shipment_id:shipment.id,vehicle_no:shipment.vehicle_no,alert_id:event.alert_id,event_key:event.event_key,
    district_id:shipment.district_id??null,
    start_date_time:sqlDate(event.start_at),end_date_time:closed?sqlDate(event.at):null,
    off_route_in_km:event.off_route_in_km??null,status:closed?0:1,
    speed:event.speed??null,max_speed:event.speed??null,...alertMetrics(event)
  };
  const [existing]=await connection.execute('SELECT id FROM tbl_vehicle_alert_event WHERE event_key=? FOR UPDATE',[event.event_key]);
  if(!existing.length){
    const columns=Object.keys(record);
    await connection.execute(`INSERT INTO tbl_vehicle_alert_event (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,Object.values(record));
    return;
  }

  const assignments=[],values=[];
  for(const field of ['speed','ignition_status']){
    assignments.push(`${field}=IF(? >= duration_minutes,?,${field})`);
    values.push(record.duration_minutes,record[field]);
  }
  for(const field of ['max_speed',...metricColumns,'off_route_in_km']){
    assignments.push(`${field}=CASE WHEN ? IS NULL THEN ${field} ELSE GREATEST(COALESCE(${field},0),?) END`);
    values.push(record[field],record[field]);
  }
  assignments.push('duration_minutes=GREATEST(duration_minutes,?)','end_date_time=COALESCE(end_date_time,?)',
    'status=IF(status=0 OR ?=0,0,1)','d_date=UTC_TIMESTAMP()');
  values.push(record.duration_minutes,record.end_date_time,record.status,existing[0].id);
  await connection.execute(`UPDATE tbl_vehicle_alert_event SET ${assignments.join(',')} WHERE id=? AND status=1 AND end_date_time IS NULL`,values);
}

export async function finishTrip(connection,shipmentId){
  // Finish only unresolved open episodes at trip end. Preserve recovery times.
  await connection.execute(`UPDATE tbl_vehicle_alert_event e JOIN shipments s ON s.id=e.shipment_id
    SET e.end_date_time=COALESCE(s.trip_completed_at,s.delivered_at,
      (SELECT MAX(occurred_at) FROM shipment_events WHERE shipment_id=s.id AND event_type='CANCELLED')),
      e.status=0,e.d_date=UTC_TIMESTAMP()
    WHERE s.id=? AND (s.trip_status=2 OR s.status IN ('ARRIVED','DELIVERED','CANCELLED'))
      AND e.status=1 AND e.end_date_time IS NULL
      AND COALESCE(s.trip_completed_at,s.delivered_at,
        (SELECT MAX(occurred_at) FROM shipment_events WHERE shipment_id=s.id AND event_type='CANCELLED')) IS NOT NULL`,[shipmentId]);
}
