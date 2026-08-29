import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/app/pwa-register';
import './globals.css';

const themeInitScript = "(()=>{try{const t=localStorage.getItem('matchpilot-theme');const d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light'}catch{}})();";

export const metadata: Metadata = {
  metadataBase: new URL('https://matchpilot-personal.minaduki-co1029.chatgpt.site'),
  title: {
    default: 'MatchPilot — マッチングアプリを一つに',
    template: '%s | MatchPilot',
  },
  description: 'マッチングアプリのログイン、登録準備、候補条件、AI会話ルール、Telegram報告を一つにまとめる個人用コントロールハブ。',
  applicationName: 'MatchPilot',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    title: 'MatchPilot — マッチングアプリを一つに',
    description: '複数アプリのログイン、登録準備、条件設定、AI会話ルールを一元管理。',
    images: [{ url: '/matchpilot-social.png', width: 1200, height: 630, alt: 'MatchPilotの安全な会話自動化ネットワーク' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MatchPilot — マッチングアプリを一つに',
    description: '複数のマッチングアプリを安全条件つきで一元管理。',
    images: ['/matchpilot-social.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MatchPilot',
  },
  formatDetection: {
    telephone: false,
  },
  alternates: { canonical: '/' },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b111b' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head><script>{themeInitScript}</script></head>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
