import { useStore } from '../../state/store';
import { SPRITE_SVGS, svgToDataUrl } from '../../assets/easter/sprites';

/**
 * Easter egg #1 — a mini disco of dancing pixel cats.
 *
 * Design constraints (see user brief):
 *  - Overlay ON TOP of the UI, not a full-screen blocker. It's a small card
 *    anchored bottom-centre.
 *  - The decorative layer is `pointer-events: none` so work continues
 *    underneath; only the small dismiss button is interactive.
 *  - Tasteful, not seizure-inducing: slow soft motion (see index.css). Reduced
 *    motion is handled purely in CSS via `prefers-reduced-motion`.
 *
 * Visible when either the transient session flag (`discoActive`, set by the
 * NS triple-click) OR the persisted `settings.discoCatsEnabled` toggle is on.
 */

const CAT_URL = svgToDataUrl(SPRITE_SVGS.cat);
const FLOOR_TILES = ['#ff6fae', '#4bc0c8', '#ffd166', '#7c8cff', '#ff8f6b', '#57d38c'];

export function DiscoCats() {
  const discoActive = useStore((s) => s.discoActive);
  const enabled = useStore((s) => s.data.settings.discoCatsEnabled);
  const setDiscoActive = useStore((s) => s.setDiscoActive);
  const updateSettings = useStore((s) => s.updateSettings);

  if (!discoActive && !enabled) return null;

  const dismiss = () => {
    setDiscoActive(false);
    if (enabled) updateSettings({ discoCatsEnabled: false });
  };

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 bottom-3 z-[70] flex justify-center pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      <div
        className="relative rounded-2xl px-5 pt-6 pb-3 pointer-events-none"
        style={{
          width: 268,
          background: 'linear-gradient(180deg, rgba(20,16,34,0.92), rgba(38,20,54,0.92))',
          boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        {/* Disco ball */}
        <div className="absolute left-1/2 -top-2 -translate-x-1/2">
          <div
            className="easter-disco-ball rounded-full"
            style={{
              width: 26,
              height: 26,
              background:
                'radial-gradient(circle at 30% 30%, #ffffff 0%, #cfd8ff 25%, #8a7bd8 60%, #4a3f8a 100%)',
              boxShadow: '0 0 10px rgba(160,170,255,0.6)',
            }}
          />
        </div>

        {/* Dancing cats */}
        <div className="flex items-end justify-center gap-3" style={{ height: 46 }}>
          {[0, 1, 2].map((i) => (
            <img
              key={i}
              src={CAT_URL}
              alt=""
              className="easter-disco-cat"
              width={i === 1 ? 40 : 32}
              height={i === 1 ? 40 : 32}
              style={{ imageRendering: 'pixelated' }}
            />
          ))}
        </div>

        {/* Dance floor */}
        <div className="easter-disco-floor mt-2 flex gap-1 justify-center">
          {FLOOR_TILES.map((c, i) => (
            <span
              key={i}
              className="rounded-sm"
              style={{ width: 26, height: 8, background: c, animationDelay: `${i * 0.35}s` }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="absolute -top-2 -right-2 rounded-full pointer-events-auto flex items-center justify-center"
          style={{
            width: 22,
            height: 22,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 12,
            lineHeight: 1,
          }}
          aria-label="Turn off disco cats"
          title="Turn off disco cats"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
