import {randomUUID} from 'node:crypto';
const leaseTtl=10000;
const heartbeatMs=2000;

export async function acquireServiceLock(redis,key,onLost=()=>{}){
  const token=`${process.pid}:${randomUUID()}`;
  const acquired=await redis.set(key,token,'PX',leaseTtl,'NX');
  if(!acquired){
    throw Object.assign(new Error('Service is already running. Use npm run restart to restart it, or npm stop to stop it.'),{code:'SERVICE_ALREADY_RUNNING'});
  }

  let lost=false;
  const timer=setInterval(async()=>{
    try{
      const stopRequested=await redis.get(key+':stop');
      if(stopRequested===token){
        const drainTtl=Number(process.env.SHUTDOWN_TIMEOUT_MS||30000)+5000;
        const held=await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return 0",1,key,token,drainTtl);
        if(held){lost=true;clearInterval(timer);onLost('SERVICE_STOP_REQUESTED');return;}
      }
      const renewed=await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return 0",1,key,token,leaseTtl);
      if(renewed)return;
    }catch{}
    if(!lost){lost=true;clearInterval(timer);onLost('SERVICE_LOCK_LOST');}
  },heartbeatMs);
  timer.unref();

  return {async release(){
    clearInterval(timer);
    await redis.eval("local n=0;if redis.call('GET',KEYS[1])==ARGV[1] then n=redis.call('DEL',KEYS[1]) end;if redis.call('GET',KEYS[2])==ARGV[1] then redis.call('DEL',KEYS[2]) end;return n",2,key,key+':stop',token);
  }};
}
