export function process({active,packet,settings,at,condition}) {
  const limit=Number(settings.OS?.alert_time);
  condition('OS',active&&Number.isFinite(limit)&&limit>0&&packet.speed>limit,at);
}
