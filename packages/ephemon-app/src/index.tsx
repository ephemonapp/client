import App from './App';
import { loadHostedPreset } from './lib/settingsStore';
import './styles.css';
import { ThemeProvider } from './theme/ThemeProvider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const chunkFilename = __webpack_get_script_filename__;
__webpack_get_script_filename__ = (chunkId) => `${chunkFilename(chunkId)}?_=${process.env.EPHEMON_BUILD_TIMESTAMP}`;

void loadHostedPreset().then(() => {
    const rootElement = document.getElementById('root');

    if (rootElement) {
        createRoot(rootElement).render(
            <StrictMode>
                <ThemeProvider>
                    <App />
                </ThemeProvider>
            </StrictMode>,
        );
    } else {
        console.error('Unable to locate element with id "root"');
    }
});
