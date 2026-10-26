"use client";

import { useEffect, useRef, useState } from "react";
import { primaryBtn, secondaryBtn } from "@/components/admin/orders/shared";
import { copy } from "@/copy";
import { adminUpload } from "@/lib/adminUpload";
import { scaledSize } from "@/lib/imageResize";
import { TierCircle } from "./TierCircle";
import { classifyImage, removeWhiteBackground, type ImageKind } from "./removeBackground";

const t = copy.admin.game;
const MAX_EDGE = 640;

interface Loaded {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  kind: ImageKind;
}

async function loadPixels(file: File): Promise<Loaded> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height); // no fill: a PNG's alpha must survive
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data, kind: classifyImage(data, width, height) };
  } finally {
    bitmap.close();
  }
}

function toPng(width: number, height: number, data: Uint8ClampedArray): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Picks a file, removes a white background in the browser (unless it is already transparent),
 * previews it on the tier colour and uploads it. A painted "transparent" checkerboard is refused.
 */
export function TierImageEditor({
  tierId,
  bg,
  name,
  onClose,
  onSaved,
}: Readonly<{ tierId: string; bg: string; name: string; onClose: () => void; onSaved: () => void }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "uploading">("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  // Rebuild the processed image whenever the source or the toggle changes.
  useEffect(() => {
    if (!loaded || loaded.kind === "fake-checker") return;
    let active = true;
    const run = async () => {
      const process = loaded.kind === "opaque" && removeWhite;
      const data = process ? removeWhiteBackground(loaded.data, loaded.width, loaded.height).data : loaded.data;
      const out = await toPng(loaded.width, loaded.height, data);
      if (!active) return;
      setBlob(out);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return out ? URL.createObjectURL(out) : null;
      });
    };
    void run();
    return () => {
      active = false;
    };
  }, [loaded, removeWhite]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError("");
    setLoaded(null);
    setBlob(null);
    setPreview(null);
    setBusy("reading");
    try {
      setLoaded(await loadPixels(file));
    } catch {
      setError(t.imageReadFailed);
    }
    setBusy("");
  }

  async function save() {
    if (!blob || !usable) return;
    setError("");
    setPercent(0);
    setBusy("uploading");
    const file = new File([blob], "tier.png", { type: "image/png" });
    const result = await adminUpload(`/api/admin/game/tiers/${tierId}/image`, file, (f) => setPercent(Math.round(f * 100)));
    setBusy("");
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved();
  }

  const usable = loaded !== null && loaded.kind !== "fake-checker";
  const hint =
    loaded?.kind === "fake-checker"
      ? t.imageHintFake
      : loaded?.kind === "alpha"
        ? t.imageHintAlpha
        : loaded && removeWhite
          ? t.imageHintWhite
          : t.imageHintHelp;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-soft p-3" data-testid="tier-image-editor">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid="tier-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onPick(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} disabled={busy !== ""} onClick={() => inputRef.current?.click()}>
          {loaded ? t.imageReplace : t.imageChoose}
        </button>
        <button type="button" className={secondaryBtn} disabled={busy === "uploading"} onClick={onClose}>
          {t.imageCancel}
        </button>
      </div>
      {busy === "reading" ? <p role="status" className="text-sm text-muted">{t.imageReading}</p> : null}
      {loaded ? (
        <>
          {loaded.kind === "opaque" ? (
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={removeWhite}
                onChange={(e) => setRemoveWhite(e.target.checked)}
                data-testid="tier-remove-white"
              />
              {t.removeWhite}
            </label>
          ) : null}
          <p
            className={`text-sm ${loaded.kind === "fake-checker" ? "text-danger" : "text-muted"}`}
            role={loaded.kind === "fake-checker" ? "alert" : "status"}
            data-testid="tier-image-hint"
          >
            {hint}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">{t.imageHintHelp}</p>
      )}
      {usable && preview ? (
        <div className="flex items-center gap-3">
          <TierCircle bg={bg} src={preview} alt={name} size={96} testId="tier-image-preview" />
          <span className="text-sm text-muted">{t.imagePreview}</span>
        </div>
      ) : null}
      {busy === "uploading" ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-card" aria-hidden="true">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="tier-image-error">
          {error}
        </p>
      ) : null}
      <button type="button" className={primaryBtn} disabled={!usable || !blob || busy !== ""} onClick={() => void save()} data-testid="tier-image-save">
        {busy === "uploading" ? t.imageSaving : t.imageSave}
      </button>
    </div>
  );
}
