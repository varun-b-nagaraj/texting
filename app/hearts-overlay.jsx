'use client';

import { useEffect, useState } from 'react';

const DEFAULT_PHRASES = [
  'love you',
  'my favorite',
  'always us',
  'sweetheart',
  'kiss kiss',
  'forever'
];

const heartGlyphs = ['❤', '♥', '❥'];

const randomBetween = (min, max) => Math.random() * (max - min) + min;

export default function HeartsOverlay() {
  const [items, setItems] = useState([]);
  const [phrases, setPhrases] = useState(DEFAULT_PHRASES);

  useEffect(() => {
    let active = true;
    fetch('/falling-phrases.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !Array.isArray(data) || data.length === 0) return;
        setPhrases(data.filter((entry) => typeof entry === 'string'));
      })
      .catch(() => {});

    let timer;

    const spawnItem = () => {
      if (!active) return;
      const isBubble = Math.random() < 0.18;
      const isPhrase = !isBubble && Math.random() < 0.32 && phrases.length > 0;
      const text = isPhrase
        ? phrases[Math.floor(Math.random() * phrases.length)]
        : heartGlyphs[Math.floor(Math.random() * heartGlyphs.length)];
      const size = isBubble ? randomBetween(32, 50) : randomBetween(16, 26);
      const duration = isBubble ? randomBetween(9, 13) : randomBetween(6, 10);
      const drift = randomBetween(-30, 30);
      const left = randomBetween(4, 96);
      const opacity = isBubble ? 0.55 : randomBetween(0.45, 0.85);
      const lane = Math.random() < 0.5 ? 'left' : 'right';
      const id = crypto.randomUUID();

      setItems((prev) => [
        ...prev,
        {
          id,
          text,
          isPhrase,
          isBubble,
          lane,
          style: {
            '--left': `${left}%`,
            '--duration': `${duration}s`,
            '--size': `${size}px`,
            '--drift': `${drift}px`,
            '--opacity': opacity
          }
        }
      ]);

      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, (duration + 1) * 1000);
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        spawnItem();
        schedule();
      }, randomBetween(700, 1400));
    };

    schedule();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [phrases]);

  return (
    <div className="hearts-overlay" aria-hidden="true">
      <div className="heart-lane left">
        {items
          .filter((item) => item.lane === 'left')
          .map((item) => (
            <span
              key={item.id}
              className={`heart-item ${item.isPhrase ? 'phrase' : ''} ${
                item.isBubble ? 'bubble' : ''
              }`}
              style={item.style}
            >
              {item.text}
            </span>
          ))}
      </div>
      <div className="heart-lane right">
        {items
          .filter((item) => item.lane === 'right')
          .map((item) => (
            <span
              key={item.id}
              className={`heart-item ${item.isPhrase ? 'phrase' : ''} ${
                item.isBubble ? 'bubble' : ''
              }`}
              style={item.style}
            >
              {item.text}
            </span>
          ))}
      </div>
    </div>
  );
}
