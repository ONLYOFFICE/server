const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const dotenv = require('dotenv');

module.exports = (env, argv) => {
  const mode = argv && argv.mode ? argv.mode : 'development';

  // Load environment variables from .env files
  // Priority: .env.local > .env.development/.env.production > .env
  const envFiles = ['.env.local', mode === 'production' ? '.env.production' : '.env.development', '.env'];

  envFiles.forEach(file => {
    dotenv.config({path: file});
  });

  return {
    entry: './src/index.js',
    output: {
      filename: 'main.[contenthash].js',
      path: path.resolve(__dirname, 'build'),
      // Use relative URLs so assets load under any prefix (e.g., /admin)
      publicPath: '',
      // Clean the output directory before emit to avoid stale files (e.g., js/js duplicates)
      clean: true
    },

    devServer: {
      static: {
        directory: path.join(__dirname, 'build'),
        publicPath: ''
      },
      port: 3000,
      open: true,
      historyApiFallback: true,
      proxy: {
        '/healthcheck-api': {
          target: process.env.REACT_APP_DOCSERVICE_URL,
          changeOrigin: true,
          pathRewrite: {
            '^/healthcheck-api': '/healthcheck'
          }
        }
      }
    },

    plugins: [
      new HtmlWebpackPlugin({
        template: path.join(__dirname, 'public', 'index.html')
      }),
      new CopyPlugin({
        patterns: [
          {
            context: path.resolve(__dirname, 'public'),
            from: 'images/*.*',
            to: 'images/[name][ext]'
          },
          {
            context: path.resolve(__dirname, 'src/assets'),
            from: '*.svg',
            to: 'static/[name][ext]'
          },
          {
            context: path.resolve(__dirname, 'src', 'pages', 'AiIntegration', 'css'),
            from: '**/*',
            to: 'css'
          },
          {
            context: path.resolve(__dirname, 'src', 'pages', 'AiIntegration', 'js'),
            from: '**/*',
            to: 'js'
          },
          {
            context: path.resolve(__dirname, 'src', 'pages', 'AiIntegration', 'ai'),
            from: '**/*',
            to: 'ai'
          },
          {
            context: path.resolve(__dirname, '../../../document-templates/sample'),
            from: 'sample.docx',
            to: 'assets/sample.docx',
            noErrorOnMissing: true
          }
        ]
      }),
      new webpack.DefinePlugin({
        'process.env.REACT_APP_BACKEND_URL': JSON.stringify(process.env.REACT_APP_BACKEND_URL),
        'process.env.REACT_APP_DOCSERVICE_URL': JSON.stringify(process.env.REACT_APP_DOCSERVICE_URL)
      })
    ],

    module: {
      rules: [
        {
          test: /\.(js)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [['@babel/preset-react', {runtime: 'automatic'}], '@babel/preset-env']
            }
          }
        },
        {
          test: /\.module\.(css|scss)$/i,
          use: [
            'style-loader',
            {
              loader: 'css-loader',
              options: {
                modules: {
                  localIdentName: '[local]-[hash:base64:5]'
                }
              }
            },
            {
              loader: 'sass-loader',
              options: {
                api: 'modern'
              }
            }
          ]
        },
        {
          test: /\.(css|scss)$/i,
          exclude: /\.module\.(css|scss)$/i,
          use: [
            'style-loader',
            'css-loader',
            {
              loader: 'sass-loader',
              options: {
                api: 'modern'
              }
            }
          ]
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'static/[hash][ext]'
          }
        }
      ]
    },

    resolve: {
      extensions: ['', '.js'],
      alias: {
        '@components': path.resolve(__dirname, 'src/components'),
        '@screen': path.resolve(__dirname, 'src/screen'),
        '@services': path.resolve(__dirname, 'src/services'),
        '@store': path.resolve(__dirname, 'src/store'),
        '@utility': path.resolve(__dirname, 'src/utility'),
        '@assets': path.resolve(__dirname, 'src/assets')
      }
    }
  };
};
