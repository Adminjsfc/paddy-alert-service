import Redis from 'ioredis';
export function createRedis() {
  const redis=new Redis(process.env.REDIS_URL||'redis://127.0.0.1:6379',{
    lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:1,
    retryStrategy:times=>Math.min(times*250,5000)
  });
  redis.on('error',()=>{});
  return redis;
}
