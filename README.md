# KC-MVP Server (NestJS + Postgres + Redis)

שרת NestJS לאפליקציית Karma Community עם Postgres ו-Redis, ו־REST גנרי תואם ל־`DatabaseService` בפרונט.

**גרסה נוכחית:** 2.5.2  
**עדכון אחרון:** 2025-12-24 - בדיקת Redis בפרודקשן

## 🆕 מה חדש בגרסה 2.5.2

- ✅ **הפרדת סביבות מוחלטת:** Development ו-Production מופרדים לחלוטין
- ✅ **בדיקות אוטומטיות:** סקריפטים לבדיקת משתני סביבה והפרדה
- ✅ **אבטחה משופרת:** בדיקה בעת startup שמונעת חיבור של dev ל-prod DB
- ✅ **תיעוד מקיף:** מדריכים מפורטים להגדרת Railway והעתקת DB
- ✅ **GitHub Actions:** בדיקות אוטומטיות לפני כל deploy
- 🔍 **בדיקת Redis בפרודקשן:** סקריפטים לבדיקה ותיקון Redis

**⚠️ נמצאה בעיה:** Redis לא מוגדר בפרודקשן! ראה `FIX_REDIS_PRODUCTION.md`

**ראה:** `FIX_REDIS_PRODUCTION.md`, `TEST_REDIS_PRODUCTION.md`, `RAILWAY_SETUP_GUIDE.md`

## 🌍 סביבות

### Production (main)
- **Domain**: `karma-community-kc.com`
- **Branch**: `main`
- **Database**: Postgres נפרד (ID: 5f1b9d5d) ✅
- **Redis**: ❌ **לא מוגדר - צריך תיקון!** (ראה `FIX_REDIS_PRODUCTION.md`)
- **Purpose**: משתמשים אמיתיים, נתונים אמיתיים

### Development (dev)
- **Domain**: `dev.karma-community-kc.com`
- **Branch**: `dev`
- **Database**: Postgres נפרד (ID: f92654e1) ✅
- **Redis**: Redis נפרד ✅ (password: ggCVffISJOm...)
- **Purpose**: בדיקות, פיתוח, נתונים מאנונימיזציים

## 🚀 הפעלה מקומית

```bash
npm install

# הרמת בסיסי נתונים
npm run docker:up

# אתחול סכמות וטבלאות
npm run init:db

# פיתוח
npm run start:dev
```

צרו קובץ `.env`:
```
# Local
PORT=3001
CORS_ORIGIN=http://localhost:8081,http://localhost:19006
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=kc
POSTGRES_PASSWORD=kc_password
POSTGRES_DB=kc_db
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# JWT Secret - חובה! מינימום 32 תווים
# ליצירת secret מאובטח: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long

# Production (Railway/Vercel): השתמשו בערכי הסביבה שמוקצים
# DATABASE_URL=postgres://user:pass@host:5432/dbname
# REDIS_URL=redis://default:pass@host:6379
# JWT_SECRET=your-production-jwt-secret-minimum-32-characters
```

## 📡 Endpoints

- `GET /` — בריאות
- CRUD גנרי לפי קולקציה (תואם ל־collections של DatabaseService):
  - `GET /api/:collection?userId=...` — רשימת פריטים למשתמש
  - `GET /api/:collection/:userId/:itemId` — פריט בודד
  - `POST /api/:collection` — יצירה/עדכון: body `{ id, userId, data }`
  - `PUT /api/:collection/:userId/:itemId` — עדכון: body `{ data }`
  - `DELETE /api/:collection/:userId/:itemId` — מחיקה

טבלאות נוצרות עם PK מורכב `(user_id, item_id)` ועמודת JSONB בשם `data`.

## 🚀 פריסה ב-Railway

הפרויקט מוגדר לפריסה אוטומטית ב-Railway עם **הפרדה מוחלטת** בין סביבות.

### הגדרות הפריסה:
- **Runtime**: V2 (גרסה מתקדמת ומהירה)
- **Builder**: Dockerfile
- **Replicas**: 1 (עותק אחד)
- **Multi-Region**: אירופה המערבית (europe-west4)
- **Restart Policy**: הפעלה מחדש אוטומטית במקרה של כשל
- **Health Check**: בדיקת בריאות אוטומטית

### פריסה - Development:
1. ב-Railway, בחר branch: `dev`
2. ודא שמחובר ל-Postgres-dev ו-Redis-dev
3. הגדר משתני סביבה (ראה `RAILWAY_SETUP_GUIDE.md`):
   ```
   ENVIRONMENT=development
   NODE_ENV=development
   CORS_ORIGIN=https://dev.karma-community-kc.com,http://localhost:19006,...
   JWT_SECRET=<חדש לdev>
   ```
4. Deploy אוטומטי מ-branch `dev`

### פריסה - Production:
1. ב-Railway, בחר branch: `main`
2. ודא שמחובר ל-Postgres-production ו-Redis-production
3. הגדר משתני סביבה:
   ```
   ENVIRONMENT=production
   NODE_ENV=production
   CORS_ORIGIN=https://karma-community-kc.com,https://www.karma-community-kc.com
   JWT_SECRET=<הקיים של production - אל תשנה!>
   ```
4. Deploy אוטומטי מ-branch `main`

**⚠️ חשוב:** 
- אל תשתמש באותו `JWT_SECRET` בשתי הסביבות!
- אל תחבר dev ל-production database!
- הרץ `npm run check:env` לפני deploy

**📚 מדריכים מפורטים:**
- `RAILWAY_SETUP_GUIDE.md` - הגדרת Railway מאפס
- `DB_COPY_GUIDE.md` - העתקת נתונים בין סביבות
- `ENVIRONMENT_SEPARATION.md` - תיעוד מלא על הפרדת סביבות