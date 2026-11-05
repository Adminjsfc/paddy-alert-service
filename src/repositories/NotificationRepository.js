import {isExcludedAlertId} from '../config/alerts.js';

export async function save(connection,shipment,input,recipients){
  const alerts=input.filter(alert=>!isExcludedAlertId(alert.alert_id));
  if(!alerts.length)return 0;
  const unique=new Map();
  for(const recipient of recipients){
    const id=Number(recipient.user_id),source=recipient.user_source;
    if(!Number.isSafeInteger(id)||id<=0||!['CORE','PADDY'].includes(source))throw new Error('Invalid notification recipient');
    unique.set(`${source}:${id}`,{id,source});
  }
  let count=0;
  for(const alert of alerts){
    const [records]=await connection.execute(`SELECT m.alert_name FROM tbl_vehicle_alerts_details d
      JOIN gps_alert_master m ON m.id=d.alert_id WHERE d.event_key=? AND d.shipment_id=?`,[alert.event_key,shipment.id]);
    if(!records.length)throw new Error('Saved alert detail is required before its notification');
    const [saved]=await connection.execute(`INSERT INTO tbl_notifications
      (event_key,alert_id,title,message,reference_id,notification_type,link,district_id,vehicle_no)
      VALUES (?,?,?,?,?,9,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[
      alert.event_key,alert.alert_id,records[0].alert_name,alert.message||records[0].alert_name,
      shipment.id,'/alertReport',shipment.district_id??null,shipment.vehicle_no]);
    if(!saved.insertId)throw new Error('Notification insert returned no ID');
    if(unique.size){
      const users=[...unique.values()];
      await connection.execute(`INSERT INTO tbl_notification_details (notification_id,user_id,user_source)
        VALUES ${users.map(()=>'(?,?,?)').join(',')} ON DUPLICATE KEY UPDATE id=id`,
        users.flatMap(user=>[saved.insertId,user.id,user.source]));
    }
    count++;
  }
  return count;
}

export async function pending(connection,limit){
  const [rows]=await connection.query(`SELECT d.id delivery_id,d.user_id,d.user_source,n.id,n.id notification_id,
    n.title,n.message,n.reference_id,n.notification_type,n.link,n.district_id,n.vehicle_no,n.alert_id,n.c_date
    FROM tbl_notification_details d JOIN tbl_notifications n ON n.id=d.notification_id
    WHERE d.published_at IS NULL AND d.status=1 AND n.status=1 ORDER BY d.id LIMIT ${limit}`);
  return rows;
}
export const markPublished=(connection,id)=>connection.execute(
  'UPDATE tbl_notification_details SET published_at=UTC_TIMESTAMP() WHERE id=? AND published_at IS NULL',[id]);
