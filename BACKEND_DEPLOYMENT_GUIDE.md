# Backend Server Deployment Guide

## 🔍 What is Your Backend Server?

Your backend server is the Express.js API in the `server/` folder that handles:
- Authentication (login, signup)
- Case management
- Payments
- AI services
- File uploads
- All API endpoints

**Currently:** It only runs on `localhost:3000` (your computer)

**You need to:** Deploy it to a cloud platform so it's accessible on the internet

---

## 📍 Where is Your Backend Server?

### Currently: ❌ Not Deployed
- Location: Only runs on your local machine
- URL: `http://localhost:3000` (only works on your computer)
- Status: **Not accessible from Vercel deployment**

### You Need: ✅ Deployed to Cloud
- Location: A cloud hosting platform
- URL: `https://your-backend.railway.app` (or similar)
- Status: **Accessible from anywhere on the internet**

---

## 🚀 How to Deploy Your Backend Server

You have several options. Here are the easiest ones:

### Option 1: Railway (Recommended - Easiest) ⭐

1. **Sign up at Railway:** https://railway.app
   - Click "Start a New Project"
   - Connect your GitHub account

2. **Create New Project:**
   - Select "Deploy from GitHub repo"
   - Choose your `enyayasetu` repository

3. **Configure Service:**
   - Railway will auto-detect Node.js
   - Set **Root Directory:** `./` (root of repo)
   - Set **Start Command:** `npm run server`
   - Set **Watch Paths:** `server/**`

4. **Add Environment Variables:**
   Click "Variables" tab and add:
   ```
   DB_HOST=<YOUR_DB_HOST>
   DB_PORT=3306
   DB_USER=<YOUR_DB_USER_OR_NAME>
   DB_PASSWORD=<YOUR_DB_PASSWORD>
   DB_NAME=<YOUR_DB_USER_OR_NAME>
   JWT_SECRET=your-secret-key-change-this-to-random-32-characters
   API_PORT=3000
   NODE_ENV=production
   ```

5. **Deploy:**
   - Railway will automatically deploy
   - Wait for "Deploy Successful"

6. **Get Your URL:**
   - Click on your service
   - Click "Settings"
   - Click "Generate Domain"
   - Copy the URL (e.g., `https://enyayasetu-backend.up.railway.app`)
   - **This is your backend URL! 🎉**

---

### Option 2: Render

1. **Sign up at Render:** https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub account

2. **Configure Service:**
   - Repository: Select your `enyayasetu` repo
   - Root Directory: Leave blank
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm run server`
   - Instance Type: Free tier is fine

3. **Add Environment Variables:**
   Same as Railway (DB_HOST, DB_USER, etc.)

4. **Deploy:**
   - Click "Create Web Service"
   - Wait for deployment

5. **Get Your URL:**
   - Render gives you a URL automatically
   - Format: `https://your-service.onrender.com`
   - **This is your backend URL! 🎉**

---

### Option 3: Fly.io

1. **Install Fly CLI:**
   ```bash
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Sign up:** https://fly.io (run `flyctl auth signup`)

3. **Create Fly App:**
   ```bash
   cd your-project-directory
   flyctl launch
   ```

4. **Configure:**
   - Answer prompts
   - Add environment variables in `fly.toml` or via dashboard

5. **Deploy:**
   ```bash
   flyctl deploy
   ```

6. **Get Your URL:**
   - Format: `https://your-app.fly.dev`
   - **This is your backend URL! 🎉**

---

## 🔧 Configure Vercel to Use Your Backend

Once you have your backend URL:

1. **Go to Vercel Dashboard:**
   - https://vercel.com/dashboard
   - Click on your `enyayasetu` project

2. **Settings → Environment Variables:**
   - Click "Add New"
   - Name: `VITE_API_URL`
   - Value: Your backend URL (e.g., `https://enyayasetu-backend.up.railway.app`)
   - **Do NOT include `/api`** - the code adds it automatically
   - Apply to: Production, Preview, Development

3. **Redeploy:**
   - Go to "Deployments" tab
   - Click the "..." menu on latest deployment
   - Click "Redeploy"
   - Or push a new commit to trigger redeploy

---

## ✅ Verify It's Working

After deployment:

1. **Test Backend Health:**
   - Visit: `https://your-backend-url.railway.app/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

2. **Test API Endpoint:**
   - Visit: `https://your-backend-url.railway.app/api`
   - Should return JSON with available endpoints

3. **Test from Frontend:**
   - Your Vercel app should now successfully call the backend
   - Login should work!

---

## 🎯 Quick Summary

1. **Deploy backend** to Railway/Render/Fly.io → Get URL
2. **Add `VITE_API_URL`** environment variable in Vercel → Set to your backend URL
3. **Redeploy** Vercel app → Done!

---

## 🆘 Troubleshooting

### Backend URL Not Working?
- Check backend logs in Railway/Render dashboard
- Verify environment variables are set correctly
- Test `/health` endpoint in browser

### Still Getting 404 Errors?
- Make sure `VITE_API_URL` doesn't include `/api` at the end
- Clear browser cache and hard refresh
- Check Vercel build logs for any errors

### Database Connection Issues?
- Verify DB credentials in backend environment variables
- Check that database allows connections from backend IP
- Test database connection locally first

---

## 📝 Example Configuration

**Backend deployed on Railway:**
- Backend URL: `https://enyayasetu-api.up.railway.app`
- Vercel `VITE_API_URL`: `https://enyayasetu-api.up.railway.app`

**Backend deployed on Render:**
- Backend URL: `https://enyayasetu-backend.onrender.com`
- Vercel `VITE_API_URL`: `https://enyayasetu-backend.onrender.com`

The frontend will automatically append `/api` when making requests, so the final URL will be:
- `https://your-backend-url.com/api/auth/signin` ✅
