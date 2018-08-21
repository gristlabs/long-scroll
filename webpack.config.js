const path = require('path');

module.exports = {
  entry: './dist/index.js',
  output: {
    filename: 'scrolly-bundle.js',
    path: path.resolve(__dirname),
  },
  mode: 'development',
};
