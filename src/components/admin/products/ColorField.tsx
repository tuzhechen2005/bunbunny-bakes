"use client";

import { copy } from "@/copy";
import { contrastWarning, FIELD_PRESETS, fieldFor } from "@/lib/fieldColor";
import { fill } from "./describe";

const t = copy.admin.products;

/**
 * Home background colour (D95): 10 named swatches, a native colour input for anything else,
 * a live preview chip (name in the derived text colours) and a warning when no text colour
 * reads well on it. `value` is `#RRGGBB`.
 */
export function ColorField({
  value,
  name,
  onChange,
  label,
}: Readonly<{ value: string; name: string; onChange: (hex: string) => void; label?: string }>) {
  const hex = value.toUpperCase();
  const f = fieldFor(hex);
  const isPreset = FIELD_PRESETS.some((p) => p.hex === hex);
  const warn = contrastWarning(hex);

  return (
    <div className="flex flex-col gap-2" data-testid="color-field">
      <span className="text-sm font-medium" id="color-field-label">
        {label ?? t.fieldColor}
      </span>
      <div role="radiogroup" aria-labelledby="color-field-label" className="grid grid-cols-5 gap-2">
        {FIELD_PRESETS.map((p) => {
          const selected = p.hex === hex;
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={fill(t.colorSwatchAria, { name: p.name, hex: p.hex })}
              data-testid={`color-swatch-${p.hex.slice(1)}`}
              onClick={() => onChange(p.hex)}
              className={`flex min-h-11 flex-col items-center gap-1 rounded-lg border p-1 ${
                selected ? "border-accent ring-2 ring-accent" : "border-line"
              }`}
            >
              <span
                className="block h-7 w-full rounded-md border border-line"
                style={{ backgroundColor: p.hex }}
                aria-hidden="true"
              />
              <span className="text-xs leading-tight">{p.name}</span>
            </button>
          );
        })}
      </div>
      <label
        className={`relative flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 ${
          isPreset ? "border-line" : "border-accent ring-2 ring-accent"
        }`}
      >
        <input
          type="color"
          value={hex}
          aria-label={t.colorCustomAria}
          data-testid="color-custom"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
        />
        <span className="text-base">{t.colorCustom}</span>
        <span className="ml-auto font-mono text-sm text-muted" data-testid="color-hex">
          {hex}
        </span>
      </label>
      <div
        data-testid="color-preview"
        className="flex min-h-14 flex-col justify-center rounded-lg border border-line px-4 py-2"
        style={{ backgroundColor: f.bg }}
      >
        <span className="text-lg font-bold" style={{ color: f.ink }}>
          {name.trim() || t.colorPreviewEmpty}
        </span>
        <span className="text-sm" style={{ color: f.ink2 }}>
          {t.colorHint}
        </span>
      </div>
      {warn && (
        <p role="status" className="text-sm text-danger" data-testid="color-warning">
          {t.colorWarning}
        </p>
      )}
    </div>
  );
}
