import {transaction} from '../config/database.js';
import * as outbox from '../repositories/AlertOutboxRepository.js';
import * as events from '../repositories/AlertEventRepository.js';
import * as alerts from '../repositories/AlertRepository.js';
import {alertLocation,runningIdentities} from '../repositories/TripRepository.js';
import * as notifications from '../repositories/NotificationRepository.js';
import * as recipients from '../repositories/NotificationRecipientsRepository.js';
import {publishPending} from './notification.service.js';

export async function writeJob(connection,job,{recipientResolver=(shipment,db)=>recipients.forShipment(db,shipment.id)}={}){
  const row=await outbox.lock(connection,job.id);
  if(!row||row.processed_at)return false;
  const {shipment,result}=row.payload;
  if(!Object.hasOwn(shipment,'district_id'))Object.assign(shipment,await alertLocation(connection,shipment.id));
  for(const event of result.events||[])await events.apply(connection,shipment,event);
  await events.finishTrip(connection,shipment.id);
  await alerts.insertDetails(connection,shipment,result.alerts);
  if(result.alerts.length)await notifications.save(connection,shipment,result.alerts,await recipientResolver(shipment,connection));
  await outbox.complete(connection,job.id);return true;
}
export async function flush(pool,redis,{onWritten=()=>{},onAlert=()=>{},onMissingRecipients=()=>{}}={}){
  const limit=Number(process.env.ALERT_BATCH_SIZE||500);
  if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new Error('ALERT_BATCH_SIZE must be 1-5000');
  const token=await redis.acquireLock();if(!token)return 0;
  let lockLost=false;
  const heartbeat=setInterval(()=>{void redis.renewLock(token).then(ok=>{if(!ok)lockLost=true;}).catch(()=>{lockLost=true;});},10000);
  try {
    const shipments=new Map();
    const recipientResolver=(shipment,connection)=>{
      const key=shipment.id;
      if(!shipments.has(key))shipments.set(key,recipients.forShipment(connection,key,{onMissing:onMissingRecipients}));
      return shipments.get(key);
    };
    await redis.recover();
    for(const job of await outbox.pending(pool,limit))await redis.publish(job);
    const batch=await redis.claim(limit);let count=0;const written=[];
    for(const raw of batch){
      if(lockLost)throw new Error('Redis alert writer lock lost');
      const job=JSON.parse(raw);
      if(await transaction(pool,connection=>writeJob(connection,job,{recipientResolver}))){
        count++;
        written.push({...job.payload?.shipment,alert_details:job.payload?.result?.alerts||[],alert_count:(job.payload?.result?.alerts||[]).length});
      }
      await redis.acknowledge(raw,job.id);
    }
    if(count){
      const current=await runningIdentities(pool,[...new Set(written.map(row=>row.id).filter(Boolean))]);
      const ids=new Set(current.map(row=>row.id)),eligible=written.filter(row=>ids.has(row.id));
      const context=row=>({shipment_id:row.id,shipment_no:row.shipment_no,flow:row.leg,vehicle_no:row.vehicle_no,
        source:{id:row.source_id,name:row.source_name,type:row.source_kind},
        destination:{id:row.destination_id,name:row.destination_name,type:row.destination_kind}});
      const byId=new Map(current.map(row=>[row.id,row]));
      for(const job of eligible)for(const alert of job.alert_details)onAlert({
        ...context(byId.get(job.id)),alert_id:alert.alert_id,alert_code:alert.code,
        alert_name:alert.alert_name||alert.message,alert_message:alert.message,alert_time:new Date(alert.at).toISOString(),
        speed_kph:alert.speed??null,duration_minutes:alert.duration_minutes??null,
        off_route_in_km:alert.off_route_in_km??null,latitude:alert.latitude??null,longitude:alert.longitude??null,
        event_key:alert.event_key
      });
      if(eligible.length)onWritten({jobs:eligible.length,alerts:eligible.reduce((sum,row)=>sum+row.alert_count,0),
        vehicles:[...new Set(current.map(row=>row.vehicle_no))],shipment_ids:[...ids],trips:current.map(context)});
    }
    await publishPending(pool,redis,limit);
    return count;
  } finally {clearInterval(heartbeat);await redis.releaseLock(token);}
}
export function startBatchWorker(pool,redis,log=()=>{}){
  const seconds=Number(process.env.ALERT_BATCH_INTERVAL_SECONDS||5);
  if(!Number.isFinite(seconds)||seconds<1)throw new Error('ALERT_BATCH_INTERVAL_SECONDS must be positive');
  let stopping=false,running=null;
  const tick=()=>{
    if(stopping||running)return;
    running=flush(pool,redis,{onWritten:detail=>log('ALERT_BATCH_WRITTEN',detail),onAlert:detail=>log('ALERT_DETAILS',detail),
      onMissingRecipients:detail=>log('NOTIFICATION_RECIPIENT_MISSING',detail)})
      .catch(error=>log('ALERT_BATCH_FAILED',{code:error.code||error.name})).finally(()=>{running=null;});
  };
  const timer=setInterval(tick,seconds*1000);tick();
  return {async stop(){stopping=true;clearInterval(timer);if(running)await running;await flush(pool,redis);}};
}
