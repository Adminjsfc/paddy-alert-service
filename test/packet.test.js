import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePacket} from '../src/helpers/packet.js';
const now=Date.UTC(2026,9,24,10,0,0);
const input={packet_header:'$PVT',vehicle_number:'JH01AB1234',date_time:'24102026 100000',gps_timestamp:1,gps_fix:'1',latitude:'23.1',longitude:'85.1',speed:'51',ignition_status:'1'};
test('Paddy UTC date_time takes precedence over a faulty supplied epoch',()=>{
 const packet=normalizePacket('gps/JH01AB1234/data',input,now);
 assert.equal(packet.timestamp,now);assert.equal(packet.ignition,true);assert.equal(packet.speed,51);
});
test('Only PVT packets are accepted; login, heartbeat and missing headers are skipped',()=>{
 for(const packet_header of ['$LGN','$HEL',undefined,null,''])
  assert.throws(()=>normalizePacket('gps/JH01AB1234/data',{...input,packet_header},now),e=>e.message==='Unsupported packet header');
 for(const packet_header of ['$PVT','PVT'])
  assert.equal(normalizePacket('gps/JH01AB1234/data',{...input,packet_header},now).latitude,23.1);
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
