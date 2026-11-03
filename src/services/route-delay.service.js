import {routeDistance} from '../helpers/geo.js';
import {epoch} from '../config/database.js';

export function process({active,departed,source,destination,packet,settings,at,condition,pulse,state,route}) {
  const metres=routeDistance([packet.longitude,packet.latitude],route?.geometry);
  if(active&&metres==null)return; // Missing geometry cannot prove recovery.
  const wasOffRoute=state.conditions.OR?.sentAt!=null;
  const onRoute=metres!=null&&metres<=Number(settings.OR?.threshold_value??200);
  const fields={off_route_in_km:metres==null?null:Number((metres/1000).toFixed(3))};
  condition('OR',active&&departed&&!source&&!destination&&metres!=null&&!onRoute,at,
    {off_route:'OFF_ROUTE',...fields});
  if(active&&wasOffRoute&&onRoute)pulse('ON_ROUTE',at,at,{off_route:'ON_ROUTE',...fields});
}

export function scan({shipment,active,now,condition,state}) {
  const due=epoch(shipment.expected_completion_at);
  const delayed=active&&due!=null&&now>due;
  if(delayed)state.conditions.DD ||= {since:due,start_lat:state.latitude??null,start_lng:state.longitude??null};
  condition('DD',delayed,now);
}
