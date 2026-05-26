# Deployment Checklist - Security Fixes

## ⚠️ CRITICAL: Before Deploying

### 1. Set JWT_SECRET Environment Variable

The application will **NOT START** without this variable set.

**Generate a secure secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Set in your environment:**

**Development (.env file):**
```bash
JWT_SECRET=your-generated-secret-here
```

**Production (environment variables):**
```bash
# DO NOT commit this to git!
export JWT_SECRET=your-generated-secret-here
```

**Verify it's set:**
```bash
cd backend
node -e "require('dotenv').config(); console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'SET ✅' : 'NOT SET ❌')"
```

---

## 2. Test Locally First

```bash
cd backend
npm install
npm run dev
```

**Expected:** Server starts successfully  
**If it fails:** Check that JWT_SECRET is set in your `.env` file

---

## 3. Test Authentication Endpoints

### Test 1: Milestone Creation (Should Require Auth)
```bash
# Without auth - should fail with 401
curl -X POST http://localhost:4000/profiles/testuser/milestones \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","targetAmount":"100","assetCode":"XLM"}'

# Expected: {"error":"Unauthorized: Missing or invalid token"}
```

### Test 2: Avatar Upload (Should Require Auth)
```bash
# Without auth - should fail with 401
curl -X POST http://localhost:4000/profiles/testuser/avatar \
  -F "avatar=@test.jpg"

# Expected: {"error":"Unauthorized: Missing or invalid token"}
```

### Test 3: Profile Listing (Should Work)
```bash
# Should work without auth
curl http://localhost:4000/profiles

# Expected: {"profiles":[...],"total":...}
```

---

## 4. Verify Changes

**Check the files were modified:**
```bash
cd backend
git diff src/auth.ts src/app.ts
```

**You should see:**
- ✅ JWT_SECRET validation added in `auth.ts`
- ✅ `requireAuth` added to milestone endpoints in `app.ts`
- ✅ `requireAuth` added to avatar upload in `app.ts`
- ✅ Duplicate GET /profiles removed from `app.ts`
- ✅ `logger` imported and used in `auth.ts`

---

## 5. Update Production Environment

### Set Environment Variables
```bash
# On your production server/platform
export JWT_SECRET=your-production-secret-here
export SUPABASE_URL=your-supabase-url
export SUPABASE_SERVICE_ROLE_KEY=your-supabase-key
# ... other env vars
```

### Deploy
```bash
git add backend/src/auth.ts backend/src/app.ts
git commit -m "fix: critical security issues - add auth to milestones/avatar, require JWT_SECRET"
git push origin main
```

---

## 6. Post-Deployment Verification

### Check Server Logs
```bash
# Server should start successfully
# Look for: "Server listening on port 4000" or similar
```

### Test Production Endpoints
```bash
# Replace with your production URL
PROD_URL="https://your-api.com"

# Test profile listing (should work)
curl $PROD_URL/profiles

# Test milestone creation without auth (should fail)
curl -X POST $PROD_URL/profiles/testuser/milestones \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","targetAmount":"100"}'

# Expected: 401 Unauthorized
```

---

## 7. Monitor for Issues

After deployment, monitor:
- ✅ Server starts successfully
- ✅ Existing authenticated users can still access their profiles
- ✅ Milestone/avatar endpoints reject unauthenticated requests
- ✅ No 500 errors in logs related to auth

---

## Rollback Plan (If Needed)

If something goes wrong:

```bash
# Revert the changes
git revert HEAD

# Or checkout previous commit
git checkout <previous-commit-hash>

# Redeploy
git push origin main
```

---

## Summary of Changes

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /profiles/:username/milestones` | ❌ No auth | ✅ Requires auth + ownership |
| `PATCH /profiles/:username/milestones/:id` | ❌ No auth | ✅ Requires auth + ownership |
| `DELETE /profiles/:username/milestones/:id` | ❌ No auth | ✅ Requires auth + ownership |
| `POST /profiles/:username/avatar` | ❌ No auth | ✅ Requires auth + ownership |
| `GET /profiles` | ⚠️ Duplicate route | ✅ Single working route |
| JWT Secret | ⚠️ Insecure default | ✅ Required, no default |
| Error logging | ⚠️ console.error | ✅ Structured logger |

---

## Questions?

If you encounter any issues:
1. Check that JWT_SECRET is set
2. Check server logs for error messages
3. Verify the changes were applied correctly
4. Test locally before deploying to production

**All security fixes are backward compatible** except for the JWT_SECRET requirement.
