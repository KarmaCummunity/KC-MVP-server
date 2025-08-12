# פריסה ל־Railway (Backend + Frontend + Postgres + Redis)

מדריך קצר לפריסה של המערכת ל־Railway כשני שירותים נפרדים: `backend` (NestJS) ו־`web` (Expo Web על Nginx), עם תוספי Postgres ו־Redis.

## דרישות מקדימות
- חשבון Railway
- התקנת Railway CLI מקומית (אופציונלי): `npm i -g @railway/cli`
- קישור המאגר ל־GitHub מומלץ לפריסות אוטומטיות

## סקירת ארכיטקטורה
- Backend: תיקייה `KC-MVP-server` (NestJS).
- Frontend Web: תיקייה `MVP` (Expo export + Nginx).
- מסדי נתונים: Railway Plugins ל־Postgres ו־Redis.

## שירותי Railway
### 1) יצירת פרויקט והוספת תוספים
- צור Project חדש ב־Railway.
- הוסף תוספים (Plugins): Postgres, Redis.

### 2) שירות Backend (NestJS)
- צור Service חדש מתוך התיקייה `KC-MVP-server` (דרך GitHub או CLI):
  - CLI (אופציונלי):
    ```bash
    cd KC-MVP-server
    railway up --service backend
    ```
- משתני סביבה חשובים (Railway קובע חלק מהם אוטומטית):
  - Database:
    - מומלץ: `DATABASE_URL` (נוצר אוטומטית ע"י תוסף Postgres)
    - או: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE=require`
  - Redis:
    - `REDIS_URL` (אם זמין), או `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
    - אם זה Upstash: נתמך גם `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_USERNAME`, `UPSTASH_REDIS_PASSWORD`
    - להכריח TLS: `REDIS_TLS=true` (אם נדרש)
  - CORS:
    - `CORS_ORIGIN` = דומיין הפרונט (למשל `https://<web-subdomain>.up.railway.app`)
  - Google Places (אופציונלי):
    - `GOOGLE_API_KEY`

> השרת מקשיב ל־`PORT` של Railway אוטומטית (`0.0.0.0`).

### 3) שירות Web (Nginx + Expo export)
- צור Service חדש מתוך התיקייה `MVP` (דרך GitHub או CLI):
  - CLI (אופציונלי):
    ```bash
    cd MVP
    railway up --service web
    ```
- משתני סביבה לשירות ה־Web:
  - `BACKEND_BASE_URL` = כתובת ציבורית של הבקאנד, למשל:
    - `https://<backend-subdomain>.up.railway.app`
  - (בזמן בנייה) ברירת המחדל כבר מוגדרת כך שהאפליקציה תקרא ל־`/api` כנתיב יחסי, וה־Nginx יעשה proxy ל־`BACKEND_BASE_URL`.

## בדיקות מהירות
- בקרו ב־URL של שירות ה־Web. ודאו שניתן לבצע פעולות היוצרות קריאות ל־`/api/...`.
- בדקו בריאות Redis: `https://<backend>/health/redis`.
- בדקו בריאות כללית: `https://<backend>/`.

## הערות טכניות רלוונטיות לקוד
- Backend:
  - מודול Postgres תומך ב־`DATABASE_URL` ובסט ה־PG* הסטנדרטי.
  - מודול Redis תומך ב־`REDIS_URL`/`REDIS_*` וגם משתני Upstash, עם `REDIS_TLS`.
- Web:
  - Nginx משתמש בתבנית קונפיגורציה עם `envsubst` כדי להזריק `BACKEND_BASE_URL` בזמן ריצה.
  - קבצי JS מבצעים קריאות ל־`/api` כברירת מחדל; ה־proxy מנתב ל־Backend.

## טיפים
- אם תרצו דומיין מותאם לפרונט/בקאנד, הוסיפו Custom Domain לכל שירות והגדירו את `CORS_ORIGIN` בהתאם.
- לוגים: לוח ה־Railway מציג את לוגי השירותים.


