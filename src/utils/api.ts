export const getBaseUrl = () => {
  // 1) User-configured server URL wins (from Login → "إعدادات السيرفر")
  let saved = localStorage.getItem('API_BASE_URL');
  if (saved) {
    // Filter out stale ngrok/preview URLs that no longer exist
    if (saved.includes('epjrso3jhkco2k2ejlqcll')) {
      saved = null;
      localStorage.removeItem('API_BASE_URL');
    } else {
      saved = saved.trim();
      if (saved && !saved.startsWith('http://') && !saved.startsWith('https://')) {
        saved = 'http://' + saved;
      }
      return saved.replace(/\/$/, '');
    }
  }

  // 2) Detect Capacitor / Cordova / file:// webview
  const isCapacitor =
    (window as any).Capacitor !== undefined ||
    window.location.protocol === 'file:' ||
    window.location.protocol === 'capacitor:';

  if (isCapacitor) {
    // Try to discover the local server on the user's network via zero-config:
    // - Check meta tag (set during build by Capacitor)
    // - Fall back to the production backend URL
    const meta = document.querySelector('meta[name="api-base-url"]') as HTMLMetaElement | null;
    if (meta?.content && (meta.content.startsWith('http://') || meta.content.startsWith('https://'))) {
      return meta.content.replace(/\/$/, '');
    }
    // Default production backend URL — this should be replaced with the customer's
    // server URL when deploying to production. The user can also override it from
    // the Login page → "إعدادات السيرفر" by typing the IP of their local machine.
    return 'http://192.168.1.100:3000'; // Default fallback for Capacitor
  }
  return window.location.origin;
};

export const resolveUrl = (url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const base = getBaseUrl();
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
};

/**
 * Detect whether the app is running inside a Capacitor mobile webview.
 * Used to adjust UX (no HMR, no dev-only features, etc.)
 */
export const isMobileApp = () => {
  return (
    (window as any).Capacitor !== undefined ||
    window.location.protocol === 'file:' ||
    window.location.protocol === 'capacitor:'
  );
};

const getHeaders = (extraHeaders: Record<string, string> = {}, url?: string) => {
  let token = localStorage.getItem('token');
  
  // If the request is for the employee portal, prioritize employee_mobile_token
  const isEmployeeRequest = url && (
    url.includes('/employee-portal') || 
    url.includes('/mobile-checkin') || 
    url.includes('/employee-login')
  );
  
  if (isEmployeeRequest) {
    token = localStorage.getItem('employee_mobile_token') || token;
  } else if (!token || token === 'null' || token === 'undefined') {
    token = localStorage.getItem('employee_mobile_token');
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    ...extraHeaders
  };
  if (token && token !== 'null' && token !== 'undefined') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const checkHtmlResponse = (res: Response, method: string, url: string) => {
  if (res.status === 401) {
    const isEmployeeUrl = url.includes('/employee-portal') || url.includes('/employee-login') || url.includes('/attendance/mobile-checkin');
    if (isEmployeeUrl || localStorage.getItem('employee_mobile_token')) {
      localStorage.removeItem('employee_mobile_token');
      localStorage.removeItem('employee_mobile_profile');
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return;
  }

  if (res.status === 403) {
    console.warn(`API ${method} ${url} denied with ${res.status}`);
    return;
  }

  // Handle transient gateway/server errors during cold-starts or restarts (502/503/504)
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    console.warn(`[API] Server is starting or temporarily unavailable (${res.status}) on ${method} ${url}`);
    res.json = async () => {
      throw new Error(`Server temporarily unavailable (${res.status})`);
    };
    return;
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('text/html')) {
    if (!res.ok) {
      console.warn(`API ${method} ${url} returned ${res.status} HTML error page`);
    } else {
      console.warn(`API ${method} ${url} returned HTML instead of JSON`);
    }
    // Provide safe fallback json method to prevent uncaught exceptions
    res.json = async () => {
      return {};
    };
  }
};

export const authFetch = async (url: string, options: RequestInit = {}) => {
  const resolved = resolveUrl(url);
  const headers = getHeaders((options.headers as Record<string, string>) || {}, url);
  const res = await fetch(resolved, { ...options, headers });
  checkHtmlResponse(res, options.method || 'GET', resolved);
  return res;
};

export const apiFetch = authFetch;

export const api = {
  get: async (url: string) => {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      headers: getHeaders({}, url)
    });
    checkHtmlResponse(res, 'GET', resolved);
    return res;
  },
  post: async (url: string, body: any) => {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }, url),
      body: JSON.stringify(body)
    });
    checkHtmlResponse(res, 'POST', resolved);
    return res;
  },
  put: async (url: string, body?: any) => {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }, url),
      body: JSON.stringify(body)
    });
    checkHtmlResponse(res, 'PUT', resolved);
    return res;
  },
  delete: async (url: string) => {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      method: 'DELETE',
      headers: getHeaders({}, url)
    });
    checkHtmlResponse(res, 'DELETE', resolved);
    return res;
  },
  patch: async (url: string, body?: any) => {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      method: 'PATCH',
      headers: getHeaders({ 'Content-Type': 'application/json' }, url),
      body: JSON.stringify(body)
    });
    checkHtmlResponse(res, 'PATCH', resolved);
    return res;
  }
};
