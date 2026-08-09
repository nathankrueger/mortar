import { useHashRoute } from '../app/routes';
import { GameCanvas } from '../game/GameCanvas';
import { RotateOverlay } from './RotateOverlay';
import { Home } from './screens/Home';
import { HotseatScreen } from './screens/HotseatScreen';
import { OnlineScreen } from './screens/OnlineScreen';
import { SoloScreen } from './screens/SoloScreen';
import { TerrainDev } from './screens/TerrainDev';

const AMBIENT_ROUTES = new Set(['home', 'dev-terrain']);

export function App() {
  const route = useHashRoute();
  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas ambient={AMBIENT_ROUTES.has(route.name)} />
      {route.name === 'home' && <Home />}
      {route.name === 'solo' && <SoloScreen />}
      {route.name === 'online' && (
        <OnlineScreen key={`${route.mode}-${route.code ?? ''}`} mode={route.mode} initialCode={route.code} />
      )}
      {route.name === 'dev-terrain' && <TerrainDev />}
      {route.name === 'dev-hotseat' && <HotseatScreen />}
      {route.name === 'dev-sandbox' && <HotseatScreen key="sandbox" sandbox />}
      <RotateOverlay />
    </div>
  );
}
