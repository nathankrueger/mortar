import { createRoot } from 'react-dom/client';
import { audio } from './audio/AudioEngine';
import { App } from './ui/App';
import { applySavedVolumes } from './ui/hud/PauseSheet';
import './styles/index.css';

audio.installUnlock();
applySavedVolumes();
console.info(`Mortar Mayhem build ${__BUILD_ID__}`);
createRoot(document.getElementById('root')!).render(<App />);
