export function process({active,departed,packet,settings,at,condition}) {
  condition('IDL',active&&departed&&packet.ignition===true&&packet.speed<=Number(settings.IDL?.threshold_value??1),at);
}
