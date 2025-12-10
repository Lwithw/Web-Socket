import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
const instanceId = crypto.randomUUID();

export let redisEnabled = false;
let pub: Redis | null = null;
let sub: Redis | null = null;

type BroadcastMessage = {
  from: string;
  type: "broadcast";
  room: string;
  data: any;
};

type SignalMessage = {
  from: string;
  type: "signal";
  to: string;
  payload: any;
};

type RedisPayload = BroadcastMessage | SignalMessage;

export async function initRedis(): Promise<boolean> {
  if (!redisUrl) return false;
  pub = new Redis(redisUrl);
  sub = new Redis(redisUrl);

  await Promise.all([pub.ping(), sub.ping()]);
  await sub.subscribe("ws:broadcast", "ws:signal");

  redisEnabled = true;
  return true;
}

export function publishBroadcast(room: string, data: any) {
  if (!redisEnabled || !pub) return;
  const payload: BroadcastMessage = { from: instanceId, type: "broadcast", room, data };
  pub.publish("ws:broadcast", JSON.stringify(payload));
}

export function publishSignal(to: string, payload: any) {
  if (!redisEnabled || !pub) return;
  const msg: SignalMessage = { from: instanceId, type: "signal", to, payload };
  pub.publish("ws:signal", JSON.stringify(msg));
}

export function onRedisMessage(handler: (msg: RedisPayload) => void) {
  if (!redisEnabled || !sub) return;
  sub.on("message", (_channel, message) => {
    try {
      const parsed: RedisPayload = JSON.parse(message);
      if (!parsed || parsed.from === instanceId) return; // skip self
      handler(parsed);
    } catch {
      // ignore malformed
    }
  });
}

export const redisInstanceId = instanceId;

