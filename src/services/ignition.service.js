export function process({active,packet,state,at,condition,pulse}) {
  condition('IGN_OFF',active&&packet.ignition===false,at);
  if(active&&state.ignition===false&&packet.ignition===true)pulse('IGN_ON',at,at);
  state.ignition=packet.ignition;
}
