import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-change-me')

export type Role = 'finance' | 'investor'

export async function signToken(role: Role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken(token: string): Promise<{ role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return { role: payload.role as Role }
  } catch {
    return null
  }
}

// ── Server-side only (call this only from Server Components or API routes) ───
export async function getSession(): Promise<{ role: Role } | null> {
  // Dynamically import next/headers so it's never bundled into client code
  const { cookies } = await import('next/headers')
  const cookieStore = cookies()
  const token = cookieStore.get('narra-session')?.value
  if (!token) return null
  return verifyToken(token)
}

export async function requireRole(role: Role) {
  const session = await getSession()
  if (!session) return null
  if (role === 'finance' && session.role !== 'finance') return null
  return session
}
