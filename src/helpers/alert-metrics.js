const codeById={2:'LH',3:'DO',5:'OR',6:'DD',7:'OS',8:'SFN',9:'DISC',12:'IDL',13:'IGN_OFF',14:'IGN_ON',15:'ONL'};
const durationFields={LH:'long_halt_minutes',IDL:'idle_minutes',SFN:'network_gap_minutes',DO:'offline_minutes',DISC:'disconnected_minutes',IGN_OFF:'ignition_off_minutes',DD:'delay_minutes'};
export const metricColumns=Object.values(durationFields);
export function alertMetrics(input){
  const code=input.code||codeById[input.alert_id];
  const duration=Math.max(0,Number(input.duration_minutes??(input.at-input.start_at)/60000)||0);
  const metrics=Object.fromEntries(metricColumns.map(field=>[field,null]));
  if(durationFields[code])metrics[durationFields[code]]=duration;
  const ignition=input.ignition_status ?? (code==='IGN_OFF'?false:code==='IGN_ON'?true:null);
  return {duration_minutes:duration,...metrics,ignition_status:ignition==null?null:Number(ignition)};
}
