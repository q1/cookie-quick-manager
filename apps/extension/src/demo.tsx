import { createRoot } from 'react-dom/client';
import { demoGateway } from './lib/demo-gateway';
import { WorkspaceProvider } from './ui/context';
import { Workbench } from './ui/Workbench';
import { Popup } from './ui/Popup';
import './ui/styles.css';

const view = new URLSearchParams(window.location.search).get('view');
createRoot(document.getElementById('root')!).render(
  <WorkspaceProvider gateway={demoGateway}>
    {view === 'popup' ? (
      <Popup />
    ) : (
      <Workbench initialView={view === 'settings' ? 'settings' : 'cookies'} />
    )}
  </WorkspaceProvider>,
);
