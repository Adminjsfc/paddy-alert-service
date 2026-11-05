import {excludedAlerts,isRunningTrip} from '../config/alerts.js';
import {createLifecycle} from '../helpers/alert-lifecycle.js';
import {distance} from '../helpers/geo.js';
import {epoch} from '../config/database.js';
import * as overspeed from './overspeed.service.js';
import * as halt from './longHaltService.js';
import * as idle from './idle.service.js';
import * as routeDelay from './route-delay.service.js';
import * as network from './searching-network.service.js';
import * as connectivity from './connectivity.service.js';
import * as ignition from './ignition.service.js';
import * as disconnected from './disconnected.service.js';

export {excludedAlerts} from '../config/alerts.js';

function isOldPacket(shipment,state,packet) {
  if(!packet)return false;
  if(packet.presence_only)return state?.presenceWatermark!=null&&packet.timestamp<=state.presenceWatermark;
  return packet.timestamp<epoch(shipment.dispatched_at)
    || (state?.watermark!=null && packet.timestamp<=state.watermark);
}

function processPacketRules(context) {
  const {shipment,state,packet,now,active,condition}=context;
  const gap=Number(process.env.GPS_MAX_PACKET_GAP_MINUTES||5)*60000;

  if(state.watermark!=null && packet.timestamp-state.watermark>gap) {
    for(const code of ['LH','IDL','IGN_OFF'])condition(code,false,state.watermark);
  }

  state.watermark=packet.timestamp;
  state.speed=packet.speed;
  context.at=packet.timestamp;
  context.freshLive=active && packet.live && now-packet.timestamp<=gap;

  if(packet.gps_fix) {
    state.latitude=packet.latitude;
    state.longitude=packet.longitude;
  }
  connectivity.process(context);

  if(packet.gps_fix) {
    const point=[packet.longitude,packet.latitude];
    context.source=distance(point,[Number(shipment.source_lng),Number(shipment.source_lat)])<=Number(shipment.source_radius_m);
    context.destination=distance(point,[Number(shipment.destination_lng),Number(shipment.destination_lat)])<=Number(shipment.destination_radius_m);

    overspeed.process(context);
    halt.process(context);
    idle.process(context);
    routeDelay.process(context);
  } else {
    for(const code of ['LH','IDL','OS'])condition(code,false,packet.timestamp);
  }

  network.process(context);
  ignition.process(context);
}

function processScheduledRules(context) {
  network.scan(context);
  connectivity.scan(context);
  disconnected.process(context);
  routeDelay.scan(context);

  if(!context.active) {
    for(const code of ['LH','IDL','OS','OR','IGN_OFF']) {
      context.condition(code,false,context.now);
    }
  }
}

export function evaluate(shipment,previous,configs,packet,now=Date.now(),routeContext={}) {
  if(isOldPacket(shipment,previous,packet)) {
    return {state:previous,alerts:[],result:'OLD_OR_DUPLICATE'};
  }

  const state=structuredClone(previous||{});
  state.conditions ||= {};
  state.revision=Number(previous?.revision||0)+1;
  for(const code of excludedAlerts)delete state.conditions[code];

  const lifecycle=createLifecycle(shipment,state,configs,packet);
  const active=isRunningTrip(shipment);
  const context={...routeContext,...lifecycle,shipment,state,packet,now,active,departed:active};

  if(packet?.presence_only){
    state.presenceWatermark=packet.timestamp;
    context.freshLive=active&&packet.live&&now-packet.timestamp<=Number(process.env.GPS_MAX_PACKET_GAP_MINUTES||5)*60000;
    connectivity.process(context);
    if(context.freshLive)context.condition('SFN',false,packet.timestamp);
  }
  else if(packet)processPacketRules(context);
  else processScheduledRules(context);

  return {state,alerts:lifecycle.alerts,events:lifecycle.events,result:'PROCESSED'};
}
