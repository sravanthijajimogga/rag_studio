
const API_URL = "/api";

// Build the correct backend URL
function getApiUrl(url) {
  if (url.startsWith("http")) return url;
  if (url.startsWith("/api/")) return url;
  return `${API_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

// Common API request function
export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("access_token");

  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(getApiUrl(url), {
    ...options,
    headers,
  });

  return response;
}

// Register
export async function registerUser(userData) {
  const response = await apiFetch("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Registration failed");
  }

  return data;
}

// Login
export async function loginUser(credentials) {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Login failed");
  }

  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("user", JSON.stringify(data.user));

  return data;
}

// Get current logged-in user
export async function getCurrentUser() {
  const token = localStorage.getItem("access_token");

  if (!token) return null;

  const response = await apiFetch("/auth/me");

  if (!response.ok) {
    logoutUser();
    return null;
  }

  return await response.json();
}

// Logout
export function logoutUser() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
}

// Get stored user
export function getStoredUser() {
  const user = localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function apiUpload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem("access_token");
    const xhr = new XMLHttpRequest();

    xhr.open("POST", getApiUrl(url));

    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const percentage = Math.round(
          (event.loaded / event.total) * 100
        );

        onProgress(percentage);
      }
    });

    xhr.onload = () => {
      let data;

      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Invalid server response"));
        return;
      }

      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => data,
      });
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.onabort = () => {
      reject(new Error("Upload cancelled"));
    };

    xhr.send(formData);
  });
}
