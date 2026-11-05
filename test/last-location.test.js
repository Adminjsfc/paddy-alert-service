import test from 'node:test';
import assert from 'node:assert/strict';
import {hasCoordinates,seedLastLocation} from '../src/helpers/last-location.js';
import {seedCommunicationBaseline} from '../src/helpers/communication-gap.js';
import {evaluate} from '../src/services/alert.service.js';

test('Missing dispatch/start timestamps use the last known communication baseline without inventing trip dates',()=>{
  const start=Date.UTC(2026,10,5,10),now=start+50*60000;
  const shipment={id:2,status:'IN_TRANSIT',trip_status:1,dispatched_at:null,trip_started_at:null,created_at:new Date(start)};
  const state=seedCommunicationBaseline({},shipment,{last_gps_at:new Date(start+20*60000)},now);
  assert.equal(state.communicationBaselineAt,start+20*60000);
  assert.equal(state.lastLiveAt,undefined);assert.equal(shipment.trip_started_at,null);
  const configs=[{id:3,alert_short_name:'DO',active:1,alert_time:30,alert_name:'Offline'}];
  const early=evaluate(shipment,state,configs,null,now-1000);assert.equal(early.alerts.length,0);
  const due=evaluate(shipment,early.state,configs,null,now);assert.equal(due.alerts.length,1);
  assert.equal(due.alerts[0].code,'DO');
  assert.equal(seedCommunicationBaseline(due.state,shipment,{last_gps_at:new Date(now)},now),due.state);
});

test('Communication fallback excludes future timestamps and preserves existing live clocks',()=>{
  const start=Date.UTC(2026,10,5,10),shipment={created_at:new Date(start)};
  const result=seedCommunicationBaseline({},shipment,{last_gps_at:new Date(start+1000)},start);
  assert.equal(result.communicationBaselineAt,start);
  const live={lastLiveAt:start-1000};assert.equal(seedCommunicationBaseline(live,shipment,null,start),live);
});
test('Offline location fallback uses the most recent known fix without resetting live clocks',()=>{
  const state={lastLiveAt:100,watermark:200,conditions:{DO:{since:100}}};
  const result=seedLastLocation(state,[{latitude:23,longitude:85,timestamp:500},{latitude:24,longitude:86,last_gps_at:600}],1000);
  assert.equal(result.latitude,24);assert.equal(result.longitude,86);assert.equal(result.location_gps_at,600);
  assert.equal(result.lastLiveAt,100);assert.equal(result.watermark,200);assert.deepEqual(result.conditions,state.conditions);
});
test('Future, missing, invalid and no-fix coordinates are not fabricated',()=>{
  assert(!hasCoordinates({latitude:null,longitude:null}));
  assert.deepEqual(seedLastLocation({},[{latitude:23,longitude:85,timestamp:2000},{latitude:91,longitude:85,timestamp:1},{latitude:23,longitude:85,timestamp:1,gps_fix:false}],1000),{});
});
test('Already recorded alert-state coordinates are preserved',()=>{
  const state={latitude:23.5,longitude:85.5};
  assert.equal(seedLastLocation(state,[{latitude:24,longitude:86,timestamp:100}],1000),state);
});
