import { useEffect, useState } from 'react';

const TOKENS = ['--ground', '--asphalt', '--curb', '--paint', '--paint-y', '--sig-red', '--sig-amber', '--sig-green', '--sig-off',
  '--accent', '--fg', '--fg-2', '--fg-3', '--panel', '--panel-2', '--line', '--line-2', '--s1', '--s2', '--s3', '--s4'];

function read() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  TOKENS.forEach((k) => { t[k] = cs.getPropertyValue(k).trim(); });
  return t;
}

/** Resolved CSS color tokens, for canvas and SVG drawing. Updates when the color scheme changes. */
export function useTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', update); mo.disconnect(); };
  }, []);
  return theme;
}
