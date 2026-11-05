import {coreDatabase} from '../config/core-database.js';
export async function verifyRecipientSource(){
  await coreDatabase().query('SELECT id,user_type,status FROM tbl_user_master LIMIT 1');
  await coreDatabase().query('SELECT user_id,district_id,store_id,user_type,status FROM tbl_user_districtwise_store_assignment LIMIT 1');
  await coreDatabase().query('SELECT id,district_id,store_type,status FROM tbl_store_location_master LIMIT 1');
}
export async function forShipment(connection,shipmentId,{core=coreDatabase(),onMissing=()=>{}}={}){
  const [shipments]=await connection.execute(`SELECT s.leg,s.miller_id,s.driver_user_id,r.source_id,r.destination_id,
    f.kind source_kind,d.kind destination_kind,d.district_id destination_district_id,
    COALESCE(s.core_store_location_id,d.core_store_id) destination_store_id
    FROM shipments s JOIN shipment_routes r ON r.id=s.route_id
    JOIN facilities f ON f.id=r.source_id JOIN facilities d ON d.id=r.destination_id WHERE s.id=?`,[shipmentId]);
  const shipment=shipments[0];
  if(!shipment)return [];
  const paddy=shipment.leg==='PADDY'&&['PACS','LAMPS'].includes(shipment.source_kind)&&shipment.destination_kind==='MILLER'
    &&Number(shipment.destination_id)===Number(shipment.miller_id);
  const cmr=shipment.leg==='CMR'&&shipment.source_kind==='MILLER'&&['SFC_GODOWN','FCI'].includes(shipment.destination_kind)
    &&Number(shipment.source_id)===Number(shipment.miller_id);
  if(!paddy&&!cmr)return [];
  const storeId=cmr&&Number(shipment.destination_store_id)>0?Number(shipment.destination_store_id):null;
  const districtId=cmr&&Number(shipment.destination_district_id)>0?Number(shipment.destination_district_id):null;
  const [coreUsers]=await core.execute(`SELECT DISTINCT u.id user_id,u.user_type FROM tbl_user_master u
    WHERE u.status=1 AND (u.user_type=2 OR (? IS NOT NULL AND u.user_type IN (4,8) AND EXISTS (
      SELECT 1 FROM tbl_user_districtwise_store_assignment a
      JOIN tbl_store_location_master st ON st.id=a.store_id AND st.district_id=a.district_id
        AND st.status=1 AND st.store_type IN (1,2)
      WHERE a.user_id=u.id AND a.status=1 AND a.store_id=? AND a.district_id=?)))`,[storeId,storeId,districtId]);
  const [millers]=await connection.execute(`SELECT id user_id FROM users WHERE active=1 AND role='MILLER'
    AND COALESCE(facility_id,miller_id)=?
    AND (facility_id IS NULL OR miller_id IS NULL OR facility_id=miller_id)`,[shipment.miller_id]);
  const [drivers]=shipment.driver_user_id?await connection.execute(
    "SELECT id user_id FROM users WHERE id=? AND active=1 AND role='DRIVER'",[shipment.driver_user_id]):[[]];
  const context={shipment_id:shipmentId,flow:shipment.leg,miller_id:shipment.miller_id,destination_id:shipment.destination_id};
  if(!millers.length)onMissing({...context,reason:'MILLER_USER_NOT_FOUND'});
  if(shipment.driver_user_id&&!drivers.length)onMissing({...context,reason:'DRIVER_USER_NOT_FOUND',driver_user_id:shipment.driver_user_id});
  if(!coreUsers.some(row=>Number(row.user_type)===2))onMissing({...context,reason:'STATE_USERS_NOT_FOUND'});
  if(cmr&&!storeId)onMissing({...context,reason:'GODOWN_STORE_NOT_MAPPED'});
  else if(cmr&&!coreUsers.some(row=>[4,8].includes(Number(row.user_type))))
    onMissing({...context,reason:'GODOWN_USER_NOT_FOUND',core_store_id:storeId,destination_district_id:districtId});
  const recipients=[...coreUsers.map(row=>({user_id:Number(row.user_id),user_source:'CORE'})),
    ...millers.map(row=>({user_id:Number(row.user_id),user_source:'PADDY'})),
    ...drivers.map(row=>({user_id:Number(row.user_id),user_source:'PADDY'}))];
  return [...new Map(recipients.map(row=>[`${row.user_source}:${row.user_id}`,row])).values()];
}
