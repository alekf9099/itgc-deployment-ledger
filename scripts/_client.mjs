/**
 * 관리 스크립트용 DB 연결
 *
 * 사내망에서 Postgres 기본 포트(5432) 아웃바운드가 차단되어 있는 경우가 있어,
 * Neon 호스트일 때는 WebSocket(443) 경유 드라이버를 씁니다. 이 드라이버는
 * pg 와 인터페이스가 같아 질의문은 그대로 둡니다.
 *
 * 서버(api/)는 Vercel 에서 실행되고 포트 제약이 없으므로 계속 pg 를 사용합니다.
 * 여기서만 경로를 바꾸는 이유입니다.
 */
export async function connect() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('POSTGRES_URL 또는 DATABASE_URL 환경변수를 설정하십시오.');
    process.exit(1);
  }

  const isNeon = /\.neon\.tech/.test(connectionString);

  if (isNeon) {
    const [{ Client, neonConfig }, ws] = await Promise.all([
      import('@neondatabase/serverless'),
      import('ws'),
    ]);
    neonConfig.webSocketConstructor = ws.default;
    const client = new Client(connectionString);
    await client.connect();
    console.log('연결: Neon WebSocket (443)');
    return client;
  }

  const pg = (await import('pg')).default;
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('연결: PostgreSQL (5432)');
  return client;
}
