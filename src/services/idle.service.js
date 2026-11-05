export function process({active,departed,packet,at,condition}) {
  condition('IDL',active&&departed&&packet.ignition===true&&packet.speed<1,at);
}
