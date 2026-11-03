import test from 'node:test';
import assert from 'node:assert/strict';
import {alertMetrics} from '../src/helpers/alert-metrics.js';
test('Each sustained alert stores its own duration metric; instant/speed/route alerts use shared fields',()=>{
  for(const [alert_id,field] of [[2,'long_halt_minutes'],[3,'offline_minutes'],[6,'delay_minutes'],[8,'network_gap_minutes'],[9,'disconnected_minutes'],[12,'idle_minutes'],[13,'ignition_off_minutes']]){
    const metrics=alertMetrics({alert_id,start_at:1000,at:91000});
    assert.equal(metrics.duration_minutes,1.5);assert.equal(metrics[field],1.5);
  }
  for(const alert_id of [5,7,14,15])assert.equal(alertMetrics({alert_id,duration_minutes:0}).duration_minutes,0);
  assert.equal(alertMetrics({alert_id:13}).ignition_status,0);
  assert.equal(alertMetrics({alert_id:14}).ignition_status,1);
});
