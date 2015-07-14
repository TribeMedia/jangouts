'use strict';

var gulp = require('gulp');
var webserver = require('gulp-webserver')

module.exports = function(options) {

  function server(paths) {
    return gulp.src(paths)
    .pipe(webserver({
      host: '0.0.0.0',
      port: process.env.JH_PORT || 3000,
      https: process.env.JH_HTTPS === 'true',
      livereload: process.env.JH_RELOAD === 'true',
      directoryListing: false,
      open: false
    }))
  }

  gulp.task('serve', ['watch'], function () {
    server([options.tmp + '/serve', options.src]);
  });

  gulp.task('serve:dist', ['build'], function() {
    server(options.dist);
  });
}
