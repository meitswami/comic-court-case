# Environment Variables for Vercel

Copy and paste these environment variables into Vercel:

## Database Configuration (Hostinger MySQL)

```
DB_HOST=<YOUR_DB_HOST>
DB_PORT=3306
DB_USER=<YOUR_DB_USER_OR_NAME>
DB_PASSWORD=<YOUR_DB_PASSWORD>
DB_NAME=<YOUR_DB_USER_OR_NAME>
```

## JWT Secret (Security)

**Generate a random 32+ character string first!**

You can use: https://randomkeygen.com/
Or use this command: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Example format (DO NOT USE THIS - GENERATE YOUR OWN):**
```
JWT_SECRET=abc123xyz456def789ghi012jkl345mno678pqr901stu234vwx567
```

**Important:** Use a different random string for production! Don't share this secret!

## Server Configuration

```
API_PORT=3000
NODE_ENV=production
```

---

## 📋 How to Add These in Vercel

1. Go to https://vercel.com/dashboard
2. Click on your **enyayasetu** project
3. Go to **Settings** → **Environment Variables**
4. For each variable above:
   - Click **"Add New"**
   - Paste the **name** (e.g., `DB_HOST`)
   - Paste the **value** (e.g., `<YOUR_DB_HOST>`)
   - Select **Production**, **Preview**, and **Development**
   - Click **"Save"**

5. Repeat for all variables

---

## ⚠️ Important Notes

- **JWT_SECRET**: Generate a unique random string - don't use the example!
- **DB_PASSWORD**: Make sure it's correct (already set to: `<YOUR_DB_PASSWORD>`)
- Select all environments (Production, Preview, Development) for each variable
- After adding all variables, redeploy your project

---

## ✅ Quick Copy-Paste for Vercel

Here's the format you'll use in Vercel (replace JWT_SECRET with your generated value):

| Variable Name | Value |
|--------------|-------|
| DB_HOST | <YOUR_DB_HOST> |
| DB_PORT | 3306 |
| DB_USER | <YOUR_DB_USER_OR_NAME> |
| DB_PASSWORD | <YOUR_DB_PASSWORD> |
| DB_NAME | <YOUR_DB_USER_OR_NAME> |
| JWT_SECRET | **[GENERATE YOUR OWN - 32+ characters]** |
| API_PORT | 3000 |
| NODE_ENV | production |
