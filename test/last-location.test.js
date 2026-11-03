import test from 'node:test';
import assert from 'node:assert/strict';
import {hasCoordinates,seedLastLocation} from '../src/helpers/last-location.js';
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
