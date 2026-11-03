import {transaction} from '../config/database.js';
import * as trips from '../repositories/TripRepository.js';
import {processShipment} from '../services/packet.service.js';
export async function scan(pool,redis=null) {
  const limit=Number(process.env.SCAN_BATCH_SIZE||100);
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('SCAN_BATCH_SIZE must be 1-1000');
  let after=0,total=0;
  for(;;){
    const candidates=await trips.scanCandidates(pool,after,limit);
    if(!candidates.length)break;
    for(const candidate of candidates){
      total+=await transaction(pool,async connection=>{
        // Match packet/trip-worker lock order: vehicle, shipment, alert state.
        await trips.lockVehicle(connection,candidate.vehicle_id);
        const [shipment]=await trips.findByVehicle(connection,candidate.vehicle_id,candidate.id);
        if(!shipment)return 0;
        return processShipment(connection,shipment,{redis});
      });
      after=candidate.id;
    }
  }
  return total;
}

export function startScheduler(pool,redis,log=()=>{}) {
  const seconds=Number(process.env.SCAN_INTERVAL_SECONDS||60);
  if(!Number.isFinite(seconds)||seconds<1)throw new Error('SCAN_INTERVAL_SECONDS must be positive');
  let stopping=false,running=null;
  const tick=()=>{
    if(stopping||running)return;
    running=scan(pool,redis).then(count=>{if(count)log('SCHEDULED_ALERTS_STAGED',{count});})
      .catch(error=>log('SCAN_FAILED',{code:error.code||error.name})).finally(()=>{running=null;});
  };
  const timer=setInterval(tick,seconds*1000);tick();
  return {async stop(){stopping=true;clearInterval(timer);if(running)await running;}};
}
