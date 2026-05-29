# Troubleshooting Guide

## Issue: Add-ons Not Loading

**Problem:** "Failed to load add-ons" error appears on the pricing page.

**Solution:**
1. **Restart the server** - The new `/api/addons` route needs to be loaded:
   ```bash
   # Stop the current server (Ctrl+C)
   # Then restart:
   npm run server:dev
   ```

2. **Check if addons table exists** in your database:
   - Run the migration: `mysql/migrations/007_wallet_payment_system.sql`
   - Or check in phpMyAdmin if the `addons` table exists

3. **Verify database connection** - Check your `.env` file has correct credentials

## Issue: Login Failing

**Problem:** Login shows "Sign up failed" or "Login Failed" errors.

**Possible Causes:**

1. **Server not running** - Make sure the backend server is running on port 3000
   ```bash
   npm run server:dev
   ```

2. **Database connection issue** - Check `.env` file:
   ```env
   DB_HOST=<YOUR_DB_HOST>
   DB_USER=<YOUR_DB_USER_OR_NAME>
   DB_PASSWORD=<YOUR_DB_PASSWORD>
   DB_NAME=<YOUR_DB_USER_OR_NAME>
   ```

3. **User doesn't exist** - If using test credentials, make sure you've run:
   ```bash
   npm run create-test-data
   ```

4. **Check browser console** - Open DevTools (F12) and check the Console tab for detailed error messages

## Quick Fixes

### Restart Both Servers
```bash
# Stop all running servers (Ctrl+C in each terminal)
# Then start both:
npm start
```

### Check Server Status
```bash
# Check if port 3000 is in use
netstat -ano | findstr ":3000"

# Check if port 8080 is in use  
netstat -ano | findstr ":8080"
```

### Test API Endpoints
```bash
# Test addons endpoint
curl http://localhost:3000/api/addons?status=active

# Test auth endpoint (should return error without credentials, but should connect)
curl -X POST http://localhost:3000/api/auth/signin -H "Content-Type: application/json" -d "{\"email\":\"test@test.com\",\"password\":\"test\"}"
```

## Common Errors

### "Network error" or "Failed to fetch"
- **Cause:** Backend server not running or wrong API URL
- **Fix:** Start server with `npm run server:dev` and check `.env` has `VITE_API_URL=http://localhost:3000/api`

### "Invalid email or password"
- **Cause:** User doesn't exist in database
- **Fix:** Run `npm run create-test-data` to create test users, or register a new account

### "Failed to load add-ons"
- **Cause:** Addons table doesn't exist or server needs restart
- **Fix:** Run migration `007_wallet_payment_system.sql` and restart server

