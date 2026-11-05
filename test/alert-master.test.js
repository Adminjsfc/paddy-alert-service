import test from 'node:test';
import assert from 'node:assert/strict';
import {alertMaster,assertAlertMaster} from '../src/config/alert-master.js';

test('Readiness rejects empty, mismatched or unsafe excluded alert configuration',()=>{
  assert.doesNotThrow(()=>assertAlertMaster(alertMaster));
  assert.throws(()=>assertAlertMaster([]),/db:setup/);
  assert.throws(()=>assertAlertMaster(alertMaster.map(row=>row.id===7?{...row,id:99}:row)),/OS/);
  assert.throws(()=>assertAlertMaster(alertMaster.map(row=>row.id===4?{...row,status:1}:row)),/disabled/);
  assert.throws(()=>assertAlertMaster(alertMaster.map(row=>({...row,status:0}))),/No alert types/);
  assert.equal(alertMaster.filter(row=>row.status).length,12);
});
