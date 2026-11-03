export function process({active,packet,settings,at,condition}) {
  condition('OS',active&&packet.speed>Number(settings.OS?.threshold_value??50),at);
}
