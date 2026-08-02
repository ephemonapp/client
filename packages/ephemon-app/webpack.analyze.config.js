const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const baseConfig = require('./webpack.config.js');

module.exports = (env) => {
    const config = baseConfig(env);

    config.plugins.push(
        new BundleAnalyzerPlugin({
            analyzerMode: 'server',
            openAnalyzer: true,
            generateStatsFile: true,
            statsFilename: 'stats.json',
        }),
    );

    return config;
};
