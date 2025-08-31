const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "main.[contenthash].js",
    path: path.resolve(__dirname, "build"),
    publicPath: "/"
  },

  devServer: {
    static: {
      directory: path.join(__dirname, "build"),
      publicPath: "/"
    },
    port: 3000,
    open: true,
    historyApiFallback: true
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "public", "index.html"),
    }),
    new CopyPlugin({
      patterns: [
        {
          context: path.resolve(__dirname, "public"),
          from: "images/*.*",
        },
        {
          context: path.resolve(__dirname),
          from: "config.json"
        },
      ],
    }),
    new webpack.DefinePlugin({
      'process.env.REACT_APP_BACKEND_URL': JSON.stringify(process.env.REACT_APP_BACKEND_URL),
    }),
  ],

  module: {
    rules: [
      {
        test: /\.(js)$/,
        exclude: /node_modules/,
        use: {
            loader: "babel-loader",
            options: {
                presets: [["@babel/preset-react", { runtime: "automatic" }], "@babel/preset-env"],
              },
        },
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'static/[hash][ext]'
        }
      },
    ],
  },

  resolve: {
    extensions: ["", ".js"],
    alias: {
      "@components": path.resolve(__dirname, "src/components"),
      "@screen": path.resolve(__dirname, "src/screen"),
      "@services": path.resolve(__dirname, "src/services"),
      "@store": path.resolve(__dirname, "src/store"),
      "@utility": path.resolve(__dirname, "src/utility"),
      "@assets": path.resolve(__dirname, "src/assets")
    },
  }
};