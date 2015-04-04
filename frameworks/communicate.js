'use strict';

var JSON = global.JSON || require('JSON2');

var POST_MESSAGE_SUPPORTED = 'postMessage' in window;
var ON_HASH_CHANGE_SUPPORTED = 'onhashchange' in window;

var HASH_POLL_INTERVAL = 50;
var HASH_PREFIX = '#zuulPostMessage=';

var postMessageViaHashChange;
var onMessageViaHashChange;

/**
 * Thin wrapper on top of `window.postMessage(...)` API.
 *
 * It uses hashchange based polyfill if postMessage isn't available.
 */
function postMessage(otherWindow, message) {
    if (POST_MESSAGE_SUPPORTED) {
        otherWindow.postMessage(JSON.stringify(message), '*');
    } else {
        if (postMessageViaHashChange === undefined) {
            postMessageViaHashChange = _createPostMessageViaHashChange(HASH_POLL_INTERVAL * 3);
        }
        postMessageViaHashChange(otherWindow, message);
    }
}

/**
 * Thin wrapper on top of `window.addEventListener('message', ...)` API.
 *
 * It uses hashchange based polyfill if postMessage isn't available.
 */
function onMessage(handler) {
    if (POST_MESSAGE_SUPPORTED) {
        window.addEventListener('message', function(e) {
            handler(JSON.parse(e.data));
        }, false);
    } else {
        if (onMessageViaHashChange === undefined) {
            onMessageViaHashChange = _createOnMessageViaHashChange(HASH_POLL_INTERVAL);
        }
        onMessageViaHashChange(handler);
    }
}

function _createPostMessageViaHashChange(flushInterval) {
    var bus = {
        window: undefined,
        messages: []
    };

    var lastFlush = new Date().getTime();

    function flushBuffer() {
        if (bus.window === undefined || bus.messages.length === 0) {
            return;
        };
        var now = new Date().getTime();
        if (now - lastFlush < flushInterval) {
            return;
        }
        lastFlush = now;
        var prevHash = bus.window.location.hash.replace(/#.*/, '');
        bus.window.location.hash = prevHash + HASH_PREFIX + encodeURIComponent(JSON.stringify(bus.messages));
        bus.messages = [];
    }

    setInterval(flushBuffer, flushInterval);

    return function postMessageViaHashChange(otherWindow, message) {
        if (bus.window !== undefined && bus.window !== otherWindow) {
            throw new Error('cannot communicate with multiple iframes at once');
        } else {
            bus.window = otherWindow;
        }
        bus.messages.push(message);
        var now = new Date().value;
        // Synchronous check if we need to flush, that could be needed if user code doesn't yield to event loop.
        flushBuffer();
    }
}

function _createOnMessageViaHashChange(pollInterval) {
    var lastHash;

    function _decodeMessagesFromHash(hash) {
        if (hash === lastHash) {
            return [];
        }
        lastHash = hash;
        hash = decodeURIComponent(hash);
        if (hash.indexOf(HASH_PREFIX) !== 0) {
            return [];
        }
        return JSON.parse(hash.replace(HASH_PREFIX, ''));
    }

    function _applyHashChangeEvents(handler) {
        var messages = _decodeMessagesFromHash(window.location.hash);
        for (var i = 0; i < messages.length; i++) {
            handler(messages[i]);
        }
        window.location.hash = '';
    }

    return function onMessageViaHashChange(handler) {
        if (ON_HASH_CHANGE_SUPPORTED) {
            // store previous onhashchange handler if any
            var prevOnHashChange;
            if (window.onhashchange) {
                prevOnHashChange = window.onhashchange;
            }
            window.onhashchange = function() {
                if (prevOnHashChange) {
                    prevOnHashChange.apply(this, arguments);
                }
                _applyHashChangeEvents(handler);
            }
        } else {
            setInterval(function() {
                _applyHashChangeEvents(handler);
            }, pollInterval);
        }
    };
}


module.exports = {onMessage: onMessage, postMessage: postMessage};
