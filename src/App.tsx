import FlameScopeApp from './components/FlameScopeApp';

/**
 * HRM FlameScope is ONE unified application (see docs/UNIFIED.md).
 *
 * The original Planetary Manifold application was not kept as a
 * second app beside FlameScope: its visual architecture (central
 * animated manifold, overlay controls, side inspection panels, modal
 * analysis tools) and its HRM engine were fused with the combustion
 * mission. The pre-fusion standalone planetary entry component is
 * retained in src/PlanetaryApp.tsx for provenance/reference only and
 * is no longer routed; the planetary engine modules and their test
 * suite remain intact and exercised.
 */
export default function App() {
  return <FlameScopeApp />;
}
