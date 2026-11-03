import {epoch} from '../config/database.js';

export function checkCommunicationGap(context,code) {
  const {state,shipment,settings,active,now,condition}=context;
  const since=state.lastLiveAt??epoch(shipment.dispatched_at);

  if(!active || since==null || !settings[code]) {
    condition(code,false,now);
    return;
  }

  state.conditions[code] ||= {since};
  condition(code,true,now);
}
