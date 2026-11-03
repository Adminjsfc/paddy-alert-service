import {transaction} from '../config/database.js';
import * as trips from '../repositories/TripRepository.js';
import * as alerts from '../repositories/AlertRepository.js';
import * as states from '../repositories/AlertStateRepository.js';
import {evaluate} from './alert.service.js';
import * as routes from '../repositories/routeRepository.js';
import {hasCoordinates,seedLastLocation} from '../helpers/last-location.js';

export async function processShipment(connection,shipment,{packet=null,redis=null,settings=null}={}){
  let state=await states.load(connection,shipment.id,redis);
  const now=Date.now();
  if(!hasCoordinates(state)){
    let cached;
    if(redis)try{cached=await redis.getLatestPacket(shipment.vehicle_no);}catch{}
    const device=await trips.lastKnownLocation(connection,shipment.vehicle_id,now);
    state=seedLastLocation(state,[cached,device],now);
  }
  const config=settings??await alerts.settings(connection);
  const context=packet?.gps_fix?{route:await routes.findByShipment(connection,shipment.id)}:{};
  const result=evaluate(shipment,state,config,packet,now,context);
  await alerts.save(connection,shipment,result,packet);
  return result.alerts.length;
}

export async function processPacket(pool,packet,redis=null) {
  const result=await transaction(pool,async connection=>{
    const shipments=await trips.findRunningByNumber(connection,packet.vehicle_no);
    if(!shipments.length)return {result:'NO_ACTIVE_SHIPMENT',alerts:0};
    if(packet.imei!=null&&shipments.some(shipment=>String(packet.imei)!==String(shipment.mapped_imei)))return {result:'IMEI_MISMATCH',alerts:0};
    const settings=await alerts.settings(connection);
    let count=0;
    for(const shipment of shipments)count+=await processShipment(connection,shipment,{packet,redis,settings});
    return {result:'PROCESSED',alerts:count};
  });
  if(redis&&result.result==='PROCESSED')await redis.saveLatestPacket(packet.vehicle_no,packet);
  return result;
}
