// 브라우저가 Realtime 구독에 쓸 공개 값만 내려보냅니다.
// anon 키는 공개되어도 되는 키이며, RLS 가 읽기만 허용합니다.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
}
