/** Deep copy of plain data. Unlike structuredClone it accepts Vue reactive proxies. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
