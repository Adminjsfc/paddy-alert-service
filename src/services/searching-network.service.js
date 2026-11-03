import {checkCommunicationGap} from '../helpers/communication-gap.js';

export function process({active,freshLive,packet,at,condition}) {
  if(freshLive)condition('SFN',active&&packet.networkSearching,at);
}

export function scan(context) {
  checkCommunicationGap(context,'SFN');
}
