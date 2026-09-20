export const fetcher = (url: string) => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };
  if (token && token !== 'null' && token !== 'undefined') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, { headers }).then(res => {
    if (res.status === 401) {
      const isEmployeeUrl = url.includes('/employee-portal') || url.includes('/employee-login') || url.includes('/attendance/mobile-checkin');
      if (isEmployeeUrl) {
        localStorage.removeItem('employee_mobile_token');
        localStorage.removeItem('employee_mobile_profile');
      }
      throw new Error("Unauthorized");
    }
    if (res.status === 403) {
      // 403 is permission restriction for this specific resource, not session expiry.
      // Do NOT remove token or reload.
      throw new Error("Forbidden");
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      throw new Error(`Expected JSON but got HTML from ${url}`);
    }
    return res.json();
  });
};
