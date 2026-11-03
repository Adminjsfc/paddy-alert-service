import {parseJson} from '../helpers/json.js';
export async function stage(connection,payload){
  const [result]=await connection.execute('INSERT INTO gps_alert_outbox (shipment_id,payload_json) VALUES (?,?)',[payload.shipment.id,JSON.stringify(payload)]);
  return result.insertId;
}
export async function pending(connection,limit){
  const [rows]=await connection.query(`SELECT id,payload_json FROM gps_alert_outbox WHERE processed_at IS NULL ORDER BY id LIMIT ${limit}`);
  return rows.map(row=>({id:row.id,payload:parseJson(row.payload_json)}));
}
export async function lock(connection,id){
  const [rows]=await connection.execute('SELECT id,payload_json,processed_at FROM gps_alert_outbox WHERE id=? FOR UPDATE',[id]);
  return rows[0]?{...rows[0],payload:parseJson(rows[0].payload_json)}:null;
}
export function complete(connection,id){return connection.execute('UPDATE gps_alert_outbox SET processed_at=UTC_TIMESTAMP() WHERE id=?',[id]);}
export async function latestState(connection,shipmentId){
  const [rows]=await connection.execute(`SELECT JSON_EXTRACT(payload_json,'$.result.state') state_json
    FROM gps_alert_outbox WHERE shipment_id=? ORDER BY id DESC LIMIT 1`,[shipmentId]);
  return parseJson(rows[0]?.state_json)||{};
}
