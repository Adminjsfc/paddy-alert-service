import {createPool} from './src/config/database.js';
import {startSubscriber} from './src/mqtt/subscriber.js';
import {startScheduler} from './src/jobs/alert.scheduler.js';
import {createRedis} from './src/config/redis.js';
import {RedisRepository} from './src/repositories/RedisRepository.js';
import {startBatchWorker} from './src/services/AlertBatchService.js';
import {acquireServiceLock} from './src/helpers/service-lock.js';

const pool=createPool(),redisClient=createRedis(),redis=new RedisRepository(redisClient);
let subscriber,scheduler,batchWorker,serviceLock,stopping=false;
const log=(event,extra={})=>console.log(JSON.stringify({event,...extra}));
async function shutdown(code=0){
  if(stopping)return;stopping=true;
  const timeout=setTimeout(()=>process.exit(1),Number(process.env.SHUTDOWN_TIMEOUT_MS||30000));timeout.unref();
  await Promise.allSettled([subscriber?.stop(),scheduler?.stop()]);
  try {await batchWorker?.stop();}catch(error){log('ALERT_DRAIN_FAILED',{code:error.code||error.name});code=1;}
  try {await serviceLock?.release();}catch(error){log('SERVICE_LOCK_RELEASE_FAILED',{code:error.code||error.name});code=1;}
  redisClient.disconnect();
  await pool.end();clearTimeout(timeout);process.exitCode=code;
  if(process.connected)process.disconnect();
}
try {
  await pool.query('SELECT status FROM gps_alert_master LIMIT 1');
  await redisClient.connect();await redisClient.ping();
  const clientId=process.env.MQTT_CLIENT_ID||'paddy-gps-alerts';
  serviceLock=await acquireServiceLock(redisClient,`${redis.prefix}:service:${clientId}`,reason=>{
    log(reason);void shutdown(reason==='SERVICE_STOP_REQUESTED'?0:1);
  });
  log('REDIS_CONNECTED',{pid:process.pid});
  batchWorker=startBatchWorker(pool,redis,log);
  scheduler=startScheduler(pool,redis,log);
  subscriber=startSubscriber(pool,{redis,log,onFatal:()=>void shutdown(1)});
} catch(error){
  await shutdown(1);
  if(error.code==='SERVICE_ALREADY_RUNNING')log(error.code,{message:error.message});
  else throw error;
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void shutdown());
process.on('message',message=>{if(message?.type==='shutdown')void shutdown();});
process.on('disconnect',()=>void shutdown());
