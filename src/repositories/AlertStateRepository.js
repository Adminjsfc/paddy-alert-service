import {latestState} from './AlertOutboxRepository.js';
export async function load(connection,id,redis=null) {
  const checkpoint=await latestState(connection,id);
  if(redis){
    try {const cached=await redis.getState(id);if(cached&&Number(cached.revision||0)===Number(checkpoint.revision||0))return cached;}
    catch {} // Existing outbox snapshots restore state while Redis recovers.
  }
  return checkpoint;
}
