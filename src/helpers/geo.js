const rad=n=>n*Math.PI/180;
export function distance(a,b) {
  const dlat=rad(b[1]-a[1]),dlon=rad(b[0]-a[0]);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function routeDistance(point,geometry) {
  if(!geometry||geometry.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2)return null;
  let minimum=Infinity;
  const scale=111195,cos=Math.cos(rad(point[1]));
  for(let i=1;i<geometry.coordinates.length;i++){
    const [a,b]=[geometry.coordinates[i-1],geometry.coordinates[i]];
    if(![...a,...b].every(Number.isFinite))return null;
    const ax=(a[0]-point[0])*scale*cos,ay=(a[1]-point[1])*scale;
    const bx=(b[0]-point[0])*scale*cos,by=(b[1]-point[1])*scale;
    const dx=bx-ax,dy=by-ay;
    const t=Math.max(0,Math.min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    minimum=Math.min(minimum,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return minimum;
}
