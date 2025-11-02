/**
 * Telegram WebApp utilities
 */

// Check if running inside Telegram WebApp
export const isTelegramWebApp = () => {
  return typeof window !== 'undefined' && window.Telegram?.WebApp;
};

// Check if we have valid Telegram initData (required for authentication)
export const hasTelegramInitData = () => {
  const tg = getTelegramWebApp();
  return tg && tg.initData && tg.initData.length > 0;
};

// Check if we're actually in a valid Telegram WebApp context with initData
export const isInTelegramContext = () => {
  return isTelegramWebApp() && hasTelegramInitData();
};

// Get Telegram WebApp instance
export const getTelegramWebApp = () => {
  if (isTelegramWebApp()) {
    return window.Telegram.WebApp;
  }
  return null;
};

// Initialize Telegram WebApp
export const initTelegramWebApp = () => {
  const tg = getTelegramWebApp();
  if (tg) {
    tg.ready();
    tg.expand();
    return tg;
  }
  return null;
};

// Get Telegram initData for authentication
export const getTelegramInitData = () => {
  const tg = getTelegramWebApp();
  if (tg) {
    return tg.initData;
  }
  return null;
};

// Get Telegram theme information
export const getTelegramTheme = () => {
  const tg = getTelegramWebApp();
  if (tg) {
    return {
      colorScheme: tg.colorScheme, // 'light' or 'dark'
      themeParams: tg.themeParams, // Custom theme colors
    };
  }
  return null;
};

// Apply Telegram theme to document
export const applyTelegramTheme = () => {
  const theme = getTelegramTheme();
  if (theme) {
    // Set theme based on Telegram color scheme
    const themeName = theme.colorScheme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', themeName);
    
    // Apply custom theme colors if available
    if (theme.themeParams) {
      const root = document.documentElement;
      const params = theme.themeParams;
      
      // Map Telegram theme params to CSS custom properties
      if (params.bg_color) {
        root.style.setProperty('--telegram-bg', params.bg_color);
      }
      if (params.text_color) {
        root.style.setProperty('--telegram-text', params.text_color);
      }
      if (params.hint_color) {
        root.style.setProperty('--telegram-hint', params.hint_color);
      }
      if (params.link_color) {
        root.style.setProperty('--telegram-link', params.link_color);
      }
      if (params.button_color) {
        root.style.setProperty('--telegram-button', params.button_color);
      }
      if (params.button_text_color) {
        root.style.setProperty('--telegram-button-text', params.button_text_color);
      }
    }
  }
};

// Login with Telegram WebApp
export const loginWithTelegram = async (apiUrl) => {
  console.log('[DEBUG] Starting Telegram login...');
  
  // Check if we're actually in Telegram context before attempting login
  if (!isInTelegramContext()) {
    console.warn('[WARN] Not in valid Telegram context - skipping login');
    throw new Error('Not in valid Telegram context');
  }
  
  const initData = getTelegramInitData();
  console.log('[DEBUG] Init data:', initData);
  
  if (!initData || initData.length === 0) {
    console.error('[ERROR] No Telegram initData available');
    throw new Error('No Telegram initData available');
  }

  console.log('[DEBUG] Making request to:', `${apiUrl}/tg/webapp/login`);
  
  const response = await fetch(`${apiUrl}/tg/webapp/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  });

  console.log('[DEBUG] Response status:', response.status);
  console.log('[DEBUG] Response ok:', response.ok);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[ERROR] Login failed:', error);
    throw new Error(error.detail || 'Telegram login failed');
  }

  const result = await response.json();
  console.log('[DEBUG] Login successful:', result);
  return result;
};
