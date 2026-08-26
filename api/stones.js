// =====================================================================
//  POST /api/stones   { message }  → 빈 성돌 자리에 메시지를 새깁니다
//  GET  /api/stones               → 지금까지 켜진 성돌 전체
//
//  service_role 키는 이 서버 함수 안에서만 쓰이며 브라우저로 나가지 않습니다.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const WINDOW_MS   = 60 * 1000; // 1분 동안
const MAX_PER_IP  = 3;         // 같은 사람은 3번까지

// 노출하고 싶지 않은 낱말 — 운영하면서 채워 넣으세요
const BLOCKLIST = ['씨발', '개새', '병신', 'ㅅㅂ', 'ㅂㅅ'];

function hashIp(req) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  return crypto
    .createHash('sha256')
    .update(ip + (process.env.IP_SALT || 'hanyangdoseong'))
    .digest('hex');
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('stones')
        .select('slot, message, created_at, slots(x, y)')
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) throw error;

      const stones = (data || []).map((r) => ({
        slot: r.slot,
        message: r.message,
        x: r.slots?.x,
        y: r.slots?.y,
        created_at: r.created_at,
      }));

      const { data: stats } = await supabase.from('stone_stats').select('*').single();
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=30');
      return res.status(200).json({ stones, stats });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const message = String(req.body?.message ?? '').trim();
    if (message.length < 1 || message.length > 50) {
      return res.status(400).json({ error: 'MESSAGE_LENGTH' });
    }
    const lowered = message.toLowerCase();
    if (BLOCKLIST.some((w) => lowered.includes(w))) {
      return res.status(400).json({ error: 'BLOCKED_WORD' });
    }

    // ── 속도 제한 ────────────────────────────────────────────────
    const ipHash = hashIp(req);
    const since  = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_PER_IP) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    }

    // ── 빈 자리 하나를 원자적으로 차지 ───────────────────────────
    const { data, error } = await supabase.rpc('place_stone', { msg: message });
    if (error) {
      if (error.message?.includes('WALL_FULL')) {
        return res.status(409).json({ error: 'WALL_FULL' });
      }
      throw error;
    }

    await supabase.from('submissions').insert({ ip_hash: ipHash });

    const { data: slot } = await supabase
      .from('slots')
      .select('x, y')
      .eq('idx', data.slot)
      .single();

    return res.status(201).json({
      stone: { slot: data.slot, message: data.message, x: slot?.x, y: slot?.y },
    });
  } catch (err) {
    console.error('[stones]', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}
