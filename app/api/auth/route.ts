import { NextRequest, NextResponse } from 'next/server'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password === process.env.FINANCE_PASSWORD) {
    const token = await signToken('finance')
    const res = NextResponse.json({ role: 'finance' })
    res.cookies.set('narra-session', token, {
      httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 7,
    })
    return res
  }

  if (password === process.env.INVESTOR_PASSWORD) {
    const token = await signToken('investor')
    const res = NextResponse.json({ role: 'investor' })
    res.cookies.set('narra-session', token, {
      httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 7,
    })
    return res
  }

  return NextResponse.json({ role: null }, { status: 401 })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('narra-session')
  return res
}
