# Telegram Mini App Troubleshooting Guide

## Current Issue: "Telegram login failed. Please use regular login."

This guide will help you debug and fix the Telegram Mini App login issue.

## Step 1: Check Environment Variables

First, ensure your `.env` file has the correct BOT_TOKEN:

```env
BOT_TOKEN=your_actual_bot_token_from_botfather
```

**Important**: The BOT_TOKEN must be from the same bot that you configured the Mini App with in BotFather.

## Step 2: Verify Bot Configuration

1. **Check BotFather Configuration**:
   - Go to @BotFather in Telegram
   - Use `/mybots` to see your bots
   - Select your bot
   - Go to "Bot Settings" → "Mini App"
   - Verify the Web App URL matches your domain

2. **Test Bot Token**:
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe`
   - Should return bot information if token is valid

## Step 3: Check Debug Information

### Backend Debug Endpoint
Visit: `http://localhost:8080/api/tg/webapp/debug`

This should return:
```json
{
  "bot_token_configured": true,
  "bot_token_length": 46,
  "telegram_webapp_available": true,
  "endpoint_accessible": true
}
```

### Frontend Console
Open browser developer tools and check the console for debug messages:
- `[DEBUG] Starting Telegram login...`
- `[DEBUG] Init data: ...`
- `[DEBUG] Making request to: /api/tg/webapp/login`

### Backend Logs
Check the auth-service container logs:
```bash
docker-compose logs auth-service
```

Look for debug messages starting with `[DEBUG]` or `[ERROR]`.

## Step 4: Common Issues and Solutions

### Issue 1: "Bot token not configured"
**Solution**: 
- Check your `.env` file has `BOT_TOKEN=...`
- Restart the containers: `docker-compose restart auth-service`

### Issue 2: "No Telegram initData available"
**Solution**:
- Make sure you're opening the app from within Telegram
- The app must be opened via the Mini App button, not directly in browser
- Check that the Telegram WebApp SDK is loaded (should see `window.Telegram.WebApp` in console)

### Issue 3: "Invalid signature"
**Solution**:
- Verify the BOT_TOKEN matches the bot that created the Mini App
- Check that the Web App URL in BotFather matches your actual domain
- Ensure you're using HTTPS (required for Telegram Mini Apps)

### Issue 4: "Missing user data"
**Solution**:
- This usually means the initData format is incorrect
- Check the backend logs for the exact initData received
- Verify the Telegram WebApp SDK is properly initialized

## Step 5: Testing Steps

1. **Start the services**:
   ```bash
   docker-compose up
   ```

2. **Check debug endpoint**:
   ```bash
   curl http://localhost:8080/api/tg/webapp/debug
   ```

3. **Open in Telegram**:
   - Go to your bot in Telegram
   - Tap the menu button or Mini App button
   - Check browser console for debug messages
   - Check backend logs for detailed error information

## Step 6: Manual Testing

If automatic login fails, the app now shows a fallback login form where you can:
1. Create a regular account using "Регистрация"
2. Login with username/password
3. Use all calendar features normally

## Step 7: Advanced Debugging

### Check initData Format
Add this to your browser console when in the Telegram Mini App:
```javascript
console.log('Telegram WebApp:', window.Telegram?.WebApp);
console.log('Init Data:', window.Telegram?.WebApp?.initData);
```

### Test Signature Verification
You can test the signature verification manually by calling the debug endpoint with sample data.

## Step 8: Production Considerations

For production deployment:
1. **Use HTTPS**: Telegram requires HTTPS for Mini Apps
2. **Update CORS**: Add your production domain to CORS origins
3. **Environment Variables**: Ensure BOT_TOKEN is properly set in production
4. **Domain Verification**: Make sure your domain matches the one in BotFather

## Still Having Issues?

If you're still experiencing problems:

1. **Check the logs**: Both frontend console and backend container logs
2. **Verify configuration**: Bot token, domain, and Mini App setup
3. **Test with ngrok**: Use ngrok to expose your local server with HTTPS
4. **Use fallback**: The regular login form should work as a backup

The debugging information added will help identify the exact point of failure in the authentication flow.
