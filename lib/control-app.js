var http = require('http');
var path = require('path');
var fs = require('fs');

var sockjs = require('sockjs');
var express = require('express');
var expstate = require('express-state');
var browserify = require('browserify');
var im = require('istanbul-middleware');
var watchify = require('watchify');
var assign = require('lodash').assign;
var humanizeDuration = require('humanize-duration');
var debug = require('debug')('zuul:control-app');

var defaultBuilder = '../lib/builder-browserify';

function serveBundle(entry, opt) {
    var bunlder = browserify(opt);
    bunlder.require(entry, { entry: true });

    var memoizedBundle;
    var memoizedErr;

    return function serveBundleHandler(req, res, next) {
        res.contentType('application/javascript');

        if (memoizedErr !== undefined) {
            return next(memoizedErr);
        }
        if (memoizedBundle !== undefined) {
            return res.send(memoizedBundle);
        }

        var start = Date.now();
        bunlder.bundle(function(err, buf) {
            if (err) {
                memoizedErr = err;
            } else {
                debug('zuul client took %s to bundle', humanizeDuration(Date.now() - start));
                memoizedBundle = buf.toString();
            }
            return serveBundleHandler(req, res, next);
        });
    };
}

module.exports = function(config) {
    var files = config.files;
    var ui = config.ui;
    var framework_dir = config.framework_dir;
    var prj_dir = config.prj_dir;

    var opt = {
        debug: true
    };

    // watchify options
    // https://github.com/substack/watchify#var-w--watchifyb-opts
    opt = assign(opt, {
        cache: {},
        packageCache: {},
        fullPaths: true
    });

    files = files.map(function(file) {
        return path.resolve(file);
    });

    var user_html = '';
    if (config.html) {
        user_html = fs.readFileSync(path.join(prj_dir, config.html), 'utf-8');
    }

    // default builder is browserify which we provide
    config.builder = config.builder || defaultBuilder;

    var builder = require(config.builder)(files, config);

    var app = express();
    var server = http.createServer(app);

    if (config.autoreload) {
        var socket_server = new sockjs.createServer();
        socket_server.installHandlers(server, {prefix: '/channel'});
        var connections = [];
        socket_server.on('connection', function(connection) {
            connections.push(connection);
            connection.on('close', function() {
                connections.splice(connections.indexOf(connection), 1);
            });
        });
        builder.on('update', function() {
            connections.forEach(function(connection) {
                connection.write(JSON.stringify({command: 'refresh'}));
            });
        });
    }

    expstate.extend(app);

    app.set('state namespace', 'zuul');
    app.expose(ui, 'ui');
    app.expose(config.name, 'title');

    app.set('views', __dirname + '/../frameworks');
    app.set('view engine', 'html');
    app.engine('html', require('hbs').__express);

    app.use(function(req, res, next) {
        res.locals.title = config.name;
        res.locals.user_scripts = config.scripts || [];
        res.locals.user_html = user_html;
        next();
    });

    app.use(app.router);

    var bundle_router = new express.Router();

    app.use(bundle_router.middleware);

    // zuul files
    app.use('/__zuul', express.static(__dirname + '/../frameworks'));
    // framework files
    app.use('/__zuul', express.static(framework_dir));

    // any user's files
    app.use(express.static(process.cwd()));

    if (config.coverage && config.local) {
        // coverage endpoint
        app.use('/__zuul/coverage', im.createHandler());
    }

    app.get('/__zuul', function(req, res) {
        res.locals.config = { port: config.support_port, autoreload: config.autoreload || false };
        res.render('index');
    });

    var map = undefined;

    bundle_router.get('/__zuul/client.js', serveBundle(path.join(framework_dir, '/client.js')));

    bundle_router.get('/__zuul/test-bundle.map.json', function(req, res, next) {
        if (!map) {
            return res.status(404).send('');
        }

        res.json(map);
    });

    bundle_router.get('/__zuul/test-bundle.js', function(req, res, next) {
        res.contentType('application/javascript');

        builder(function(err, src, srcmap) {
            if (err) {
                return next(err);
            }

            if (srcmap) {
                map = srcmap;
                map.file = '/__zuul/test-bundle.js';
                src += '//# sourceMappingURL=' + '/__zuul/test-bundle.map.json';
            }

            res.send(src);
        });
    });

    return server;
};
