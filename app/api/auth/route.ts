import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  // Email-based login: @narrahealth.co team members
  if (email) {
    const domain = email.trim().toLowerCase().split('@')[1]
    if (domain !== 'narrahealth.co') {
      return NextResponse.json({ error: 'Only @narrahealth.co emails are allowed.' }, { status: 401 })
    }
    if (password !== process.env.FINANCE_PASSWORD) {
      return NextResponse.json({ role: null }, { status: 401 })
    }
    const token = await signToken('finance')
    const res = NextResponse.json({ role: 'finance' })
    res.cookies.set('narra-session', token, {
      httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 7,
    })
    return res
  }

  return NextResponse.json({ error: 'Email is required.' }, { status: 401 })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('narra-session')
  return res
}
