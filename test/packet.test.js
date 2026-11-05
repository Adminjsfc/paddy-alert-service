import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePacket,normalizePresencePacket} from '../src/helpers/packet.js';
import {evaluate} from '../src/services/alert.service.js';
const now=Date.UTC(2026,9,24,10,0,0);
const input={packet_header:'$PVT',vehicle_number:'JH01AB1234',date_time:'24102026 100000',gps_timestamp:1,gps_fix:'1',latitude:'23.1',longitude:'85.1',speed:'51',ignition_status:'1'};
test('Paddy UTC date_time takes precedence over a faulty supplied epoch',()=>{
 const packet=normalizePacket('gps/JH01AB1234/data',input,now);
 assert.equal(packet.timestamp,now);assert.equal(packet.ignition,true);assert.equal(packet.speed,51);
});
test('Position normalization only accepts PVT; login/heartbeat have a separate connectivity path',()=>{
 for(const packet_header of ['$LGN','$HEL',undefined,null,''])
  assert.throws(()=>normalizePacket('gps/JH01AB1234/data',{...input,packet_header},now),e=>e.message==='Unsupported packet header');
 for(const packet_header of ['$PVT','PVT'])
  assert.equal(normalizePacket('gps/JH01AB1234/data',{...input,packet_header},now).latitude,23.1);
});

test('Fresh login/heartbeat proves communication without inventing position, speed or ignition',()=>{
 const raw={...input,packet_header:'$LGN',imei_no:'867937023631771',server_date_time:now};
 const packet=normalizePresencePacket('gps/JH01AB1234/data',raw,now);
 assert.equal(packet.presence_only,true);assert.equal(packet.gps_fix,false);assert.equal(packet.latitude,null);
 assert.equal(packet.speed,undefined);assert.equal(packet.ignition,undefined);
 const shipment={id:1,status:'IN_TRANSIT',trip_status:1,dispatched_at:new Date(now-3600000)};
 const previous={lastLiveAt:now-3600000,watermark:now-1000,latitude:23.2,longitude:85.2,speed:70,ignition:false,
  conditions:{DO:{since:now-3600000,sentAt:now-1800000,event_key:'offline'}}};
 const configs=[{id:3,alert_short_name:'DO',active:1,alert_time:30},
  {id:15,alert_short_name:'ONL',active:1,alert_name:'Online'}];
 const result=evaluate(shipment,previous,configs,packet,now);
 assert.equal(result.state.lastLiveAt,now);assert.equal(result.state.watermark,previous.watermark);
 assert.equal(result.state.latitude,23.2);assert.equal(result.state.speed,70);assert.equal(result.state.ignition,false);
 assert(!result.state.conditions.DO);assert.deepEqual(result.alerts.map(a=>a.code),['ONL']);
 assert(result.events.some(e=>e.code==='DO'&&e.action==='CLOSE'));
 assert.equal(evaluate(shipment,result.state,configs,packet,now).result,'OLD_OR_DUPLICATE');
});

test('Old, retained, historical, wrong-vehicle and unidentified presence packets cannot mark online',()=>{
 const raw={packet_header:'$HEL',imei_no:'867937023631771',vehicle_number:'JH01AB1234',server_date_time:now};
 for(const patch of [{server_date_time:now-10*60000},{server_date_time:now+180000},{is_history:1},
  {vehicle_number:'OTHER'},{imei_no:null},{server_date_time:null}])
  assert.throws(()=>normalizePresencePacket('gps/JH01AB1234/data',{...raw,...patch},now),e=>e.permanent===true);
 assert.throws(()=>normalizePresencePacket('gps/JH01AB1234/data',raw,now,true),/Retained/);
});
test('Invalid dates, mismatched identity, future packets and invalid coordinates are rejected',()=>{
 for(const patch of [{date_time:'31112026 100000'},{vehicle_number:'OTHER'},{date_time:'25102026 100000'},{latitude:91},{gps_fix:null},{speed:-1}])
  assert.throws(()=>normalizePacket('gps/JH01AB1234/data',{...input,...patch},now),e=>e.permanent===true);
});
test('No-fix telemetry can report ignition/network without invented coordinates',()=>{
 const p=normalizePacket('gps/JH01AB1234/data',{...input,gps_fix:0,latitude:null,longitude:null,ignition_status:'0',searching_network:1},now);
 assert.equal(p.latitude,null);assert.equal(p.ignition,false);assert.equal(p.networkSearching,true);
});
test('Epoch seconds/milliseconds normalize identically and historical packets remain historical',()=>{
 for(const gps_timestamp of [now/1000,now]){
  const p=normalizePacket('gps/JH01AB1234/data',{...input,date_time:undefined,gps_timestamp,packet_type:'H'},now);
  assert.equal(p.timestamp,now);assert.equal(p.live,false);
 }
 assert.equal(normalizePacket('gps/JH01AB1234/data',{...input,is_history:1},now).live,false);
 assert.equal(normalizePacket('gps/JH01AB1234/data',{...input,is_live:0},now).live,false);
});
