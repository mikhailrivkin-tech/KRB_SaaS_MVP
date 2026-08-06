# 🚀 Пошаговое Руководство по Бесплатному Деплою KRB SaaS MVP (GitHub + Vercel + Render)

Данный документ описывает быстрый и 100% бесплатный деплой приложения из вашего **GitHub** в публичный доступ с SSL-сертификатом `https://`.

---

## 🛠️ Шаг 1: Загрузка проекта в ваш GitHub

1. Создайте новый публичный или приватный репозиторий на [GitHub](https://github.com/new) (например, `KRB_SaaS_MVP`).
2. Загрузите файлы проекта в GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of KRB SaaS MVP"
   git branch -M main
   git remote add origin https://github.com/ВАШ_ЛОГИН/KRB_SaaS_MVP.git
   git push -u origin main
   ```

---

## ⚙️ Шаг 2: Деплой Бэкенда на Render.com (Бесплатно)

1. Зарегистрируйтесь / войдите на [Render.com](https://dashboard.render.com/) через ваш GitHub аккаунт.
2. Нажмите **New +** $\rightarrow$ **Web Service**.
3. Выберите ваш GitHub репозиторий `KRB_SaaS_MVP`.
4. Заполните настройки:
   - **Name**: `krb-saas-api`
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npx prisma generate && npx prisma db push && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
5. В разделе **Environment Variables** добавьте ключи:
   - `JWT_SECRET` = `krb_secret_super_key_2026`
   - `GEMINI_API_KEY` = *(ваш Google Gemini API ключ)*
6. Нажмите **Create Web Service**.  
   *Через 2-3 минуты ваш API будет доступен по адресу:* `https://krb-saas-api.onrender.com`.

---

## 🎨 Шаг 3: Деплой Фронтенда на Vercel (Бесплатно)

1. Зарегистрируйтесь / войдите на [Vercel.com](https://vercel.com/) через GitHub.
2. Нажмите **Add New...** $\rightarrow$ **Project**.
3. Выберите ваш репозиторий `KRB_SaaS_MVP`.
4. Настройки проекта:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `client`
5. Нажмите **Deploy**.  
   *Через 1 минуту ваш сайт будет запущен на бесплатном домене:* `https://krb-saas.vercel.app`!

---

## 🔄 Автоматические Обновления (CI/CD)
Каждый раз, когда вы делаете `git push` в репозиторий GitHub — **Vercel и Render автоматически подтягивают новые изменения и обновляют живой сайт за несколько секунд**!
