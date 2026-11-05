import {createClient} from '../config/mqtt.js';
import {normalizePacket,normalizePresencePacket,isPresenceHeader,vehicleNumber} from '../helpers/packet.js';
import {processPacket} from '../services/packet.service.js';
import {isRunningNumber} from '../repositories/TripRepository.js';

export function startSubscriber(pool,{redis=null,onFatal=()=>{},log=()=>{}}={}) {
  const client=createClient(),pending=new Set(),rejectedAt=new Map(),processedAt=new Map();
  let stopping=false,reconnects=0;
  client.on('connect',()=>{
    reconnects=0;
    client.subscribe(process.env.MQTT_TOPIC||'gps/+/data',{qos:1},error=>log(error?'MQTT_SUBSCRIBE_ERROR':'MQTT_CONNECTED',error?{code:error.code}:{client_id:client.options.clientId}));
  });
  client.on('reconnect',()=>{if(!stopping)log('MQTT_RECONNECTING',{attempt:++reconnects});});
  client.on('offline',()=>{if(!stopping)log('MQTT_OFFLINE');});
  client.on('error',error=>log('MQTT_ERROR',{code:error.code||error.name}));
  // PUBACK follows the durable SQL commit.
  client.handleMessage=(message,done)=>{
    if(stopping)return done(new Error('Service is stopping'));
    const task=(async()=>{
      let payload;
      try {
        if(message.payload.length>256*1024)throw Object.assign(new Error('Oversized packet'),{permanent:true});
        payload=JSON.parse(message.payload.toString('utf8'));
        const packet=isPresenceHeader(payload?.packet_header)?normalizePresencePacket(message.topic,payload,Date.now(),message.retain):normalizePacket(message.topic,payload);
        const result=await processPacket(pool,packet,redis);
        if(result.alerts)log('ALERTS_STAGED',result);
        else if(result.result==='IMEI_MISMATCH'&&Date.now()-(processedAt.get('imei:'+packet.vehicle_no)||0)>=60000){
          log('TRIP_PACKET_REJECTED',result);processedAt.set('imei:'+packet.vehicle_no,Date.now());
        }
        else if(result.result==='PROCESSED'&&Date.now()-(processedAt.get(packet.vehicle_no)||0)>=10000){
          log('TRIP_PACKET_PROCESSED',result);processedAt.set(packet.vehicle_no,Date.now());
        }
        done();
      } catch(error){
        if(error.permanent||error instanceof SyntaxError){
          const reason=error.permanent?error.message:'Malformed JSON';
          if(reason==='Unsupported packet header'&&['$LGN','LGN','$HEL','HEL','$HBT','HBT'].includes(payload?.packet_header)){
            done();return;
          }
          const match=/^gps\/([^/]+)\/data$/.exec(message.topic);
          const number=match?vehicleNumber(match[1]):null,key=`${number}:${reason}`;
          if(number&&Date.now()-(rejectedAt.get(key)||0)>60000){
            rejectedAt.set(key,Date.now());
            let running=false;
            try{running=await isRunningNumber(pool,number);}catch(lookupError){log('TRIP_LOG_LOOKUP_FAILED',{code:lookupError.code||lookupError.name});}
            if(!running){done();return;}
            log('PACKET_IGNORED',{
              code:error.code||error.name,reason,topic:message.topic,
              packet_header:payload?.packet_header??null,
              payload:message.payload.length<=4096&&payload!==undefined?payload:message.payload.subarray(0,4096).toString('utf8'),
              payload_truncated:message.payload.length>4096
            });
          }
          done();
        } else {log('PACKET_FAILED',{code:error.code||error.name});done(error);onFatal(error);}
      }
    })();
    pending.add(task);void task.finally(()=>pending.delete(task));
  };
  return {async stop(){
    stopping=true;
    await new Promise(resolve=>client.end(true,{},resolve));
    await Promise.allSettled([...pending]);
  }};
}
