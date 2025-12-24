# Changelog

## [1.7.7] - 2025-12-24

### Fixed
- **תיקון קריטי: שגיאת Foreign Key Constraints בטבלאות Posts**
  - פתרנו שגיאה שגרמה לנפילת השרת ב-Railway-dev: `column "id" referenced in foreign key constraint does not exist`
  - השגיאה התרחשה כאשר טבלאות ישנות (`posts`, `post_comments`) היו קיימות במבנה שונה מהמבנה הנדרש
  - התיקון: שינינו את בדיקות קיום הטבלאות ב-3 בלוקים של `DO $$` להיות יותר מקיפות

### Technical Details - Foreign Key Validation
במקום לבדוק רק שהטבלה קיימת:
```sql
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'posts') THEN
```

כעת בודקים גם שהעמודה הספציפית קיימת:
```sql
IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'id'
) THEN
```

### Blocks Updated
1. **post_likes foreign keys** (schema.sql:595-622)
   - `post_likes.post_id` → `posts(id)`
   - `post_likes.user_id` → `user_profiles(id)`

2. **post_comments foreign keys** (schema.sql:641-668)
   - `post_comments.post_id` → `posts(id)`
   - `post_comments.user_id` → `user_profiles(id)`

3. **comment_likes foreign keys** (schema.sql:692-719)
   - `comment_likes.comment_id` → `post_comments(id)`
   - `comment_likes.user_id` → `user_profiles(id)`

### Impact
- ✅ השרת עולה בהצלחה ב-Railway-dev גם כאשר יש טבלאות ישנות
- ✅ מונע שגיאות foreign key constraint בעתיד
- ✅ תואם לאחור - עובד גם עם דאטאבייס ריק וגם עם דאטאבייס קיים
- ✅ אין מחיקה של נתונים קיימים - רק דילוג על הוספת constraints אם המבנה לא תקין

### Prevention Strategy
התיקון מונע בעיות דומות בעתיד על ידי:
1. בדיקה מפורטת יותר של מבנה הטבלאות לפני הוספת constraints
2. תיעוד מפורט בהערות הקוד על הסיבה לבדיקות אלו
3. גישה "fail-safe" - אם המבנה לא תקין, מדלגים במקום לנפול

---

## [1.7.6] - 2025-11-23

### Fixed
- **תיקון שגיאות TypeScript בקונטרולר Challenges:** תיקנו שגיאות קומפילציה ב-`challenges.controller.ts`
  - הוספנו ערכי ברירת מחדל למאפיינים הנדרשים ב-DTOs
  - תיקנו בעיות עם `strictPropertyInitialization` ב-TypeScript
  - השגיאות שתוקנו: `Property 'X' has no initializer and is not definitely assigned in the constructor`

### Technical Details
- שינינו את הגדרת המאפיינים ב-DTOs מ-`name!: string` ל-`name: string = ''`
- זה מאפשר ל-TypeScript בהגדרות strict לקמפל בהצלחה תוך שמירה על התנהגות זהה

### Classes Updated
- `CreateChallengeDto`
- `CreateResetLogDto`
- `CreateRecordBreakDto`

---

## [1.7.5] - 2025-11-23

### Fixed
- **שמירת נתוני ביקורים באתר:** הוספנו את `site_visits` לרשימת הסטטיסטיקות ההתחלתיות כדי למנוע איפוס בעת עדכון השרת
- **Data Persistence:** שיפרנו את מנגנון שמירת הנתונים ב-Railway עם הערות והודעות לוג מפורטות

### Added
- הוספנו הודעות לוג מפורטות (`✨ Created` / `✅ Preserved`) כדי לעקוב אחר שמירת הסטטיסטיקות
- הוספנו הערות בקוד המסבירות את מנגנון ה-`ON CONFLICT DO NOTHING`
- נוספו מסמכי תיעוד:
  - `RAILWAY_DATA_PERSISTENCE.md` - מדריך מפורט לשמירת נתונים ב-Railway
  - עדכון `RAILWAY.md` עם סעיף על Data Persistence

### Technical Details
- בקובץ `src/database/database.init.ts`:
  - הוספנו `site_visits` לרשימת `defaultStats`
  - שיפרנו את ההודעות ב-console.log כדי להבחין בין יצירת סטטיסטיקה חדשה לשמירת קיימת
  - הוספנו `RETURNING` ל-query כדי לדעת אם הנתון נוצר או נשמר

### Notes
- השינוי מבטיח ש-`site_visits` ושאר הסטטיסטיקות **לא יתאפסו** בעת עדכון השרת ב-Railway
- הנתונים נשמרים באמצעות `ON CONFLICT (stat_type, city, date_period) DO NOTHING`
- **חשוב:** יש לוודא שהשרת מחובר ל-Postgres Plugin של Railway ולא למסד נתונים זמני

---

## [1.7.4] - קודם
- גרסה קודמת


