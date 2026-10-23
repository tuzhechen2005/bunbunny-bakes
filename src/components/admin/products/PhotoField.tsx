"use client";

import { useEffect, useRef, useState } from "react";
import { BunnyPlaceholder } from "@/components/customer/BunnyPlaceholder";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { adminUpload } from "@/lib/adminUpload";
import { prepareImage } from "@/lib/imageResize";
import type { ProductDto } from "./describe";

const t = copy.admin.products;

const buttonClass =
  "min-h-11 rounded-lg border border-line px-3 text-sm font-medium disabled:opacity-60";

/** Photo picker for the product edit page: preview, upload with progress, delete (back to the bunny). */
export function PhotoField({
  productId,
  imageUrl,
  onChange,
}: Readonly<{ productId: string | null; imageUrl: string | null; onChange: (url: string | null) => void }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "processing" | "uploading" | "deleting">("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function onPick(file: File | undefined) {
    if (!file || !productId) return;
    setError("");
    setPercent(0);
    setBusy("processing");
    let prepared: File;
    try {
      prepared = await prepareImage(file);
    } catch {
      setBusy("");
      setError(t.photoReadFailed);
      return;
    }
    setPreview(URL.createObjectURL(prepared));
    setBusy("uploading");
    const result = await adminUpload<{ product: ProductDto }>(
      `/api/admin/products/${productId}/image`,
      prepared,
      (f) => setPercent(Math.round(f * 100)),
    );
    setBusy("");
    setPreview(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange(result.data.product.imageUrl);
  }

  async function onDelete() {
    if (!productId) return;
    setError("");
    setBusy("deleting");
    const result = await adminApi<{ product: ProductDto }>(`/api/admin/products/${productId}/image`, {
      method: "DELETE",
    });
    setBusy("");
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChange(null);
  }

  const shown = preview ?? imageUrl;
  const disabled = busy !== "";
  const status =
    busy === "processing"
      ? t.photoProcessing
      : busy === "uploading"
        ? t.photoUploading.replace("{percent}", String(percent))
        : busy === "deleting"
          ? t.photoDeleting
          : "";

  return (
    <div className="flex flex-col gap-2" data-testid="photo-field">
      <div className="flex items-center gap-3">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt={t.photoAlt}
            data-testid="photo-preview"
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <BunnyPlaceholder className="h-20 w-20 shrink-0 rounded-lg" />
        )}
        {productId ? (
          <div className="flex min-w-0 flex-col items-start gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // allow picking the same file again
                void onPick(file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={disabled} onClick={() => inputRef.current?.click()}>
                {imageUrl ? t.photoReplace : t.photoChoose}
              </button>
              {imageUrl ? (
                <button
                  type="button"
                  className={`${buttonClass} text-danger`}
                  disabled={disabled}
                  onClick={() => void onDelete()}
                >
                  {t.photoDelete}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{t.photoAfterSave}</p>
        )}
      </div>
      {busy === "uploading" ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-soft" aria-hidden="true">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      ) : null}
      {productId && !status && !error ? <p className="text-xs text-muted">{t.photoHint}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="photo-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
