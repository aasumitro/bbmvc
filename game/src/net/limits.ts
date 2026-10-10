// What the wire holds a client's messages to (protocol.ts, lobbyProtocol.ts):
// sizes and lengths, and the two checks a string field passes.
export const LIMITS = { hello: 4096, input: 1024, token: 2048, name: 16, build: 64, lobby: 32, password: 32, code: 8, uid: 64 } // bytes, characters

export const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
export const optional = (value: unknown, max: number): value is string => value === '' || text(value, max)
