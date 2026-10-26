"use client";

import { useEffect, useRef, useState } from "react";
import { BunnyPlaceholder } from "@/components/customer/BunnyPlaceholder";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { adminUpload } from "@/lib/adminUpload";
import { prepareImage } from "@/lib/imageResize";
import { fill, type ProductDto, type ProductImageDto } from "./describe";

const t = copy.admin.products;

export const MAX_PHOTOS = 6;

const buttonClass =
  "min-h-11 min-w-11 rounded-lg border border-line px-3 text-sm font-medium disabled:opacity-60";

function sameOrder(a: ProductImageDto[], b: ProductImageDto[]) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id);
}

/**
 * Photos of a product (D98): up to 6, multi-select upload, the first is the cover. Reorder by
 * dragging the grip (touch-friendly: only the grip captures the pointer) or with the 前移 / 后移
 * buttons; each delete asks first. Every change goes to the server at once.
 */
export function PhotosField({
  productId,
  images,
  onChange,
}: Readonly<{
  productId: string | null;
  images: ProductImageDto[];
  onChange: (images: ProductImageDto[]) => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tileRefs = useRef(new Map<string, HTMLLIElement>());
  const [busy, setBusy] = useState<"" | "processing" | "uploading" | "deleting" | "ordering">("");
  const [percent, setPercent] = useState(0);
  const [queue, setQueue] = useState({ i: 0, n: 0 });
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // While dragging, the list shows the tentative order; it is sent on release.
  const [dragOrder, setDragOrder] = useState<ProductImageDto[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const shown = dragOrder ?? images;
  const disabled = busy !== "";

  function applyProduct(product: ProductDto) {
    onChange(product.images);
  }

  async function onPick(files: File[]) {
    if (!productId || files.length === 0) return;
    setError("");
    const room = MAX_PHOTOS - images.length;
    const picked = files.slice(0, Math.max(room, 0));
    if (files.length > picked.length) setError(t.photoLimit);
    for (let i = 0; i < picked.length; i++) {
      setQueue({ i: i + 1, n: picked.length });
      setPercent(0);
      setBusy("processing");
      let prepared: File;
      try {
        prepared = await prepareImage(picked[i]);
      } catch {
        setBusy("");
        setError(t.photoReadFailed);
        return;
      }
      setBusy("uploading");
      const result = await adminUpload<{ product: ProductDto }>(
        `/api/admin/products/${productId}/images`,
        prepared,
        (f) => setPercent(Math.round(f * 100)),
      );
      if (!result.ok) {
        setBusy("");
        setError(result.message);
        return;
      }
      onChange(result.data.product.images);
    }
    setBusy("");
  }

  async function sendOrder(next: ProductImageDto[]) {
    if (!productId) return;
    setError("");
    setBusy("ordering");
    const result = await adminApi<{ product: ProductDto }>(`/api/admin/products/${productId}/images/order`, {
      method: "PUT",
      body: { ids: next.map((x) => x.id) },
    });
    setBusy("");
    setDragOrder(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyProduct(result.data.product);
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    void sendOrder(next);
  }

  async function onDelete(id: string) {
    if (!productId) return;
    setError("");
    setConfirmId(null);
    setBusy("deleting");
    const result = await adminApi<{ product: ProductDto }>(`/api/admin/products/${productId}/images/${id}`, {
      method: "DELETE",
    });
    setBusy("");
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyProduct(result.data.product);
  }

  // The drag listens on window: React moves the tile's node while reordering, which would drop
  // pointer capture and the release would never reach the grip.
  const drag = useRef<{ id: string; order: ProductImageDto[] } | null>(null);
  const latest = useRef({ images, sendOrder });
  useEffect(() => {
    latest.current = { images, sendOrder };
  });

  function startDrag(id: string) {
    if (disabled || images.length < 2) return;
    drag.current = { id, order: images };
    setDraggingId(id);
    setDragOrder(images);
  }

  useEffect(() => {
    if (!draggingId) return;
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const over = d.order.find((img) => {
        const r = tileRefs.current.get(img.id)?.getBoundingClientRect();
        return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!over || over.id === d.id) return;
      const from = d.order.findIndex((x) => x.id === d.id);
      const to = d.order.findIndex((x) => x.id === over.id);
      const next = [...d.order];
      next.splice(to, 0, next.splice(from, 1)[0]);
      d.order = next;
      setDragOrder(next);
    }
    function onEnd() {
      const d = drag.current;
      drag.current = null;
      setDraggingId(null);
      const { images: current, sendOrder: send } = latest.current;
      // A cancel after the tile moved (the browser may cancel when its node is re-inserted) still saves.
      if (d && !sameOrder(d.order, current)) void send(d.order);
      else setDragOrder(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [draggingId]);

  const status =
    busy === "processing"
      ? t.photoProcessing
      : busy === "uploading"
        ? `${queue.n > 1 ? fill(t.photoQueue, { i: queue.i, n: queue.n }) + " " : ""}${fill(t.photoUploading, { percent })}`
        : busy === "deleting"
          ? t.photoDeleting
          : busy === "ordering"
            ? t.photoOrdering
            : "";

  if (!productId) {
    return (
      <div className="flex flex-col gap-2" data-testid="photo-field">
        <span className="text-sm font-medium">{t.photosTitle}</span>
        <div className="flex items-center gap-3">
          <BunnyPlaceholder className="h-20 w-20 shrink-0 rounded-lg" />
          <p className="text-sm text-muted">{t.photoAfterSave}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="photo-field">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t.photosTitle}</span>
        <span className="text-sm text-muted" data-testid="photo-count">
          {fill(t.photoCount, { n: images.length })}
        </span>
      </div>

      {shown.length === 0 ? (
        <BunnyPlaceholder className="h-24 w-24 rounded-lg" />
      ) : (
        <ul className="grid grid-cols-2 gap-3" data-testid="photo-list">
          {images.map((img) => {
            // Stable DOM order, visual order via CSS: moving the grip's node would cancel the gesture.
            const index = shown.findIndex((x) => x.id === img.id);
            const dragging = draggingId === img.id;
            return (
              <li
                key={img.id}
                ref={(el) => {
                  if (el) tileRefs.current.set(img.id, el);
                  else tileRefs.current.delete(img.id);
                }}
                data-testid="photo-tile"
                data-image-id={img.id}
                style={{ order: index }}
                className={`flex flex-col gap-1 rounded-lg border p-1 ${
                  dragging ? "border-accent opacity-70 ring-2 ring-accent" : "border-line"
                }`}
              >
                <div className="relative aspect-square overflow-hidden rounded-md bg-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={t.photoAlt}
                    data-testid="photo-preview"
                    draggable={false}
                    className="size-full object-cover"
                  />
                  {index === 0 && (
                    <span
                      data-testid="photo-cover-badge"
                      className="absolute bottom-1 left-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink"
                    >
                      {t.photoCover}
                    </span>
                  )}
                  {images.length > 1 && (
                    <button
                      type="button"
                      aria-label={fill(t.photoDragAria, { n: index + 1 })}
                      data-testid="photo-grip"
                      disabled={disabled && !dragging}
                      onPointerDown={() => startDrag(img.id)}
                      style={{ touchAction: "none" }}
                      className="absolute left-1 top-1 flex size-11 cursor-grab items-center justify-center rounded-lg bg-card/90 text-ink shadow disabled:opacity-60"
                    >
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                        {[4, 9, 14].flatMap((y) => [6, 12].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={fill(t.photoDeleteAria, { n: index + 1 })}
                    data-testid="photo-delete"
                    disabled={disabled}
                    onClick={() => setConfirmId(img.id)}
                    className="absolute right-1 top-1 min-h-11 min-w-11 rounded-lg bg-card/90 px-2 text-sm font-medium text-danger shadow disabled:opacity-60"
                  >
                    {t.photoDelete}
                  </button>
                  {confirmId === img.id && (
                    <div
                      ref={(el) => el?.querySelector<HTMLButtonElement>("button")?.focus()}
                      role="alertdialog"
                      aria-label={t.photoDeleteConfirm}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/95 p-2 text-center"
                    >
                      <p className="text-sm font-medium">{t.photoDeleteConfirm}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="photo-delete-yes"
                          className={`${buttonClass} bg-danger text-accent-ink`}
                          onClick={() => void onDelete(img.id)}
                        >
                          {t.photoDeleteYes}
                        </button>
                        <button type="button" className={buttonClass} onClick={() => setConfirmId(null)}>
                          {t.photoDeleteNo}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`${buttonClass} flex-1 px-1`}
                    aria-label={fill(t.photoMoveAria, { n: index + 1, dir: t.photoMoveUp })}
                    data-testid="photo-up"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    {t.photoMoveUp}
                  </button>
                  <button
                    type="button"
                    className={`${buttonClass} flex-1 px-1`}
                    aria-label={fill(t.photoMoveAria, { n: index + 1, dir: t.photoMoveDown })}
                    data-testid="photo-down"
                    disabled={disabled || index === shown.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    {t.photoMoveDown}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid="photo-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // allow picking the same files again
          void onPick(files);
        }}
      />
      <div>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || images.length >= MAX_PHOTOS}
          data-testid="photo-add"
          onClick={() => inputRef.current?.click()}
        >
          {t.photoAdd}
        </button>
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
      {!status && !error ? (
        <p className="text-xs text-muted">{images.length > 1 ? t.photoCoverHint : t.photoHint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="photo-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
