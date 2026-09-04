# 디지털 성돌 — 시민의 메시지로 쌓아가는 한양도성

어두운 한양도성 성벽에 시민이 메시지를 남기면, 사진 속 **실제 성돌 하나에 불이 켜집니다.**
켜진 성돌은 데이터베이스에 저장되어 모든 접속자에게 실시간으로 공유되고, 사람이 모일수록 성벽이 밝아집니다.

## 구성

| | |
|---|---|
| 호스팅 · API | **Vercel** (정적 파일 + 서버리스 함수) |
| 데이터베이스 · 실시간 | **Supabase** (Postgres + Realtime) |
| 프런트엔드 | 빌드 도구 없는 순수 HTML · CSS · JS |

```
public/
  index.html          화면 · 오버레이(소개 · 한양도성 이야기 · 실시간 게시판 · 성돌 메시지)
  app.js              불빛 렌더러 · 성돌 표식 · 게시판 · API 호출 · 실시간 구독
  favicon.svg
  assets/
    wall.jpg          배경 사진
    glow.png          성돌 발광 스텐실 (검출된 605개 돌 모양 기준)
    slots.json        성돌 좌표 (참고용)
    og.jpg            공유 카드 이미지
api/
  stones.js           GET 전체 조회 · POST 성돌 놓기 (메시지 최대 200자)
  config.js           브라우저에 공개 키 전달
supabase/
  schema.sql              테이블 · RLS · 함수
  seed_slots.sql          성돌 1000자리 좌표
  alter_message_length.sql  이미 배포한 프로젝트에서 메시지 길이를 200자로 늘릴 때
  add_slots_to_1000.sql     이미 배포한 프로젝트에서 성돌 자리를 1000개로 늘릴 때
```

### 불빛의 원리

`glow.png` 는 배경 사진을 이미지 처리해 **성벽의 돌 605개를 하나씩 검출한 뒤 그 모양대로만 발광 (자리는 조밀화하여 1000개 운영)**하도록 만든 스텐실입니다.
브라우저는 켜진 좌표에만 둥근 마스크를 그리고 `source-in` 합성으로 스텐실을 뚫어 냅니다.
따라서 켜지는 불빛이 항상 사진 속 진짜 돌 모양과 정확히 일치합니다.

---

## 배포 순서

### 1. Supabase 프로젝트 만들기

1. <https://supabase.com> 에서 **New project** 생성 (Region: `Northeast Asia (Seoul)` 권장)
2. 좌측 **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 **Run**
3. 같은 자리에 `supabase/seed_slots.sql` 을 붙여넣고 **Run** → 성돌 1000자리가 등록됩니다
4. **Project Settings → API** 에서 세 값을 복사해 둡니다
   - `Project URL`
   - `anon public` 키 — 공개되어도 되는 키
   - `service_role` 키 — **절대 공개 금지**

> 확인: SQL Editor 에서 `select count(*) from slots;` → `1000` 이 나오면 정상입니다.

### 2. GitHub에 올리기

```bash
cd hanyangdoseong
git init
git add .
git commit -m "디지털 성돌"
git branch -M main
git remote add origin https://github.com/<계정>/hanyangdoseong.git
git push -u origin main
```

### 3. Vercel에 연결하기

1. <https://vercel.com/new> → 방금 만든 저장소 **Import**
2. Framework Preset은 **Other**, 빌드 명령은 비워 둡니다
3. **Environment Variables** 에 네 개를 등록합니다

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_ANON_KEY` | anon public 키 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |
   | `IP_SALT` | 아무 긴 임의 문자열 |

4. **Deploy** → 1분 안에 `https://<프로젝트>.vercel.app` 주소가 나옵니다

### 4. 도메인 연결 (선택)

Vercel 프로젝트 → **Settings → Domains** 에서 보유한 도메인을 추가하고,
안내되는 A 레코드 또는 CNAME 을 도메인 등록기관 DNS 에 넣으면 SSL 까지 자동 적용됩니다.

---

## 로컬에서 실행하기

```bash
npm i -g vercel
npm install
cp .env.example .env      # 값을 채워 넣으세요
vercel dev                # http://localhost:3000
```

---

## 안전장치

| 항목 | 처리 |
|---|---|
| 자리 중복 | `place_stone()` 이 빈 자리를 원자적으로 차지 — 동시 요청에도 한 자리에 한 명 |
| 메시지 길이 | 1–200자. `api/stones.js` 의 `MAX_LEN`, `schema.sql` 의 `check` 제약, `place_stone()` 세 곳을 함께 맞춰야 합니다 |
| 도배 방지 | 같은 IP 1분에 3회 (`api/stones.js` 의 `MAX_PER_IP`) |
| 비속어 | `BLOCKLIST` 배열 — 운영하며 채워 넣으세요 |
| 개인정보 | IP 원문은 저장하지 않고 salt 를 섞은 SHA-256 해시만 기록 |
| 권한 | 브라우저 anon 키는 **읽기 전용**. 쓰기는 서버의 service_role 키로만 |

`service_role` 키는 `api/` 안에서만 쓰이며 브라우저로 절대 전송되지 않습니다.

---

## 운영 중 자주 하는 일

**남겨진 메시지 보기**
```sql
select created_at, message from stones order by created_at desc limit 100;
```

**부적절한 성돌 끄기** (자리를 다시 비워 다른 사람이 쓸 수 있게 합니다)
```sql
delete from stones where id = 123;
```

**성돌 자리를 1000개로 늘리기 (이미 배포한 프로젝트)**
`supabase/add_slots_to_1000.sql` 을 SQL Editor 에 붙여넣고 Run 하면 605 → 1000개가 됩니다.
(새로 배포하는 경우 `seed_slots.sql` 에 이미 1000개가 들어 있어 따로 실행할 필요가 없습니다.)

**성벽이 가득 찼을 때 — 두 번째 구간 열기**
성벽 사진을 한 장 더 준비해 같은 방식으로 좌표를 뽑아 `slots` 에 이어 붙이거나,
`slots` 에 `section` 열을 추가해 구간을 나누면 됩니다.

**속도 제한 조정**
`api/stones.js` 상단의 `WINDOW_MS`, `MAX_PER_IP` 값을 바꾸고 다시 배포하세요.

**메시지 길이를 이미 배포한 프로젝트에서 늘리기**
`supabase/alter_message_length.sql` 을 SQL Editor 에 붙여넣고 Run 하면 50자 → 200자로 바뀝니다.
(새로 배포하는 경우 `schema.sql` 에 이미 반영돼 있어 따로 실행할 필요가 없습니다.)

---

## 비용

두 서비스의 무료 플랜으로 시작할 수 있습니다.
Supabase 무료 플랜은 500MB 데이터베이스와 동시접속 200명 규모의 Realtime 을 제공하므로,
성돌 1000개 규모의 캠페인에는 넉넉합니다. 대규모 홍보로 동시접속이 크게 늘어날 것 같다면
Supabase Pro 플랜과 Vercel Pro 플랜을 미리 검토하세요.
