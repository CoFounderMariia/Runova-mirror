# How to Check YouCam API Logs

## Log File Location
Logs are saved to: `logs/youcam_api_YYYYMMDD.log`

## What to Look For

### 1. First Poll Response
Look for this section in the logs:
```
FIRST POLL RESPONSE
Status Code: 200
Full Response:
{ ... }
```

This shows **exactly** what the YouCam API returns on the first request.

### 2. Key Information to Check

**Status Code:**
- `200` = Request successful
- `400` = Bad request (check request format)
- `401` = Authentication failed (check API key)
- `403` = Access forbidden (wrong API key)
- `404` = Endpoint not found (wrong URL)

**Response Structure:**
Look for these keys in the response:
- `status` - Should be "success" or "completed" when done
- `data` - Contains results or task_id
- `error` - Contains error message if failed
- Metric keys: `acne`, `redness`, `moisture`, `pores`, `texture`, etc.

### 3. Common Issues

**If you see `task_id` but no metrics:**
- API is still processing
- Continue polling

**If you see an `error` field:**
- Check the error message
- Verify API key and endpoint

**If response is empty or unexpected:**
- Check endpoint URL
- Verify request format matches API docs

## How to View Logs

### Option 1: Check log file
```bash
cd /Users/mary/runova_mirror
tail -100 logs/youcam_api_*.log
```

### Option 2: Check terminal where server is running
The server prints logs to the terminal where it was started.

### Option 3: Search for specific entries
```bash
cd /Users/mary/runova_mirror
grep "FIRST POLL" logs/youcam_api_*.log
grep "Timeout" logs/youcam_api_*.log
grep "error" logs/youcam_api_*.log -i
```

## After Running Analysis

1. Run a skin analysis from the frontend
2. Check the log file: `logs/youcam_api_YYYYMMDD.log`
3. Look for "FIRST POLL RESPONSE" section
4. Share the response structure to diagnose the issue












