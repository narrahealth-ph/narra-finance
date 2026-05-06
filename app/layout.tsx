import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Narra Finance',
  description: 'Narra Health Financial Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body bg-narra-surface text-narra-ink antialiased">
        {children}
      </body>
    </html>
  )
}
