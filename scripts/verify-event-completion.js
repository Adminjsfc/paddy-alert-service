import assert from 'node:assert/strict';
import {createPool} from '../src/config/database.js';
import {apply,finishTrip} from '../src/repositories/AlertEventRepository.js';
const pool=createPool(),connection=await pool.getConnection();
try{
  const [[schema]]=await connection.query('SHOW CREATE TABLE tbl_vehicle_alert_event');
  const ddl=schema['Create Table'].replace('CREATE TABLE','CREATE TEMPORARY TABLE')
    .replace(/^\s*CONSTRAINT .*FOREIGN KEY.*\n/gm,'').replace(/,\n\)/g,'\n)');
  await connection.query(ddl);
  await connection.query('CREATE TEMPORARY TABLE shipments (id INT,trip_status INT,status VARCHAR(20),trip_completed_at DATETIME,delivered_at DATETIME)');
  await connection.query('CREATE TEMPORARY TABLE shipment_events (shipment_id INT,event_type VARCHAR(40),occurred_at DATETIME)');
  await connection.query("INSERT INTO shipments VALUES (1,1,'IN_TRANSIT',NULL,NULL),(2,2,'ARRIVED','2026-11-05 12:00:00',NULL),(3,2,'DELIVERED',NULL,'2026-11-05 12:05:00'),(4,0,'CANCELLED',NULL,NULL),(5,2,'ARRIVED',NULL,NULL)");
  await connection.query("INSERT INTO shipment_events VALUES (4,'CANCELLED','2026-11-05 12:10:00')");
  const expected=[null,'2026-11-05 12:00:00','2026-11-05 12:05:00','2026-11-05 12:10:00',null];
  for(let id=1;id<=5;id++){
    const event={action:'CLOSE',alert_id:7,event_key:'completion-test-'+id,start_at:Date.parse('2026-11-05T10:00:00Z'),at:Date.parse('2026-11-05T10:01:00Z')};
    await apply(connection,{id,vehicle_no:'TEST-VEHICLE'},event);
    let [[row]]=await connection.execute('SELECT status,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[event.event_key]);
    assert.equal(row.end_date_time,'2026-11-05 10:01:00','Alert closes at its recovery time');
    await finishTrip(connection,id);
    [[row]]=await connection.execute('SELECT status,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[event.event_key]);
    assert.equal(row.end_date_time,'2026-11-05 10:01:00');assert.equal(Number(row.status),0);
    await apply(connection,{id,vehicle_no:'TEST-VEHICLE'},{...event,action:'UPSERT',at:event.start_at+30000});
    [[row]]=await connection.execute('SELECT status,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[event.event_key]);
    assert.equal(Number(row.status),0,'Old progress cannot reopen a recovered/finished event');
    assert.equal(row.end_date_time,'2026-11-05 10:01:00');
    await apply(connection,{id,vehicle_no:'TEST-VEHICLE'},{...event,action:'UPSERT',at:event.start_at+180000,speed:120});
    [[row]]=await connection.execute('SELECT duration_minutes,speed,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[event.event_key]);
    assert.equal(Number(row.duration_minutes),1,'Late progress cannot extend an already recovered episode');
    assert.equal(row.speed,null);assert.equal(row.end_date_time,'2026-11-05 10:01:00');
    const open={...event,event_key:'open-'+id,action:'UPSERT'};
    await apply(connection,{id,vehicle_no:'TEST-VEHICLE'},open);
    await finishTrip(connection,id);
    [[row]]=await connection.execute('SELECT status,end_date_time FROM tbl_vehicle_alert_event WHERE event_key=?',[open.event_key]);
    assert.equal(row.end_date_time,expected[id-1]);
    assert.equal(Number(row.status),expected[id-1]?0:1);
  }
  console.log('Verified alert recovery closes immediately during a running trip; trip completion only closes unresolved episodes and never overwrites a recovery time. Temporary tables only.');
}finally{connection.release();await pool.end();}
