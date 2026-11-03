import {transaction} from '../config/database.js';
import * as outbox from '../repositories/AlertOutboxRepository.js';
import * as events from '../repositories/AlertEventRepository.js';
import * as alerts from '../repositories/AlertRepository.js';
import {alertLocation} from '../repositories/TripRepository.js';

export async function writeJob(connection,job){
  const row=await outbox.lock(connection,job.id);
  if(!row||row.processed_at)return false;
  const {shipment,result}=row.payload;
  if(!Object.hasOwn(shipment,'block_id'))Object.assign(shipment,await alertLocation(connection,shipment.id));
  for(const event of result.events||[])await events.apply(connection,shipment,event);
  await alerts.insertDetails(connection,shipment,result.alerts);
  await outbox.complete(connection,job.id);return true;
}
export async function flush(pool,redis){
  const limit=Number(process.env.ALERT_BATCH_SIZE||500);
  if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new Error('ALERT_BATCH_SIZE must be 1-5000');
  const token=await redis.acquireLock();if(!token)return 0;
  let lockLost=false;
  const heartbeat=setInterval(()=>{void redis.renewLock(token).then(ok=>{if(!ok)lockLost=true;}).catch(()=>{lockLost=true;});},10000);
  try {
    await redis.recover();
    for(const job of await outbox.pending(pool,limit))await redis.publish(job);
    const batch=await redis.claim(limit);let count=0;
    for(const raw of batch){
      if(lockLost)throw new Error('Redis alert writer lock lost');
      const job=JSON.parse(raw);
      if(await transaction(pool,connection=>writeJob(connection,job)))count++;
      await redis.acknowledge(raw,job.id);
    }
    return count;
  } finally {clearInterval(heartbeat);await redis.releaseLock(token);}
}
export function startBatchWorker(pool,redis,log=()=>{}){
  const seconds=Number(process.env.ALERT_BATCH_INTERVAL_SECONDS||5);
  if(!Number.isFinite(seconds)||seconds<1)throw new Error('ALERT_BATCH_INTERVAL_SECONDS must be positive');
  let stopping=false,running=null;
  const tick=()=>{
    if(stopping||running)return;
    running=flush(pool,redis).then(count=>{if(count)log('ALERT_BATCH_WRITTEN',{jobs:count});})
      .catch(error=>log('ALERT_BATCH_FAILED',{code:error.code||error.name})).finally(()=>{running=null;});
  };
  const timer=setInterval(tick,seconds*1000);tick();
  return {async stop(){stopping=true;clearInterval(timer);if(running)await running;await flush(pool,redis);}};
}
