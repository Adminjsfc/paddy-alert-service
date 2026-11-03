export function process({active,departed,source,destination,packet,settings,at,condition}) {
  condition('LH',active&&departed&&!source&&!destination&&packet.speed<=Number(settings.LH?.threshold_value??1),at);
}
