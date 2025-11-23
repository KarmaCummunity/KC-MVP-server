# KC-MVP Server (NestJS + Postgres + Redis)

שרת NestJS לאפליקציית Karma Community עם Postgres ו-Redis, ו־REST גנרי תואם ל־`DatabaseService` בפרונט.

**גרסה נוכחית:** 1.7.5  
**עדכון אחרון:** 2025-11-23 - תיקון שמירת נתוני ביקורים באתר

## 🆕 מה חדש בגרסה 1.7.5

- ✅ **תיקון חשוב:** נתוני הביקורים באתר (ושאר הסטטיסטיקות) נשמרים כעת בצורה קבועה בין עדכוני השרת
- ✅ הוספנו `site_visits` לסטטיסטיקות ההתחלתיות
- ✅ לוגים משופרים להצגת שמירת/יצירת נתונים
- ✅ תיעוד מפורט על שמירת נתונים ב-Railway

**ראה:** `CHANGELOG.md`, `FIX_SUMMARY.md`, `RAILWAY_DATA_PERSISTENCE.md`

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

# Production (Railway/Vercel): השתמשו בערכי הסביבה שמוקצים
# DATABASE_URL=postgres://user:pass@host:5432/dbname
# REDIS_URL=redis://default:pass@host:6379
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

הפרויקט מוגדר לפריסה אוטומטית ב-Railway באמצעות קובץ `railway.json`.

### הגדרות הפריסה:
- **Runtime**: V2 (גרסה מתקדמת ומהירה)
- **Builder**: Dockerfile
- **Replicas**: 1 (עותק אחד)
- **Multi-Region**: אירופה המערבית (europe-west4)
- **Restart Policy**: הפעלה מחדש אוטומטית במקרה של כשל
- **Health Check**: בדיקת בריאות אוטומטית

### פריסה:
1. התחבר ל-Railway
2. צור פרויקט חדש או התחבר לפרויקט קיים
3. Railway יקרא את `railway.json` ויפרוס אוטומטית
4. האפליקציה תהיה זמינה ב-URL שתקבל