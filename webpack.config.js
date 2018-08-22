const path = require('path');

module.exports = {
  devtool: 'source-map',
  entry: './dist/test/index.js',
  output: {
    filename: 'scrolly-bundle.js',
    path: path.resolve(__dirname),
  },
  mode: 'development',
  serve: {
    content: 'test'
  },
};
