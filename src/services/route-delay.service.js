import {routeDistance} from '../helpers/geo.js';
import {epoch} from '../config/database.js';

export function process({active,departed,source,destination,packet,settings,at,condition,pulse,state,route}) {
  const metres=routeDistance([packet.longitude,packet.latitude],route?.geometry);
  if(active&&metres==null)return; // Missing geometry cannot prove recovery.
  const threshold=Number(settings.OR?.alert_time);
  if(active&&(!Number.isFinite(threshold)||threshold<=0)){
    condition('OR',false,at);
    return;
  }
  const offRouteEpisode=state.conditions.OR;
  const wasOffRoute=offRouteEpisode?.sentAt!=null;
  const onRoute=metres!=null&&metres<threshold;
  const fields={off_route_in_km:metres==null?null:Number((metres/1000).toFixed(3))};
  condition('OR',active&&departed&&!source&&!destination&&metres!=null&&!onRoute,at,
    {off_route:'OFF_ROUTE',deviation_metres:metres,...fields});
  if(active&&wasOffRoute&&onRoute)pulse('ON_ROUTE',at,at,{episode_key:offRouteEpisode.event_key,off_route:'ON_ROUTE',...fields});
}

export function scan({shipment,active,now,condition,state}) {
  const due=epoch(shipment.expected_completion_at);
  const delayed=active&&due!=null&&now>due;
  if(delayed)state.conditions.DD ||= {since:due,start_lat:state.latitude??null,start_lng:state.longitude??null};
  condition('DD',delayed,now);
}
