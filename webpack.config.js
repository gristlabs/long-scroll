const path = require('path');

module.exports = {
  entry: './dist/cjs/index.js',
  output: {
    filename: 'scrolly-bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  mode: 'development',
};
