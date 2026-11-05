import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../src/services/alert.service.js';
import {createLifecycle} from '../src/helpers/alert-lifecycle.js';
import {alertMaster} from '../src/config/alert-master.js';
const start=Date.UTC(2026,10,5,10);
const shipment={id:55,status:'IN_TRANSIT',trip_status:1,dispatched_at:new Date(start),
  source_lat:23,source_lng:85,source_radius_m:200,destination_lat:24,destination_lng:86,destination_radius_m:200};
const configs=overrides=>alertMaster.map(({status,...row})=>({...row,active:status,...overrides?.[row.alert_short_name]}));
const packet=(minutes,extra={})=>({timestamp:start+minutes*60000,latitude:23.5,longitude:85.5,
  speed:0,gps_fix:true,ignition:true,live:true,networkSearching:false,...extra});
const matches=(result,code)=>result.alerts.filter(alert=>alert.code===code);

test('Overspeed alert_time is a km/h limit, emits immediately, and does not repeat before recovery',()=>{
  const rules=configs({OS:{alert_time:70,alert_reminder_time:1}});
  let result=evaluate(shipment,{},rules,packet(0,{speed:70}));assert.equal(matches(result,'OS').length,0);
  result=evaluate(shipment,result.state,rules,packet(1,{speed:71}));assert.equal(matches(result,'OS').length,1);
  result=evaluate(shipment,result.state,rules,packet(3,{speed:80}));assert.equal(matches(result,'OS').length,0);
  result=evaluate(shipment,result.state,rules,packet(4,{speed:70}));
  result=evaluate(shipment,result.state,rules,packet(5,{speed:71}));assert.equal(matches(result,'OS').length,1);
  assert.equal(matches(evaluate(shipment,{},configs({OS:{alert_time:0}}),packet(0,{speed:99})),'OS').length,0);
});

test('Long halt sends exactly two notifications at T and 2T, ignoring generic reminder columns',()=>{
  const rules=configs({LH:{alert_time:3,alert_reminder_time:1,alert_interval:1}});let state={},times=[];
  for(let minute=0;minute<=10;minute++){
    const result=evaluate(shipment,state,rules,packet(minute));state=result.state;
    times.push(...matches(result,'LH').map(()=>minute));
  }
  assert.deepEqual(times,[3,6]);
});

test('Idle sends one notification at configured minutes and speed 1 is no longer idle',()=>{
  const rules=configs({IDL:{alert_time:2,alert_reminder_time:1}});let state={},times=[];
  for(let minute=0;minute<=5;minute++){
    const result=evaluate(shipment,state,rules,packet(minute));state=result.state;
    times.push(...matches(result,'IDL').map(()=>minute));
  }
  assert.deepEqual(times,[2]);
  const recovered=evaluate(shipment,state,rules,packet(6,{speed:1}));assert(!recovered.state.conditions.IDL);
});

test('Communication alerts require positive minute thresholds and send once per outage',()=>{
  const rules=configs({DO:{alert_time:30,alert_reminder_time:1},SFN:{alert_time:0},DISC:{alert_time:0}});
  let result=evaluate(shipment,{},rules,null,start+29*60000);assert.equal(matches(result,'DO').length,0);
  result=evaluate(shipment,result.state,rules,null,start+30*60000);assert.equal(matches(result,'DO').length,1);
  result=evaluate(shipment,result.state,rules,null,start+40*60000);assert.equal(matches(result,'DO').length,0);
  assert(!result.state.conditions.SFN);assert(!result.state.conditions.DISC);
});

test('Off-route columns are 200/500/1000 metre milestones, at most three increasing-distance alerts',()=>{
  const state={conditions:{},latitude:23.5,longitude:85.5};
  const rules=configs({OR:{alert_time:200,alert_reminder_time:500,alert_interval:1000}});
  const times=[];
  for(const [index,metres] of [200,300,500,500,1000,1500].entries()){
    const life=createLifecycle(shipment,state,rules,null);
    life.condition('OR',true,start+index*1000,{off_route:'OFF_ROUTE',off_route_in_km:metres/1000});
    if(life.alerts.length)times.push(metres);
  }
  assert.deepEqual(times,[200,500,1000]);
  const life=createLifecycle(shipment,state,rules,null);life.condition('OR',false,start+7000);
  assert(!state.conditions.OR);assert(life.events.some(event=>event.action==='CLOSE'));
});

test('Positive duration alerts with alert_time zero are suppressed, while ignition OFF permits zero',()=>{
  const rules=configs(Object.fromEntries(['LH','IDL','DO','SFN','DISC','IGN_OFF'].map(code=>[code,{alert_time:0}])));
  let result=evaluate(shipment,{},rules,packet(0,{ignition:false}));assert.equal(matches(result,'IGN_OFF').length,1);
  result=evaluate(shipment,result.state,rules,null,start+60000);
  for(const code of ['LH','IDL','DO','SFN','DISC'])assert(!result.state.conditions[code]);
});

test('Delivery delay inserts once per episode even with a legacy five-minute reminder; duration still progresses',()=>{
  const trip={...shipment,expected_completion_at:new Date(start)};
  const rules=configs({DD:{alert_time:0,alert_reminder_time:5}});
  let result=evaluate(trip,{},rules,null,start+60000);
  assert.equal(matches(result,'DD').length,1);const key=matches(result,'DD')[0].episode_key;
  result=evaluate(trip,result.state,rules,null,start+10*60000);
  assert.equal(matches(result,'DD').length,0);
  const progress=result.events.find(event=>event.code==='DD');assert.equal(progress.event_key,key);
  assert.equal(progress.at-progress.start_at,10*60000);
  result=evaluate({...trip,status:'ARRIVED',trip_status:2},result.state,rules,null,start+11*60000);
  assert(result.events.some(event=>event.code==='DD'&&event.action==='CLOSE'));
});
