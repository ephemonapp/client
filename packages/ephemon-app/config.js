function getTemplateParameters(env) {
    let parameters = {};
    switch (env.environment) {
        case 'local':
            parameters = {
                EPHEMON_CONSOLE_LOG_LEVEL: 'trace',
                EPHEMON_DOCUMENT_LOG_LEVEL: 'info',
                EPHEMON_SERVER_URL:
                    env.CODESPACES === 'true' && env.CODESPACE_NAME !== undefined
                        ? `https://${env.CODESPACE_NAME}-5027.app.github.dev`
                        : 'http://localhost:5027',
                EPHEMON_CLIENT_URL:
                    env.CODESPACES === 'true' && env.CODESPACE_NAME !== undefined
                        ? `https://${env.CODESPACE_NAME}-8081.app.github.dev`
                        : 'http://localhost:8081',
                EPHEMON_VAPID_KEY:
                    'BDJvWjwP8E1UQpbH1GecXj29D0toqjTIRE4jGfeChwBPX86oHP_9PNcyUoxM-Uo41v_oOJtGB559oQVhEmpsv-I',
            };
            break;
        case 'oss':
            parameters = {
                EPHEMON_CONSOLE_LOG_LEVEL: 'trace',
                EPHEMON_DOCUMENT_LOG_LEVEL: 'info',
                EPHEMON_PRESET: 'none',
                EPHEMON_SERVER_URL: '',
                EPHEMON_CLIENT_URL: '',
                EPHEMON_VAPID_KEY: '',
            };
            break;
        case 'production':
            parameters = {
                EPHEMON_CONSOLE_LOG_LEVEL: 'trace',
                EPHEMON_DOCUMENT_LOG_LEVEL: 'info',
                EPHEMON_SERVER_URL: 'https://s.ephemon.app',
                EPHEMON_CLIENT_URL: 'https://ephemon.app',
                EPHEMON_VAPID_KEY:
                    'BHAYDRAjMWXfg7dxFIOZYNLlxrVDohy_PbN7SXcrXapiZq0Jnt0VXsAx6ytkLArVVFDSfula4VRWm5HDvkVVRbA',
                EPHEMON_APP_NAME: 'Ephemon',
            };
            break;
        case 'next':
            parameters = {
                EPHEMON_CONSOLE_LOG_LEVEL: 'trace',
                EPHEMON_DOCUMENT_LOG_LEVEL: 'info',
                EPHEMON_SERVER_URL: 'https://s.ephemon.app',
                EPHEMON_CLIENT_URL: 'https://next.ephemon.app',
                EPHEMON_VAPID_KEY:
                    'BHAYDRAjMWXfg7dxFIOZYNLlxrVDohy_PbN7SXcrXapiZq0Jnt0VXsAx6ytkLArVVFDSfula4VRWm5HDvkVVRbA',
                EPHEMON_APP_NAME: 'Ephemon',
            };
            break;
    }
    parameters = {
        EPHEMON_BUILD_TIMESTAMP: Date.now(),
        EPHEMON_PRESET: 'built-in',
        EPHEMON_APP_NAME: 'Ephemon',
        ...parameters,
    };
    for (const key of Object.keys(parameters)) {
        if (env[key] !== undefined) {
            parameters[key] = env[key];
        }
    }
    return parameters;
}

function getEnvironmentVariables(templateParameters) {
    return Object.entries(templateParameters).reduce((acc, [key, value]) => {
        acc[key] = JSON.stringify(value);
        return acc;
    }, {});
}

function getParameterReplacer(templateParameters) {
    return (content, file) => {
        return content.toString().replaceAll(/(__([A-Z_]*)__)/g, (match, p1, p2) => {
            const value = templateParameters[p2];
            console.log(`[${file}] replaced ${p1} => ${value}`);
            return value;
        });
    };
}

module.exports = {
    getTemplateParameters,
    getEnvironmentVariables,
    getParameterReplacer,
};
