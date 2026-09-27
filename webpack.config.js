const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const isServe = Boolean(process.env.WEBPACK_SERVE);

module.exports = {
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'main.[contenthash:8].js',
        chunkFilename: '[id].[contenthash:8].main.js',
        assetModuleFilename: '[name][ext]',
        publicPath: 'auto',
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.(ts|js)$/,
                exclude: /node_modules/,
                use: [
                    { loader: 'babel-loader' },
                    {
                        loader: 'ts-loader',
                        options: { allowTsInNodeModules: false },
                    },
                ],
            },
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader', 'postcss-loader'],
            },
            {
                test: /\.wasm$/i,
                type: 'asset/resource',
                generator: { filename: '[name][ext]' },
            },
            {
                test: /\.woff2$/i,
                type: 'asset/resource',
                generator: { filename: '[name][ext]' },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'src/index.html',
            // Alpine relies on quoted attributes; html-minifier breaks x-bind/x-text
            minify: false,
            scriptLoading: 'defer',
        }),
        new CleanWebpackPlugin(),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/img/*.svg', to: '[name][ext]' },
                { from: 'src/img/*.txt', to: '[name][ext]' },
                { from: 'src/guia.html', to: 'guia.html' },
                { from: 'src/guia.html', to: 'guide.html' },
                { from: 'src/guia.css', to: 'guia.css' },
                { from: 'src/guia.css', to: 'guide.css' },
                { from: 'hostinger.htaccess', to: '.htaccess', toType: 'file' },
                { from: 'LICENSE', to: 'LICENSE', toType: 'file' },
                {
                    from: 'node_modules/web-demuxer/dist/wasm-files/web-demuxer.wasm',
                    to: 'web-demuxer.wasm',
                },
            ],
        }),
    ],
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.css'],
    },
    optimization: {
        minimize: !isServe,
        splitChunks: false,
        runtimeChunk: false,
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
        allowedHosts: 'all',
        hot: false,
        liveReload: true,
    },
    mode: isServe ? 'development' : 'production',
    devtool: false,
    performance: {
        hints: false,
    },
    ignoreWarnings: [
        /Critical dependency/,
    ],
};

