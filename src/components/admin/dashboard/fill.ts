/** Replaces `{name}` placeholders in a copy string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m,
  );
}
