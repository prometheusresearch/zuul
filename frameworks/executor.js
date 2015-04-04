'use strict';

var communicate = require('./communicate');

// TODO(shtylman)
// we can do something good with this
// cause we have the mappings file
// we can actually show where in the source this is!!
// before we boot anything we should install this to get reasonable debugging
window.onerror = function(msg, file, line) {
    communicate.postMessage(window.parent, {
        type: 'error',
        msg: msg,
        file: file,
        line: line
    });
}

global.JSON = global.JSON || require('JSON2');

var load = require('load-script');
var stacktrace = require('stacktrace-js');
var ajax = require('superagent');
var render_stacktrace = require('./render-stacktrace');

try {
    var stack_mapper = require('stack-mapper');
} catch (err) {}

// shim console.log so we can report back to user
if (typeof console === 'undefined') {
  console = {};
}

var originalLog = console.log;
console.log = function (msg) {
    var args = [].slice.call(arguments);

    communicate.postMessage(window.parent, {
        type: 'console',
        args: args
    });

    if (typeof originalLog === 'function') {
        return originalLog.apply(this, arguments);
    }
    // old ghetto ass IE doesn't report typeof correctly
    // so we just have to call log
    else if (originalLog) {
      return originalLog(arguments[0]);
    }
};

var ZuulReporter = function(run_fn) {
    if (!(this instanceof ZuulReporter)) {
        return new ZuulReporter(run_fn);
    }

    var self = this;
    self.run_fn = run_fn;

    self._mapper = undefined;

    // load test bundle and trigger tests to start
    // this is a problem for auto starting tests like tape
    // we need map file first
    // load map file first then test bundle
    load('/__zuul/test-bundle.js', load_map);

    function load_map(err) {
        if (err) {
            self.done(err);
        }

        if (!stack_mapper) {
            return self.start();
        }

        var map_path = '/__zuul/test-bundle.map.json';
        ajax.get(map_path).end(function(err, res) {
            if (err) {
                // ignore map load error
                return self.start();
            }

            self._source_map = res.body;
            try {
                self._mapper = stack_mapper(res.body);
            } catch (err) {}

            self.start();
        });
    }
};

// tests are starting
ZuulReporter.prototype.start = function() {
    var self = this;
    self.run_fn();
};

// all tests done
ZuulReporter.prototype.done = function(err) {
    var self = this;

    communicate.postMessage(window.parent, {
        type: 'done'
    });
};

// new test starting
ZuulReporter.prototype.test = function(test) {
    var self = this;

    communicate.postMessage(window.parent, {
        type: 'test',
        name: test.name
    });
};

// reports on skipped tests
ZuulReporter.prototype.skippedTest = function(test){
    var self = this;

    communicate.postMessage(window.parent, {
        type: 'test',
        skipped: true,
        name: test.name
    });
};

// test ended
ZuulReporter.prototype.test_end = function(test) {
    var self = this;
    var name = test.name;

    var cov = window.__coverage__ ;

    if (cov) {
        ajax.post('/__zuul/coverage/client')
        .send(cov)
        .end(function(err, res) {
            if (err) {
                console.log('error in coverage reports');
                console.log(err);
            }
        });
    }

    communicate.postMessage(window.parent, {
        type: 'test_end',
        name: test.name,
        passed: test.passed
    });
};

// new suite starting
ZuulReporter.prototype.suite = function(suite) {
    var self = this;
};

// suite ended
ZuulReporter.prototype.suite_end = function(suite) {
    var self = this;
};

// assertion within test
ZuulReporter.prototype.assertion = function(details) {
    var self = this;
    // result (true | false)
    // actual
    // expected
    // message
    // error
    // source (stack) if available

    var passed = details.result;

    if (passed) {
        return;
    }

    // TODO actual, expected

    var message = details.message;
    var error = details.error;
    var stack = details.source;

    if (!stack && error) {
        // rethrow to try and get the stack
        // IE needs this (of course)
        try {
            throw error;
        } catch (ex) {
            error = ex;
            stack = error.stack;
        }
    }

    var frames = [];
    try {
        frames = stacktrace(error);
    } catch (err) {}

    if (self._mapper && frames.length) {
        frames = self._mapper.map(frames);
    }

    communicate.postMessage(window.parent, {
        type: 'assertion',
        actual: details.actual,
        expected: details.expected,
        message: details.message,
        source: details.source,
        stacktrace: render_stacktrace(frames, self._source_map),
        frames: frames
    });
};

module.exports = ZuulReporter;
