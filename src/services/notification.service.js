import * as repository from '../repositories/NotificationRepository.js';

// Called only after the alert/notification SQL transaction commits.
export async function publishPending(connection,redis,limit=500){
  let count=0;
  for(const row of await repository.pending(connection,limit)){
    await redis.publishNotification({...row,userId:row.user_id});
    await repository.markPublished(connection,row.delivery_id);count++;
  }
  return count;
}
