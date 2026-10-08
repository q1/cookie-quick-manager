import { createRoot } from 'react-dom/client';
import { browserGateway } from './lib/browser-gateway';
import { WorkspaceProvider } from './ui/context';
import { Popup } from './ui/Popup';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <WorkspaceProvider gateway={browserGateway}>
    <Popup />
  </WorkspaceProvider>,
);
