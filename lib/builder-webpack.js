'use strict';

var EventEmitter = require('events').EventEmitter;

var commondir = require('commondir');
var Promise = require('bluebird');
var MemoryFS = require('memory-fs');

var webpack = require('webpack');

function makeDeferred() {
    var resolve;
    var reject;
    var promise = new Promise(function(_resolve, _reject) {
        resolve = _resolve;
        reject = _reject;
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

module.exports = function(files, config) {
    var deferred = makeDeferred();

    var compiler = webpack({
        context: commondir(files),
        entry: files,
        bail: true,
        devtool: 'source-map',
        output: {
            path: '/',
            filename: 'bundle.js'
        },
        node: {
            console: true,
            process: true,
            global: true,
            Buffer: true,
            util: true,
            assert: true,
            __filename: 'mock',
            __dirname: 'mock'
        }
    });
    compiler.outputFileSystem = new MemoryFS();

	compiler.plugin('compile', function(err) {
	    deferred = makeDeferred();
    });

	compiler.plugin('done', function() {
	    var src = compiler.outputFileSystem.readFileSync('/bundle.js');
	    var map = compiler.outputFileSystem.readFileSync('/bundle.js.map');
	    deferred.resolve({
	        src: src.toString(),
	        map: JSON.parse(map.toString())
	    });
    });

	compiler.plugin('failed', function(err) {
	    deferred.reject(err);
    });

	compiler.plugin('invalid', function() {
	    deferred = makeDeferred();
	    builder.emit('update');
    });

	compiler.watch(200, function(err, stats) {
    });

    var builder = Object.create(EventEmitter.prototype);
    builder.build = function(cb) {
        deferred.promise.then(
            function(result) {
                cb(null, result.src, result.map);
            },
            function(err) {
                cb(err);
            });
    };
    return builder;
};
