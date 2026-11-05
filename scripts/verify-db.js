import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createPool} from '../src/config/database.js';
import {createRedis} from '../src/config/redis.js';
import {RedisRepository} from '../src/repositories/RedisRepository.js';
import {evaluate} from '../src/services/alert.service.js';
import * as alerts from '../src/repositories/AlertRepository.js';
import * as outbox from '../src/repositories/AlertOutboxRepository.js';
import * as events from '../src/repositories/AlertEventRepository.js';
import {writeJob} from '../src/services/AlertBatchService.js';
import {shipmentColumns} from '../src/repositories/TripRepository.js';
import {load as loadState} from '../src/repositories/AlertStateRepository.js';
import {acquireServiceLock} from '../src/helpers/service-lock.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const pool=createPool(),connection=await pool.getConnection(),client=createRedis();
const redis=new RedisRepository(client,'paddy:gps:verify:'+randomUUID());
try {
  await client.connect();
  const lockKey=redis.prefix+':service:duplicate-check';
  const firstLock=await acquireServiceLock(client,lockKey);
  try {
    await assert.rejects(acquireServiceLock(client,lockKey),error=>error.code==='SERVICE_ALREADY_RUNNING');
    await assert.rejects(promisify(execFile)(process.execPath,['--env-file-if-exists=.env','gps_service.js'],{
      env:{...process.env,PADDY_ALERT_REDIS_PREFIX:redis.prefix,MQTT_CLIENT_ID:'duplicate-check'},timeout:10000
    }),error=>error.code===1&&error.stdout.includes('SERVICE_ALREADY_RUNNING')&&!error.stdout.includes('MQTT_CONNECTED'));
  }
  finally {await firstLock.release();}
  const replacementLock=await acquireServiceLock(client,lockKey);
  try {await firstLock.release();assert(await client.get(lockKey));}
  finally {await replacementLock.release();}
  await connection.query("SET time_zone='+00:00'");
  // Session-only copies keep verification inserts out of real ID counters.
  for(const table of ['tbl_vehicle_alert_event','tbl_vehicle_alerts_details','gps_alert_outbox','tbl_notifications','tbl_notification_details']){
    const [schema]=await connection.query(`SHOW CREATE TABLE ${table}`);
    const ddl=schema[0]['Create Table'].replace('CREATE TABLE','CREATE TEMPORARY TABLE')
      .replace(/^\s*CONSTRAINT .*FOREIGN KEY.*\n/gm,'').replace(/,\n\)/g,'\n)');
    await connection.query(ddl);
    await connection.query(`ALTER TABLE ${table} AUTO_INCREMENT=1`);
  }
  await connection.beginTransaction();
  const [rows]=await connection.query(`SELECT ${shipmentColumns} FROM shipments s JOIN vehicles v ON v.id=s.vehicle_id ORDER BY s.id LIMIT 1`);
  if(!rows.length)throw new Error('Create a shipment before running database verification');
  const now=Math.floor(Date.now()/1000)*1000;
  const shipment={...rows[0],vehicle_active:1,status:'IN_TRANSIT',trip_status:1,dispatched_at:new Date(now-60000)};
  const configs=await alerts.settings(connection);
  const packet={timestamp:now,latitude:23.5,longitude:85.5,speed:99,gps_fix:true,ignition:true,live:true,networkSearching:false};
  const opened=evaluate(shipment,{},configs,packet,now);
  assert(opened.alerts.some(a=>a.alert_id===7));
  const notificationRecipients={recipientResolver:async()=>[
    {user_id:7,user_source:'CORE'},{user_id:8,user_source:'CORE'},{user_id:7,user_source:'CORE'}
  ]};
  async function deliver(result,p){
    const id=await alerts.save(connection,shipment,result,p);
    const row=await outbox.lock(connection,id),job={id,payload:row.payload};
    assert.equal(Number(await redis.publish(job)),1);assert.equal(Number(await redis.publish(job)),0);
    let batch=await redis.claim(10);assert.equal(batch.length,1);
    await redis.recover();batch=await redis.claim(10);assert.equal(batch.length,1);
    assert.equal(await writeJob(connection,JSON.parse(batch[0]),notificationRecipients),true);
    assert.equal(await writeJob(connection,JSON.parse(batch[0]),notificationRecipients),false);
    await redis.acknowledge(batch[0],id);
    assert.equal((await redis.getState(shipment.id)).revision,result.state.revision);
    const restored=await loadState(connection,shipment.id);
    assert.equal(restored.revision,result.state.revision);
    assert.equal(restored.watermark,result.state.watermark);
  }
  await deliver(opened,packet);
  const [notifications]=await connection.query('SELECT id,title FROM tbl_notifications');
  assert.equal(notifications.length,opened.alerts.length);
  const [recipientRows]=await connection.query('SELECT notification_id,user_id,user_source,is_read FROM tbl_notification_details');
  assert.equal(recipientRows.length,notifications.length*2);
  assert(recipientRows.every(row=>row.user_source==='CORE'&&Number(row.is_read)===0));
  await connection.execute('UPDATE tbl_notification_details SET is_read=1 WHERE user_id=7');
  await alerts.insertDetails(connection,shipment,opened.alerts);
  const notificationRepository=await import('../src/repositories/NotificationRepository.js');
  await notificationRepository.save(connection,shipment,opened.alerts,await notificationRecipients.recipientResolver());
  const [readRows]=await connection.query('SELECT is_read FROM tbl_notification_details WHERE user_id=7');
  assert(readRows.every(row=>Number(row.is_read)===1));
  const [notificationCount]=await connection.query('SELECT COUNT(*) n FROM tbl_notifications');
  assert.equal(Number(notificationCount[0].n),notifications.length);
  assert.equal((await redis.getLatestPacket(shipment.vehicle_no)).timestamp,now);
  assert(await client.get(`${redis.prefix}:condition:${shipment.id}:OS`));
  const key=opened.events.find(e=>e.code==='OS').event_key;
  const [details]=await connection.execute('SELECT COUNT(*) total FROM tbl_vehicle_alerts_details WHERE event_key=? AND alert_event_id IS NOT NULL',[opened.alerts.find(a=>a.code==='OS').event_key]);
  assert.equal(Number(details[0].total),1);
  const progress=evaluate(shipment,opened.state,configs,{...packet,timestamp:now+60000},now+60000);
  await deliver(progress,{...packet,timestamp:now+60000});
  const eventColumns='duration_minutes,end_date_time,status,district_id,max_speed,speed';
  let [stored]=await connection.execute(`SELECT ${eventColumns} FROM tbl_vehicle_alert_event WHERE event_key=?`,[key]);
  assert.equal(Number(stored[0].duration_minutes),1);assert.equal(stored[0].end_date_time,null);
  const recovered=evaluate(shipment,progress.state,configs,{...packet,timestamp:now+120000,speed:20},now+120000);
  await deliver(recovered,{...packet,timestamp:now+120000,speed:20});
  assert.equal(await client.get(`${redis.prefix}:condition:${shipment.id}:OS`),null);
  await redis.saveLatestPacket(shipment.vehicle_no,packet);
  assert.equal((await redis.getLatestPacket(shipment.vehicle_no)).timestamp,now+120000);
  await events.apply(connection,shipment,progress.events.find(e=>e.code==='OS'));
  [stored]=await connection.execute(`SELECT ${eventColumns} FROM tbl_vehicle_alert_event WHERE event_key=?`,[key]);
  assert.equal(Number(stored[0].status),0);assert(stored[0].end_date_time);assert.equal(Number(stored[0].duration_minutes),2);
  assert.equal(stored[0].district_id,shipment.district_id??null);
  const [location]=await connection.execute('SELECT district_id FROM tbl_vehicle_alerts_details WHERE event_key=?',[opened.alerts.find(a=>a.code==='OS').event_key]);
  assert.equal(location[0].district_id,shipment.district_id??null);
  assert.equal(Number(stored[0].max_speed),99);assert.equal(Number(stored[0].speed),20);
  const route={geometry:{type:'LineString',coordinates:[[85,23],[86,24]]}};
  const offPacket={...packet,timestamp:now+180000,longitude:85.6,speed:20};
  const offRoute=evaluate(shipment,recovered.state,configs,offPacket,offPacket.timestamp,{route});
  assert(offRoute.alerts.some(alert=>alert.code==='OR'));
  await deliver(offRoute,offPacket);
  let progressing=offRoute;
  for(const [offset,longitude] of [[181000,85.62],[182000,85.64],[183000,85.66]]){
    const sample={...offPacket,timestamp:now+offset,longitude};
    progressing=evaluate(shipment,progressing.state,configs,sample,sample.timestamp,{route});
    await deliver(progressing,sample);
  }
  const onPacket={...packet,timestamp:now+240000,speed:20};
  const onRoute=evaluate(shipment,progressing.state,configs,onPacket,onPacket.timestamp,{route});
  const recovery=onRoute.alerts.find(alert=>alert.code==='ON_ROUTE');assert(recovery);
  await deliver(onRoute,onPacket);
  const [onDetails]=await connection.execute('SELECT off_route,alert_event_id FROM tbl_vehicle_alerts_details WHERE event_key=?',[recovery.event_key]);
  assert.equal(onDetails[0].off_route,'ON_ROUTE');assert(onDetails[0].alert_event_id);
  const [closedRoute]=await connection.execute('SELECT status,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[offRoute.events.find(event=>event.code==='OR').event_key]);
  assert.equal(Number(closedRoute[0].status),0);assert(closedRoute[0].end_date_time);
  const [[episode]]=await connection.execute('SELECT id FROM tbl_vehicle_alert_event WHERE event_key=?',[recovery.episode_key]);
  assert.equal(Number(onDetails[0].alert_event_id),Number(episode.id));
  const [[offDetails]]=await connection.execute('SELECT COUNT(*) total FROM tbl_vehicle_alerts_details WHERE alert_event_id=? AND alert_id=5',[episode.id]);
  assert.equal(Number(offDetails.total),3);
  const [[recoveryEvents]]=await connection.query('SELECT COUNT(*) total FROM tbl_vehicle_alert_event WHERE alert_id=16');
  assert.equal(Number(recoveryEvents.total),0);
  for(const table of ['tbl_vehicle_alerts_details','tbl_vehicle_alert_event']){
    const [columns]=await connection.query(`SHOW COLUMNS FROM ${table}`);
    assert(!columns.some(column=>column.Field==='vehicle_id'));
    if(table==='tbl_vehicle_alert_event')assert(!columns.some(column=>column.Field==='alert_path'));
  }
  for(const [alert_id,field] of [[2,'long_halt_minutes'],[3,'offline_minutes'],[6,'delay_minutes'],[8,'network_gap_minutes'],[9,'disconnected_minutes'],[12,'idle_minutes'],[13,'ignition_off_minutes']]){
    const event_key=createHash('sha256').update(randomUUID()).digest('hex');
    const event={action:'CLOSE',alert_id,event_key,start_at:now,at:now+90000,start_lat:23,start_lng:85,latitude:23.1,longitude:85.1,speed:0};
    await events.apply(connection,shipment,event);
    const [metric]=await connection.execute(`SELECT ${field} value FROM tbl_vehicle_alert_event WHERE event_key=?`,[event_key]);
    assert.equal(Number(metric[0].value),1.5);
    await alerts.insertDetails(connection,shipment,[{...event,event_key:createHash('sha256').update(event_key+'detail').digest('hex'),episode_key:event_key,duration_minutes:1.5,message:'Verification'}]);
  }
  assert.equal(evaluate(shipment,recovered.state,configs,packet,now).result,'OLD_OR_DUPLICATE');
  const [eventIds]=await connection.query('SELECT id FROM tbl_vehicle_alert_event ORDER BY id');
  assert.deepEqual(eventIds.map(row=>Number(row.id)),eventIds.map((row,index)=>index+1));
  await connection.rollback();
  console.log('Redis state/queue, processing recovery, detail deduplication and event open/progress/close verified. SQL verification writes rolled back.');
} finally {
  await connection.rollback();connection.release();await pool.end();
  if(client.status==='ready'){
    let cursor='0';do{const next=await client.scan(cursor,'MATCH',redis.prefix+':*','COUNT',100);cursor=next[0];if(next[1].length)await client.del(...next[1]);}while(cursor!=='0');
  }
  client.disconnect();
}
