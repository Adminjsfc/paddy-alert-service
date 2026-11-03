import {epoch} from '../config/database.js';

export function hasCoordinates(value){
  if(value?.latitude==null||value?.longitude==null||value.latitude===''||value.longitude==='')return false;
  const latitude=Number(value.latitude),longitude=Number(value.longitude);
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180;
}

export function seedLastLocation(state,candidates,now=Date.now()){
  if(hasCoordinates(state))return state;
  const latest=candidates.filter(candidate=>candidate&&candidate.gps_fix!==false&&hasCoordinates(candidate))
    .map(candidate=>({...candidate,timestamp:epoch(candidate.timestamp??candidate.last_gps_at)}))
    .filter(candidate=>Number.isFinite(candidate.timestamp)&&candidate.timestamp<=now)
    .sort((a,b)=>b.timestamp-a.timestamp)[0];
  if(!latest)return state;
  return {...state,latitude:Number(latest.latitude),longitude:Number(latest.longitude),
    location_gps_at:latest.timestamp};
}
