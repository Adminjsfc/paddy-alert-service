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
      alert_name:config.alert_name||code,message:config.alert_name||code,duration_minutes:0,...fields});
  }

  function condition(code,active,at,fields={}){
    const config=settings[code];
    const value=Number(config?.alert_time??0);
    const timedPositive=['LH','IDL','SFN','DO','DISC'].includes(code);
    const valid=Number.isFinite(value)&&(timedPositive?value>0:value>=0);
    if(!active||!config||!valid){
      const item=state.conditions[code];
      if(item?.sentAt!=null)event(code,item,at,'CLOSE',fields);
      delete state.conditions[code];
      return;
    }
    const item=state.conditions[code] ||= {since:at,start_lat:state.latitude??null,start_lng:state.longitude??null};
    const duration=at-item.since;
    // GpsService uses alert_time as km/h for OS and metres for OR.
    const threshold=['OS','OR'].includes(code)?0:value*60000;
    if(duration<threshold)return;

    event(code,item,at,'UPSERT',fields);
    let count=Number(item.alertCount??(item.sentAt!=null?1:0));
    const emit=()=>{
      count++;
      pulse(code,`${item.since}|stage:${count}`,at,{episode_key:item.event_key,
        duration_minutes:Math.max(0,duration)/60000,...fields,
        ...(code==='LH'?{long_halt_minutes:Math.floor(duration/60000)}:{})});
      item.sentAt=at;item.alertCount=count;
    };
    if(code==='LH'){
      // Exactly two notifications: at T and at 2T, as in GpsService.
      while(count<2&&duration>=(count+1)*threshold)emit();
    }else if(code==='OR'){
      // These three columns are distance milestones, not reminder minutes.
      const distances=[config.alert_time,config.alert_reminder_time,config.alert_interval];
      const next=Number(distances[count]),metres=Number(fields.deviation_metres??Number(fields.off_route_in_km)*1000);
      if(count<3&&Number.isFinite(next)&&next>0&&metres>=next&&metres>Number(item.lastAlertMetres??0)){
        emit();item.lastAlertMetres=metres;
      }
    }else if(item.sentAt==null)emit();
  }

  return {alerts,events,settings,pulse,condition};
}
