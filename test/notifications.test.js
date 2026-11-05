import test from 'node:test';
import assert from 'node:assert/strict';
import {publishPending} from '../src/services/notification.service.js';
import {save} from '../src/repositories/NotificationRepository.js';

test('Shared notification content is inserted once and duplicate recipient IDs are collapsed',async()=>{
  const calls=[];
  const connection={execute:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT'))return [[{id:10,alert_name:'Overspeed'}]];
    return [{insertId:20}];
  }};
  const alert={alert_id:7,event_key:'event',message:'Speed exceeds configured limit',at:1000};
  const count=await save(connection,{id:3,vehicle_no:'JH10AF5535',district_id:4},[alert],[
    {user_id:1,user_source:'CORE'},{user_id:1,user_source:'CORE'},{user_id:2,user_source:'CORE'}
  ]);
  assert.equal(count,1);
  const details=calls.find(call=>call.sql.includes('INSERT INTO tbl_notification_details'));
  assert.deepEqual(details.args,[20,1,'CORE',20,2,'CORE']);
  assert.equal(calls.filter(call=>call.sql.includes('INSERT INTO tbl_notifications')).length,1);
  assert(details.sql.includes('ON DUPLICATE KEY UPDATE id=id'));
  assert.equal(calls[1].args[0],'event');assert.equal(calls[1].args[4],3);
});

test('Notification publication acknowledges only successful Redis sends and preserves failed deliveries for retry',async()=>{
  let marked=0;
  const connection={query:async()=>[[{delivery_id:5,user_id:7,user_source:'CORE',notification_id:20}]],
    execute:async()=>{marked++;return [{affectedRows:1}];}};
  await assert.rejects(publishPending(connection,{publishNotification:async()=>{throw new Error('Redis offline');}}),/Redis offline/);
  assert.equal(marked,0);
  let payload;
  assert.equal(await publishPending(connection,{publishNotification:async row=>{payload=row;}}),1);
  assert.equal(marked,1);assert.equal(payload.userId,7);assert.equal(payload.notification_id,20);
});

test('Invalid recipients fail without inserting notification records',async()=>{
  const connection={execute:async()=>assert.fail('Invalid recipient must not reach SQL')};
  await assert.rejects(save(connection,{id:1},[{alert_id:7}],[{user_id:0,user_source:'CORE'}]),/recipient/);
});
