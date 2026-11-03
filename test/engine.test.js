import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../src/services/alert.service.js';
import {routeDistance} from '../src/helpers/geo.js';
const start=Date.UTC(2026,9,24,10);
const shipment={id:1,vehicle_id:2,vehicle_active:1,status:'IN_TRANSIT',trip_status:1,source_lat:23,source_lng:85,source_radius_m:200,destination_lat:24,destination_lng:86,destination_radius_m:200,dispatched_at:new Date(start-60000),expected_completion_at:new Date(start+60000)};
const codes=['DA','LH','DO','GF','OR','DD','OS','SFN','DISC','DIST_DEV','WE','IDL','IGN_OFF','IGN_ON','ONL','ON_ROUTE'];
const configs=codes.map((code,index)=>({id:index+1,alert_name:code,alert_short_name:code,active:1,alert_time:{LH:3,DO:30,DISC:1440,SFN:10,IDL:10}[code]??null,threshold_value:{OS:50,LH:1,IDL:1,OR:200}[code]??0}));
const p=(time=0,extra={})=>({timestamp:start+time,latitude:23.5,longitude:85.5,speed:0,gps_fix:true,ignition:true,live:true,networkSearching:false,...extra});
const run=(state,packet,context={})=>evaluate(shipment,state,configs,packet,packet?.timestamp??start,context);
const has=(result,code)=>result.alerts.some(a=>a.alert_id===codes.indexOf(code)+1);

