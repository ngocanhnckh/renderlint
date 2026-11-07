import { useEffect, useRef, useState } from 'react';
import { Shell, Stats } from '../lib.jsx';
function CanvasLoader() {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current.getContext('2d'); let raf, t0 = performance.now();
    const draw = (t) => {
      c.clearRect(0, 0, 60, 60); c.lineWidth = 5; c.strokeStyle = '#2563eb'; c.lineCap = 'round';
      const a = ((t - t0) / 400) % (Math.PI * 2);
      c.beginPath(); c.arc(30, 30, 20, a, a + 4); c.stroke(); raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width="60" height="60" />;
}
export default function Page() {
  const [s, setS] = useState(null);
  useEffect(() => { fetch('/api/stats?x=canvas').then((r) => r.json()).then(setS); }, []);
  return <Shell title="Overview">{s ? <Stats s={s} /> : <div style={{ textAlign: 'center', padding: 60 }}><CanvasLoader /></div>}</Shell>;
}
