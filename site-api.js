const parseJson = async (response) => {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
};

export const fetchStatus = async () => parseJson(await fetch("/api/status", { cache: "no-store" }));

export const fetchAdminConfig = async () =>
  parseJson(
    await fetch("/api/admin/config", {
      cache: "no-store",
      credentials: "same-origin",
    }),
  );

export const loginAdmin = async (password) =>
  parseJson(
    await fetch("/api/admin/session", {
      body: JSON.stringify({ password }),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );

export const logoutAdmin = async () =>
  parseJson(
    await fetch("/api/admin/session", {
      credentials: "same-origin",
      method: "DELETE",
    }),
  );

export const updateAdminConfig = async (payload) =>
  parseJson(
    await fetch("/api/admin/config", {
      body: JSON.stringify(payload),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
