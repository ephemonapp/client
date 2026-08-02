const fs = require('fs');
const path = require('path');
const { DefinePlugin } = require('webpack');
const HtmlPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const JsonMinimizerPlugin = require('json-minimizer-webpack-plugin');
const { getTemplateParameters, getParameterReplacer, getEnvironmentVariables } = require('./config');

const PRERENDER_DIR = path.resolve(__dirname, '.prerender');

const htmlMinifyOptions = {
    collapseWhitespace: true,
    keepClosingSlash: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    minifyCSS: true,
    minifyJS: true,
};

function readPrerendered(file) {
    const location = path.join(PRERENDER_DIR, file);
    if (!fs.existsSync(location)) {
        throw new Error(
            `Prerendered ${file} is missing at ${path.relative(__dirname, location)}. ` +
                'Run "npm run prerender --workspace=@ephemon/app" first.',
        );
    }
    return fs.readFileSync(location, 'utf8');
}

module.exports = (args) => {
    const env = {
        ...args,
        ...process.env,
    };
    const environment = env.environment || 'local';
    const templateParameters = getTemplateParameters(env);
    const environmentVariables = getEnvironmentVariables(templateParameters);

    const isLocal = environment === 'local';

    const lockSkeletonMarkup = readPrerendered('lock.html');
    const themeCss = readPrerendered('theme.css');
    const themeBootstrap = readPrerendered('theme.js');

    const proxyTarget = env.EPHEMON_PROXY_TARGET;

    // noinspection WebpackConfigHighlighting
    return {
        mode: isLocal ? 'development' : 'production',
        entry: {
            'app.min': './src/index.tsx',
            'core.min': {
                import: path.resolve(__dirname, '../ephemon-core/src/index.ts'),
                library: {
                    name: 'Ephemon',
                    type: 'umd',
                },
            },
            ...(isLocal ? { preview: './src/dev/preview.tsx' } : {}),
        },
        output: {
            filename: '[name].js',
            chunkFilename: '[name].js',
            path: path.resolve(__dirname, 'dist'),
            clean: true,
            publicPath: '/',
        },
        externals: {
            '@ephemon/core': 'Ephemon',
        },
        optimization: {
            splitChunks: false,
            minimizer: ['...', new CssMinimizerPlugin(), new JsonMinimizerPlugin()],
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js', '.css'],
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    include: [path.resolve(__dirname, 'src'), path.resolve(__dirname, '../ephemon-core/src')],
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                    },
                },
                {
                    test: /\.css$/,
                    exclude: /node_modules/,
                    use: [MiniCssExtractPlugin.loader, 'css-loader'],
                },
                {
                    test: /\.wasm$/,
                    type: 'asset/resource',
                    generator: {
                        filename: '[name][ext]',
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
            new HtmlPlugin({
                template: path.resolve(__dirname, './public/index.html'),
                inject: false,
                minify: isLocal ? false : htmlMinifyOptions,
                chunks: ['app.min'],
                templateParameters: {
                    ...templateParameters,
                    bundleName: 'app.min',
                    inlineStyles: !isLocal,
                    lockSkeletonMarkup,
                    themeCss,
                    themeBootstrap,
                },
            }),
            ...(isLocal
                ? [
                      new HtmlPlugin({
                          template: path.resolve(__dirname, './public/index.html'),
                          filename: 'preview.html',
                          inject: false,
                          chunks: ['preview'],
                          templateParameters: {
                              ...templateParameters,
                              bundleName: 'preview',
                              themeCss,
                              themeBootstrap,
                          },
                      }),
                  ]
                : []),
            new CopyPlugin({
                patterns: [
                    {
                        from: path.resolve(__dirname, './src/service-worker.js'),
                        to: path.resolve(__dirname, './dist/service-worker.js'),
                        transform: {
                            transformer: getParameterReplacer(templateParameters),
                        },
                    },
                    {
                        from: path.resolve(__dirname, './public/manifest.json'),
                        to: path.resolve(__dirname, './dist/manifest.json'),
                        transform: {
                            transformer: getParameterReplacer(templateParameters),
                        },
                    },
                    {
                        from: path.resolve(__dirname, './public/assets/'),
                        to: path.resolve(__dirname, './dist/assets/'),
                    },
                    {
                        from: path.resolve(__dirname, './public/docs/'),
                        to: path.resolve(__dirname, './dist/docs/'),
                    },
                ],
            }),
            new MiniCssExtractPlugin({
                filename: '[name].css',
                chunkFilename: `[name].css?_=${templateParameters.EPHEMON_BUILD_TIMESTAMP}`,
            }),
        ],
        devServer: {
            static: [{ directory: path.join(__dirname, 'dist') }],
            host: '0.0.0.0',
            port: 8081,
            allowedHosts: 'all',
            historyApiFallback: true,
            client: { overlay: false },
            ...(proxyTarget
                ? {
                      proxy: [
                          {
                              context: ['/api', '/signal'],
                              target: proxyTarget,
                              changeOrigin: true,
                              ws: true,
                              on: {
                                  proxyRes: (proxyRes) => {
                                      const cookies = proxyRes.headers['set-cookie'];
                                      if (cookies) {
                                          proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
                                              cookie.replace(/;\s*Secure/gi, ''),
                                          );
                                      }
                                  },
                              },
                          },
                      ],
                  }
                : {}),
        },
        devtool: isLocal ? 'inline-source-map' : 'source-map',
    };
};
