# KC-MVP Server (NestJS + Postgres + Redis)

שרת NestJS לאפליקציית Karma Community עם Postgres ו-Redis, ו־REST גנרי תואם ל־`DatabaseService` בפרונט.

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