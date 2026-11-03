import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRedis} from '../src/config/redis.js';
import {RedisRepository} from '../src/repositories/RedisRepository.js';

const action=process.argv[2]||'status';
if(!['stop','restart','status'].includes(action))throw new Error('Use stop, restart or status');
const client=createRedis();
const redis=new RedisRepository(client);
const key=redis.prefix+':service:'+(process.env.MQTT_CLIENT_ID||'paddy-gps-alerts');
const log=(event,fields={})=>console.log(JSON.stringify({event,...fields}));

async function stop(){
  const owner=await client.get(key);
  if(!owner){log('SERVICE_NOT_RUNNING');return;}
  const pid=Number(owner.split(':')[0]);
  await client.set(key+':stop',owner,'PX',60000);
  log('SERVICE_STOPPING',{pid});
  const deadline=Date.now()+Number(process.env.SHUTDOWN_TIMEOUT_MS||30000)+15000;
  while(await client.get(key)===owner){
    if(Date.now()>deadline)throw new Error('Service did not stop in time; check its console before retrying.');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  log('SERVICE_STOPPED',{pid});
}

try{
  await client.connect();
  if(action==='status'){
    const owner=await client.get(key);
    log('SERVICE_STATUS',{running:Boolean(owner),pid:owner?Number(owner.split(':')[0]):null});
  }else await stop();
}finally{client.disconnect();}

if(action==='restart'){
  const child=spawn(process.execPath,['--env-file-if-exists=.env','gps_service.js'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:['inherit','inherit','inherit','ipc'],env:process.env
  });
  log('SERVICE_STARTING',{pid:child.pid});
  let stopping=false;
  function stopChild(){
    if(stopping)return;
    stopping=true;
    if(child.connected)child.send({type:'shutdown'},()=>{});
  }
  process.on('SIGINT',stopChild);
  process.on('SIGTERM',stopChild);
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??(stopping?0:1);});
}
