'use strict';

// TODO(shtylman)
// we can do something good with this
// cause we have the mappings file
// we can actually show where in the source this is!!
// before we boot anything we should install this to get reasonable debugging
window.onerror = function(msg, file, line) {
    //var item = document.createTextNode(msg + ':' + file + ':' + line);
    //document.body.appendChild(item);
}

global.JSON = global.JSON || require('JSON2');

var load = require('load-script');
var stacktrace = require('stacktrace-js');
var ajax = require('superagent');
var render_stacktrace = require('./render-stacktrace');
var communicate = require('./communicate');

try {
    var stack_mapper = require('stack-mapper');
} catch (err) {}

// post messages here to send back to clients
var zuul_msg_bus = window.zuul_msg_bus = [];

function ZuulController() {
    var self = this;
    self.stats = {
        passed: 0,
        pending: 0,
        failed: 0
    };

    var main_div = document.getElementById('zuul');

    var header = self.header = document.createElement('div');
    header.className = 'heading pending';
    /*global zuul */
    header.innerHTML = zuul.title;
    main_div.appendChild(header);

    self.status = header.appendChild(document.createElement('div'));
    self.status.className = 'status';

    self._set_status(self.stats);

    var sub = document.createElement('div');
    sub.className = 'sub-heading';
    sub.innerHTML = navigator.userAgent;
    main_div.appendChild(sub);

    // Add tab selector
    var tab_selector = document.createElement('div');
    tab_selector.id = 'tab-selector';
    var results_selector = document.createElement('a');
    results_selector.className = 'selected';
    results_selector.href = '/__zuul';
    results_selector.innerHTML = 'Test results';
    results_selector.onclick = function(e) {
      var selectors = document.querySelectorAll('#tab-selector a');
      for (var i = 0; i < selectors.length; i++) {
        selectors[i].className = ''
      }

      e.target.className = 'selected';

      document.getElementById('test-results-tab').className = 'tab';
      document.getElementById('code-coverage-tab').className = 'tab hidden';
      e.preventDefault();
    };
    tab_selector.appendChild(results_selector);
    var coverage_selector = document.createElement('a');
    coverage_selector.href = '/__zuul/coverage';
    coverage_selector.innerHTML = 'Code coverage';
    coverage_selector.onclick = function(e) {
      var selectors = document.querySelectorAll('#tab-selector a');
      for (var i = 0; i < selectors.length; i++) {
        selectors[i].className = ''
      }

      e.target.className = 'selected';

      document.getElementById('test-results-tab').className = 'tab hidden';
      document.getElementById('code-coverage-tab').className = 'tab';
      e.preventDefault();
    };
    tab_selector.appendChild(coverage_selector);
    main_div.appendChild(tab_selector);

    // Add tabs and their content containers
    var tabs = document.createElement('div');
    tabs.className = 'tabs';
    var test_results_tab = document.createElement('div');
    test_results_tab.className = 'tab';
    test_results_tab.id = 'test-results-tab';
    tabs.appendChild(test_results_tab);
    var code_coverage_tab = document.createElement('div');
    code_coverage_tab.className = 'tab hidden';
    code_coverage_tab.id = 'code-coverage-tab';
    tabs.appendChild(code_coverage_tab);
    main_div.appendChild(tabs);

    // status info
    var status = document.createElement('div');

    document.body.appendChild(main_div);
    self._current_container = test_results_tab;
};

ZuulController.prototype._set_status = function(info) {
    var self = this;
    var html = '';
    html += '<span>' + info.failed + ' <small>failing</small></span> ';
    html += '<span>' + info.passed + ' <small>passing</small></span> ';
    if(self.stats.pending){
        html += '<span>' + info.pending + ' <small>pending</small></span>';
    }

    self.status.innerHTML = html;
};

// tests are starting
ZuulController.prototype.start = function() {
    var self = this;
    var executor = document.createElement('iframe');
    executor.src = '/__zuul/executor';
    document.body.appendChild(executor);
};

// all tests done
ZuulController.prototype.on_done = function(message) {
    var self = this;

    var passed = self.stats.failed === 0 && self.stats.passed > 0;

    if (passed) {
        self.header.className += ' passed';
    }
    else {
        self.header.className += ' failed';
    }

    // add coverage tab content
    if (window.__coverage__) {
        var coverage_tab = document.getElementById('code-coverage-tab');
        coverage_tab.innerHTML = '<iframe frameborder="0" src="/__zuul/coverage"></iframe>';
    }

    post_message({
        type: 'done',
        passed: passed
    });
};

// new test starting
ZuulController.prototype.on_test = function(message) {
    var self = this;

    var container = document.createElement('div');
    container.className = 'test pending' + (message.skipped ? ' skipped' : '');

    var header = container.appendChild(document.createElement('h1'));
    header.innerHTML = message.name;

    self._current_container = self._current_container.appendChild(container);

    post_message(message);
};

// test ended
ZuulController.prototype.on_test_end = function(message) {
    var self = this;
    var name = message.name;

    var cls = message.passed ? 'passed' : 'failed';

    if (message.passed) {
        self.stats.passed++;
    }
    else {
        self.stats.failed++;
    }

    // current test element
    self._current_container.className += ' ' + cls;
    // use parentNode for legacy browsers (firefox)
    self._current_container = self._current_container.parentNode;

    self._set_status(self.stats);

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

    post_message(message);
};

// new suite starting
ZuulController.prototype.suite = function(suite) {
    var self = this;
};

// suite ended
ZuulController.prototype.on_suite_end = function(suite) {
    var self = this;
};

// assertion within test
ZuulController.prototype.on_assertion = function(message) {
    var self = this;
    if (message.message) {
        var pre = document.createElement('pre');
        pre.innerHTML = message.message;
        self._current_container.appendChild(pre);
    }
    // TODO actual, expected
    self._renderError(message.source, message.stacktrace, message.message);
    post_message(message);
};

ZuulController.prototype.on_console = function(message) {
    zuul_msg_bus.push({
        type: 'console',
        args: message.args
    });
};


ZuulController.prototype._renderError = function (source, stacktrace, message) {
    var self = this;
    var div = document.createElement('div');
    div.innerHTML = stacktrace ? stacktrace : (source || message);
    self._current_container.appendChild(div);
};

function post_message(msg) {
    zuul_msg_bus.push(msg);
}

var controller = new ZuulController();

communicate.onMessage(function(message) {
    var handler = controller['on_' + message.type];
    handler.call(controller, message);
});

controller.start();