test('Polyline deviation emits off-route, then one on-route recovery and closes the off-route event',()=>{
 const context={route:{geometry:{type:'LineString',coordinates:[[85,23],[86,24]]}}};
 const outside=p(0,{longitude:85.6});
 const off=run({},outside,context);assert(has(off,'OR'));assert(!has(off,'ON_ROUTE'));
 const recovered=run(off.state,p(1000),context);
 assert(has(recovered,'ON_ROUTE'));assert(!has(recovered,'OR'));
 assert.equal(recovered.alerts.find(a=>a.code==='ON_ROUTE').off_route,'ON_ROUTE');
 assert(recovered.events.some(e=>e.code==='OR'&&e.action==='CLOSE'));
 assert(recovered.events.some(e=>e.code==='ON_ROUTE'&&e.action==='CLOSE'));
 assert(!has(run(recovered.state,p(2000),context),'ON_ROUTE'));
 assert.equal(run(recovered.state,p(1000),context).result,'OLD_OR_DUPLICATE');
 assert(!has(run({},p(0),context),'ON_ROUTE'));
});
test('Missing geometry or GPS fix cannot invent on-route recovery',()=>{
 const context={route:{geometry:{type:'LineString',coordinates:[[85,23],[86,24]]}}};
 const off=run({},p(0,{longitude:85.6}),context);
 const noRoute=run(off.state,p(1000));assert(noRoute.state.conditions.OR);assert(!has(noRoute,'ON_ROUTE'));
 const noFix=run(noRoute.state,p(2000,{gps_fix:false}),context);assert(noFix.state.conditions.OR);assert(!has(noFix,'ON_ROUTE'));
 assert(has(run(noFix.state,p(3000),context),'ON_ROUTE'));
 const ended=evaluate({...shipment,trip_status:2,status:'ARRIVED'},off.state,configs,null,start+5000,context);
 assert(!has(ended,'ON_ROUTE'));assert(!ended.state.conditions.OR);
});
test('Trip status and shipment status control eligibility; vehicle active flag does not',()=>{
 for(const patch of [{trip_status:0},{trip_status:2},{trip_status:null},{status:'CANCELLED'},{status:'PLANNED'},{status:'ARRIVED'}]){
  const trip={...shipment,...patch};
  assert.equal(evaluate(trip,{},configs,p(0,{speed:90})).alerts.length,0);
  assert.equal(evaluate(trip,{},configs,null,start+1440*60000).alerts.length,0);
 }
 assert(has(evaluate(shipment,{},configs,p(0,{speed:90})),'OS'));
 for(const patch of [{vehicle_active:0},{status:'DISPATCHED'},{status:'IN_TRANSIT'}]){
  const trip={...shipment,...patch};
  assert(has(evaluate(trip,{},configs,p(0,{speed:90})),'OS'));
  assert(has(evaluate(trip,{},configs,null,start+1440*60000),'DO'));
 }
 const open=run({},p(0,{speed:90}));
 const inactive=evaluate({...shipment,trip_status:2},open.state,configs,null,start+60000);
 assert.equal(inactive.alerts.length,0);assert(inactive.events.some(e=>e.code==='OS'&&e.action==='CLOSE'));
});
test('Overspeed uses kph threshold, survives restart, deduplicates and starts a new episode after recovery',()=>{
 const a=run({},p(0,{speed:51}));assert(has(a,'OS'));
 assert(!has(run(JSON.parse(JSON.stringify(a.state)),p(1000,{speed:60})),'OS'));
 const recovered=run(a.state,p(2000,{speed:20}));
 const repeated=run(recovered.state,p(3000,{speed:60}));assert(has(repeated,'OS'));
 assert.notEqual(a.alerts[0].event_key,repeated.alerts[0].event_key);
 assert.equal(run(a.state,p(0,{speed:60})).result,'OLD_OR_DUPLICATE');
});
test('Long halt triggers after sustained minutes, outside facility geofences only',()=>{
 let a=run({},p());assert(!has(a,'LH'));
 a=run(a.state,p(180000));assert(has(a,'LH'));
 assert.equal(a.alerts.find(a=>a.alert_id===2).long_halt_minutes,3);
 const inside=run({},p(0,{latitude:23,longitude:85}));assert(!has(run(inside.state,p(180000,{latitude:23,longitude:85})),'LH'));
});
test('Long gaps and no-fix telemetry cannot prove continuous halt or idle',()=>{
 const a=run({},p());assert(!has(run(a.state,p(600000)),'LH'));
 const noFix=run(a.state,p(180000,{gps_fix:false}));assert(!has(noFix,'LH'));assert(!has(noFix,'IDL'));
});
test('Idle, network search and ignition transitions have separate conditions',()=>{
 let a=run({},p(0,{networkSearching:true}));
 for(let t=60000;t<=600000;t+=60000)a=run(a.state,p(t,{networkSearching:true}));
 assert(has(a,'SFN'));assert(has(a,'IDL'));
 const off=run(a.state,p(601000,{ignition:false}));assert(has(off,'IGN_OFF'));
 const on=run(off.state,p(602000,{ignition:true}));assert(has(on,'IGN_ON'));
});
test('Offline and disconnection work without new packets; online only follows an emitted offline alert',()=>{
 const early=evaluate(shipment,{},configs,null,start);assert(!has(early,'DO'));
 assert(!has(run(early.state,p()),'ONL'));
 const offline=evaluate(shipment,{},configs,null,start+30*60000);assert(has(offline,'DO'));
 const disconnected=evaluate(shipment,offline.state,configs,null,start+1440*60000);assert(has(disconnected,'DISC'));
 assert(has(run(disconnected.state,p(1440*60000+1000)),'ONL'));
 assert(!has(evaluate(shipment,disconnected.state,configs,null,start+1440*60000+1000),'DISC'));
});
test('Historical telemetry does not clear offline state or fabricate a recovery',()=>{
 const offline=evaluate(shipment,{},configs,null,start+31*60000);
 const result=evaluate(shipment,offline.state,configs,p(0,{live:false}),start+32*60000);
 assert(!has(result,'ONL'));assert(result.state.conditions.DO);assert(result.state.conditions.SFN);
});
test('A ten-minute packet gap produces the network warning before the thirty-minute offline alert',()=>{
 const result=evaluate(shipment,{},configs,null,start+10*60000);
 assert(has(result,'SFN'));assert(!has(result,'DO'));
 assert(has(run(result.state,p(11*60000)),'ONL'));
});
test('Delivery delay uses planned completion; quantity deviation is excluded even with a shortage',()=>{
 assert(has(evaluate(shipment,{},configs,null,start+120000),'DD'));
 const delivered={...shipment,status:'DELIVERED',trip_status:2,shortage_g:12345};
 const result=evaluate(delivered,{},configs,null,start+120000);
 assert(!has(result,'DA'));assert(!has(result,'DD'));assert(!has(result,'DO'));
 assert(!result.events.some(event=>event.code==='DA'));
});
test('Source/destination crossings never emit geofence alerts, even with GF enabled in settings',()=>{
 const inside=run({},p(0,{latitude:23,longitude:85}));assert(!has(inside,'GF'));
 assert(!has(run(inside.state,p(1000,{latitude:23,longitude:85})),'GF'));
 assert(!has(run(inside.state,p(1000)),'GF'));
 assert(!has(run(inside.state,p(2000,{latitude:24,longitude:86})),'GF'));
});
test('Off-route still requires actual configured geometry',()=>{
 assert(!has(run({},p()),'OR'));
 const result=run({},p(),{route:{geometry:{type:'LineString',coordinates:[[85,23],[85,24]]}}});assert(has(result,'OR'));
 assert(routeDistance([85,23.5],{type:'LineString',coordinates:[[85,23],[85,24]]})<1);
});
test('District deviation and wrong-entry remain excluded even when enabled with matching data',()=>{
 const geometry={type:'Polygon',coordinates:[[[85,23],[86,23],[86,24],[85,24],[85,23]]]};
 const result=run({},p(),{route:{allowed_district_ids:[1]},boundaries:[{district_id:2,geometry}],wrongFacility:{id:99}});
 assert(!has(result,'DIST_DEV'));assert(!has(result,'WE'));
 assert(!has(run({},p()),'DIST_DEV'));
});
test('Alert events open once, update duration without repeat detail, and close on recovery',()=>{
 const startEvent=run({},p(0,{speed:60}));
 const opened=startEvent.events.find(e=>e.code==='OS');
 assert.equal(opened.action,'UPSERT');
 assert.equal(startEvent.alerts.find(a=>a.code==='OS').episode_key,opened.event_key);
 const progress=run(startEvent.state,p(60000,{speed:65}));
 const advanced=progress.events.find(e=>e.code==='OS');
 assert.equal(advanced.event_key,opened.event_key);assert.equal(advanced.at-advanced.start_at,60000);
 assert(!has(progress,'OS'));
 const recovery=run(progress.state,p(120000,{speed:20}));
 const closed=recovery.events.find(e=>e.code==='OS');
 assert.equal(closed.action,'CLOSE');assert.equal(closed.event_key,opened.event_key);
});
test('Threshold timers create events at the threshold and close on shipment completion',()=>{
 const first=run({},p());assert(!first.events.some(e=>e.code==='LH'));
 const halted=run(first.state,p(180000));assert(halted.events.some(e=>e.code==='LH'&&e.start_at===start));
 const done=evaluate({...shipment,status:'DELIVERED',trip_status:2},halted.state,configs,null,start+240000);
 assert(done.events.some(e=>e.code==='LH'&&e.action==='CLOSE'));
});
test('Scheduled evaluation clears excluded legacy conditions without generating GF or district alerts',()=>{
 const result=evaluate(shipment,{conditions:{GF:{since:start},DIST_DEV:{since:start}}},configs,null,start+60000);
 assert(!has(result,'GF'));assert(!has(result,'DIST_DEV'));
 assert(!Object.hasOwn(result.state.conditions,'GF'));assert(!Object.hasOwn(result.state.conditions,'DIST_DEV'));
});
