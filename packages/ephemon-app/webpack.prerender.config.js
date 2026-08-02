const fs = require('fs');
const path = require('path');
const { DefinePlugin } = require('webpack');
const { getTemplateParameters, getEnvironmentVariables } = require('./config');

const OUTPUT_DIR = path.resolve(__dirname, '.prerender');
const BUNDLE = path.join(OUTPUT_DIR, 'lock.js');

const ARTIFACTS = [
    ['lock.html', 'renderLockSkeleton'],
    ['theme.css', 'renderThemeCss'],
    ['theme.js', 'renderThemeBootstrap'],
];

class RenderLockSkeleton {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('RenderLockSkeleton', () => {
            delete require.cache[require.resolve(BUNDLE)];
            const rendered = require(BUNDLE);
            for (const [file, render] of ARTIFACTS) {
                fs.writeFileSync(path.join(OUTPUT_DIR, file), rendered[render](), 'utf8');
            }
            console.log(`[prerender] wrote ${ARTIFACTS.map(([file]) => file).join(', ')}`);
        });
    }
}

module.exports = (args) => {
    const env = {
        ...args,
        ...process.env,
    };
    const environmentVariables = getEnvironmentVariables(getTemplateParameters(env));

    return {
        mode: 'production',
        target: 'node',
        entry: './src/prerender.tsx',
        output: {
            path: OUTPUT_DIR,
            filename: 'lock.js',
            library: { type: 'commonjs2' },
            clean: true,
        },
        externals: {
            'react': 'commonjs react',
            'react-dom/server': 'commonjs react-dom/server',
        },
        optimization: {
            minimize: false,
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js'],
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    include: [path.resolve(__dirname, 'src')],
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                    },
                },
            ],
        },
        plugins: [
            new DefinePlugin({
                ...Object.fromEntries(
                    Object.entries(environmentVariables).map(([key, value]) => [`process.env.${key}`, value]),
                ),
            }),
            new RenderLockSkeleton(),
        ],
    };
};
