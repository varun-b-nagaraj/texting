import './globals.css';
import { Instrument_Serif, Space_Grotesk } from 'next/font/google';
import HeartsOverlay from './hearts-overlay';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans'
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400']
});

export const metadata = {
  title: 'Neniboo Chat',
  description: 'for the best gf in the world <3333.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${instrumentSerif.variable}`}>
      <body>
        <HeartsOverlay />
        {children}
      </body>
    </html>
  );
}
