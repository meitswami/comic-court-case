# Deploying Backend on Vercel - Simple Guide

## ✅ What I Just Did

I've configured your project so the backend can run on Vercel alongside your frontend!

### Files Created:
1. **`vercel.json`** - Tells Vercel how to handle your Express.js backend
2. **`api/index.js`** - Serverless function entry point for your backend API

### Files Modified:
1. **`server/index.js`** - Updated to work in both local and Vercel environments

---

## 🚀 How to Deploy (Super Simple!)

### Step 1: Add Environment Variables in Vercel

1. Go to https://vercel.com/dashboard
2. Click on your **enyayasetu** project
3. Go to **Settings** → **Environment Variables**
4. Add these variables (click "Add New" for each):

```
DB_HOST = <YOUR_DB_HOST>
DB_PORT = 3306
DB_USER = <YOUR_DB_USER_OR_NAME>
DB_PASSWORD = <YOUR_DB_PASSWORD>
DB_NAME = <YOUR_DB_USER_OR_NAME>
JWT_SECRET = [generate a random 32+ character string]
API_PORT = 3000
NODE_ENV = production
```

**Important:** 
- For `JWT_SECRET`, generate a random string (you can use: https://randomkeygen.com/)
- Make sure to select **Production**, **Preview**, and **Development** for each variable

### Step 2: Commit and Push to GitHub

```bash
git add .
git commit -m "Add Vercel backend configuration"
git push
```

Vercel will automatically detect the changes and redeploy!

### Step 3: That's It! 🎉

Your backend API will now be available at:
- **`https://enyayasetu.vercel.app/api/auth/signin`**
- **`https://enyayasetu.vercel.app/api/cases`**
- **`https://enyayasetu.vercel.app/health`** (health check)

**No need to set `VITE_API_URL`!** The frontend will automatically use the same domain.

---

## ✅ Verify It's Working

After deployment:

1. **Check Health Endpoint:**
   - Visit: `https://enyayasetu.vercel.app/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

2. **Check API Info:**
   - Visit: `https://enyayasetu.vercel.app/api`
   - Should show available endpoints

3. **Test Login:**
   - Go to `https://enyayasetu.vercel.app/auth`
   - Try logging in - it should work now! 🎉

---

## 🔍 How It Works

- **Frontend:** Served as static files from Vercel
- **Backend:** Runs as serverless functions on Vercel
- **Same Domain:** Both use `enyayasetu.vercel.app`
- **API Routes:** All `/api/*` requests go to your Express server

---

## 🐛 Troubleshooting

### Still Getting 404 Errors?

1. **Check Vercel Deployment Logs:**
   - Go to Vercel Dashboard → Your Project → Deployments
   - Click on the latest deployment
   - Check "Functions" tab for any errors

2. **Verify Environment Variables:**
   - Make sure all DB variables are set correctly
   - Check that `JWT_SECRET` is set

3. **Check Build Logs:**
   - Look for any errors during the build process
   - Make sure `api/index.js` is being built

### Database Connection Issues?

- Verify your Hostinger database allows connections from Vercel's IPs
- Check that DB credentials are correct in Vercel environment variables
- Test database connection locally first

---

## 📝 Summary

**Before:** Backend only ran locally on `localhost:3000`  
**After:** Backend runs on Vercel at `https://enyayasetu.vercel.app/api/*`

**What Changed:**
- ✅ Created `vercel.json` configuration
- ✅ Created `api/index.js` serverless entry point
- ✅ Updated `server/index.js` to work in Vercel

**What You Need to Do:**
1. Add environment variables in Vercel
2. Push to GitHub
3. Done! 🎉

---

## 🎯 Your Backend URL

Since everything is on Vercel, your backend URL is simply:
**`https://enyayasetu.vercel.app`**

The frontend automatically appends `/api` when making requests, so:
- Frontend calls: `/api/auth/signin`
- Actually goes to: `https://enyayasetu.vercel.app/api/auth/signin` ✅

No configuration needed! It just works! 🚀
