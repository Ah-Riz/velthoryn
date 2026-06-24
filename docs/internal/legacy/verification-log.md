# Operations Verification Log

## 2026-06-11 — Production curl smoke (T6) — retry

**Test:** `POST /api/campaigns` without auth should return 401.
**Result:** ✅ PASS
**Detail:**
```
$ curl -L -X POST https://velthoryn.site/api/campaigns -H "Content-Type: application/json" -d '{}'
{"error":"Unauthorized","code":"UNAUTHORIZED","requestId":"sin1::b9c5m-1781162867943-2001d2625a30"}
HTTP 401
```
The apex domain `velthoryn.site` redirects (307) to the Vercel deployment; following the redirect, unauth POST returns 401 as expected.
**Action:** None. US2 verified.

---

## Template

### YYYY-MM-DD — <test name>

**Test:** <description>
**Result:** ✅ PASS / ❌ FAIL
**Detail:** <output, observations>
**Action:** <next steps if failed>
