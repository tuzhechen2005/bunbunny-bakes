// Multipart upload to /api/admin/** with progress (fetch cannot report upload progress).
// Same contract as adminApi(): never throws, 401 sends the browser to the login page.

import { copy } from "@/copy";
import { ADMIN_LOGIN_PATH, type AdminApiResult } from "./adminApi";

export function adminUpload<T = unknown>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<AdminApiResult<T>> {
  return new Promise((resolve) => {
    const fail = (error: string, message: string) => resolve({ ok: false, error, message });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => fail("NETWORK", copy.admin.shell.requestFailed);
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      if (xhr.status === 401) {
        if (typeof window !== "undefined") window.location.href = ADMIN_LOGIN_PATH;
        return fail("UNAUTHORIZED", copy.errors.UNAUTHORIZED);
      }
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON body
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ ok: true, data: json as T });
      const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const { error, message, ...extra } = body;
      resolve({
        ...extra,
        ok: false,
        error: typeof error === "string" ? error : "INTERNAL",
        message: typeof message === "string" && message ? message : copy.admin.shell.requestFailed,
      });
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
