'use client';

import { useEffect, useState } from 'react';

const KEY = 'magic-mouse';
const HOVER_DELAY_MS = 180;
const CURSOR_OFFSET = 14;
const TIP_MAX_W = 320;
const TIP_MAX_H = 80;

interface TipState {
  x: number;
  y: number;
  text: string;
}

export default function MagicMouse() {
  const [enabled, setEnabled] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    setEnabled(typeof window !== 'undefined' && localStorage.getItem(KEY) === '1');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('magic-on', enabled);
    return () => {
      document.body.classList.remove('magic-on');
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setTip(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastEl: Element | null = null;
    let lastVisible = false;

    const onMove = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.('[data-magic]') ?? null;

      if (!el) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (lastVisible) {
          setTip(null);
          lastVisible = false;
        }
        lastEl = null;
        return;
      }

      const text = el.getAttribute('data-magic') ?? '';
      if (!text) return;

      if (el === lastEl && lastVisible) {
        setTip({ x: e.clientX, y: e.clientY, text });
        return;
      }
      lastEl = el;
      if (timer) clearTimeout(timer);
      const x = e.clientX;
      const y = e.clientY;
      timer = setTimeout(() => {
        setTip({ x, y, text });
        lastVisible = true;
        timer = null;
      }, HOVER_DELAY_MS);
    };

    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode / quota — ignore */
    }
    setEnabled(next);
  };

  const tipStyle = tip
    ? {
        left: Math.min(tip.x + CURSOR_OFFSET, window.innerWidth - TIP_MAX_W),
        top: Math.min(tip.y + CURSOR_OFFSET, window.innerHeight - TIP_MAX_H),
      }
    : undefined;

  return (
    <>
      <button
        type="button"
        className={`magic-mouse-toggle ${enabled ? 'on' : ''}`}
        onClick={toggle}
        aria-pressed={enabled}
        title={
          enabled
            ? 'Magic Mouse 已开启 — 悬停查看说明（点击关闭）'
            : '开启 Magic Mouse — 悬停在任意元素上查看它的用途'
        }
      >
        <span aria-hidden>?</span>
      </button>
      {enabled && tip && (
        <div className="magic-mouse-tip" role="tooltip" style={tipStyle}>
          {tip.text}
        </div>
      )}
    </>
  );
}
