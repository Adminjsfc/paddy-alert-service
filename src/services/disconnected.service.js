import {checkCommunicationGap} from '../helpers/communication-gap.js';

export function process(context) {
  checkCommunicationGap(context,'DISC');
}
