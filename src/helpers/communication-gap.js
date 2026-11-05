import {epoch} from '../config/database.js';

export function seedCommunicationBaseline(state,shipment,device,now=Date.now()){
  if(state.lastLiveAt!=null||state.communicationBaselineAt!=null)return state;
  const candidates=[shipment.trip_started_at,shipment.dispatched_at,shipment.created_at,
    shipment.last_gps_at,device?.last_gps_at].map(epoch).filter(value=>Number.isFinite(value)&&value>0&&value<=now);
  if(!candidates.length)return state;
  return {...state,communicationBaselineAt:Math.max(...candidates)};
}

export function checkCommunicationGap(context,code) {
  const {state,shipment,settings,active,now,condition}=context;
  const since=state.lastLiveAt??state.communicationBaselineAt??epoch(shipment.trip_started_at)??epoch(shipment.dispatched_at)??epoch(shipment.created_at);

  if(!active || !Number.isFinite(since) || since>now || !settings[code]) {
    condition(code,false,now);
    return;
  }

  state.conditions[code] ||= {since};
  condition(code,true,now);
}
