/** Convert unix seconds to `datetime-local` input value (local timezone). */
export function unixToDatetimeLocal(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse `datetime-local` value to unix seconds. */
export function datetimeLocalToUnix(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}
