export function process({active,departed,source,destination,packet,at,condition}) {
  condition('LH',active&&departed&&!source&&!destination&&packet.speed<=1,at);
}
