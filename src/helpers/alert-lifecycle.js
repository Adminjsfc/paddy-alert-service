import {createHash} from 'node:crypto';
import {excludedAlerts} from '../config/alerts.js';

export function createLifecycle(shipment,state,configs,packet){
  const alerts=[],events=[];
  const allSettings=Object.fromEntries(configs.map(config=>[config.alert_short_name,config]));
  const settings=Object.fromEntries(configs
    .filter(config=>Number(config.active)===1&&!excludedAlerts.has(config.alert_short_name))
    .map(config=>[config.alert_short_name,config]));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const episodeKey=(code,key)=>hash(`${shipment.id}|${code}|${key}|episode`);
  const sample=()=>({latitude:state.latitude??null,longitude:state.longitude??null,
    speed:state.speed??null,ignition_status:packet?.ignition??state.ignition??null});

  function event(code,item,at,action,fields={}){
    if(excludedAlerts.has(code)||!allSettings[code])return;
    item.event_key ||= episodeKey(code,item.since);
    events.push({action,code,alert_id:allSettings[code].id,event_key:item.event_key,
      start_at:item.since,at,start_lat:item.start_lat??null,start_lng:item.start_lng??null,
      ...sample(),...fields});
  }

  function pulse(code,key,at,fields={}){
    const config=settings[code];
    if(!config)return;
    const keyForEvent=fields.episode_key||episodeKey(code,key);
    if(!fields.episode_key)event(code,{since:at,event_key:keyForEvent,
      start_lat:state.latitude,start_lng:state.longitude},at,'CLOSE');
    alerts.push({code,episode_key:keyForEvent,alert_id:config.id,
      event_key:hash(`${shipment.id}|${code}|${key}`),at,...sample(),
      message:config.alert_name||code,duration_minutes:0,...fields});
  }

  function condition(code,active,at,fields={}){
    const config=settings[code];
    if(!active||!config){
      const item=state.conditions[code];
      if(item?.sentAt!=null)event(code,item,at,'CLOSE',fields);
      delete state.conditions[code];
      return;
    }
    const item=state.conditions[code] ||= {since:at,start_lat:state.latitude??null,start_lng:state.longitude??null};
    const duration=at-item.since;
    const threshold=Number(config.alert_time||0)*60000;
    const reminder=Number(config.alert_reminder_time||0)*60000;
    if(duration<threshold)return;

    event(code,item,at,'UPSERT',fields);
    if(item.sentAt!=null&&(!reminder||at-item.sentAt<reminder))return;
    const repeat=reminder?Math.floor(duration/reminder):0;
    pulse(code,`${item.since}|${repeat}`,at,{episode_key:item.event_key,
      duration_minutes:Math.max(0,duration)/60000,...fields,
      ...(code==='LH'?{long_halt_minutes:Math.floor(duration/60000)}:{})});
    item.sentAt=at;
  }

  return {alerts,events,settings,pulse,condition};
}
