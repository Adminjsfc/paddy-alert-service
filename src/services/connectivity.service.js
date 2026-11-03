import {checkCommunicationGap} from '../helpers/communication-gap.js';

export function process({freshLive,state,packet,now,pulse,condition}) {
  if(!freshLive)return;

  const wasOffline=['SFN','DO','DISC'].some(code=>state.conditions[code]?.sentAt!=null);
  if(wasOffline)pulse('ONL',packet.timestamp,packet.timestamp);

  state.lastLiveAt=now;
  condition('DO',false,packet.timestamp);
  condition('DISC',false,packet.timestamp);
}

export function scan(context) {
  checkCommunicationGap(context,'DO');
}
