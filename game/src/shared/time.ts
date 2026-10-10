// 125 s → '02:05'.
export const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
// Match-clock times on the wire: whole milliseconds.
export const ms = (seconds: number) => Math.round(seconds * 1000) / 1000
