// Msglite client for Node.js
// Version 0.1.0
// Copyright (c) 2010 William R. Conant, WillConant.com
// Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php

(function(){
	var net = require('net');
	var Buffer = require('buffer').Buffer;
	
	// creates a new buffer containing the contents of a and b.
	// if a is null, simply returns b
	function catBuffers(a, b) {
		if (a === null) {
			return b;
		}
		else {
			var result = new Buffer(a.length + b.length);
			a.copy(result, 0);
			b.copy(result, a.length);
			return result;
		}
	}
	
	// locates the offset of the first occurrence of an array of bytes in buf
	function bufferIndex(buf, bytes) {
		for (var i = 0; i < (buf.length - (bytes.length - 1)); i++) {
			var matched = true;
			for (var j = 0; j < bytes.length; j++) {
				if (buf[i+j] !== bytes[j]) {
					matched = false;
					break;
				}
			}
			
			if (matched) {
				return i;
			}
		}
		
		return -1;
	}
	
	// clients can connect through TCP or unix domain sockets
	// send port, addr for TCP, or just a path for domain sockets
	var Client = function(port, addr) {
		this._conn = net.createConnection(port, addr);
		this._sendQueue = new Array();
		this._callbackQueue = new Array();
		this._error = null;
		this._readBuffer = null;
		this._readCommandLineTokens = null;
		this._readBodyLength = null;
		
		var self = this;
		
		this._conn.addListener('connect', function() {
			self._flushSendQueue();
		});
		
		this._conn.addListener('data', function(buf) {
			self._readBuffer = catBuffers(self._readBuffer, buf);
			
			if (self._readBodyLength === null) {
				var commandLineLength = bufferIndex(self._readBuffer, [13, 10]);
				if (commandLineLength >= 0) {
					var commandLineStr = self._readBuffer.toString('utf8', 0, commandLineLength);
					self._readBuffer = self._readBuffer.slice(commandLineLength + 2, self._readBuffer.length);
					self._readCommandLineTokens = commandLineStr.split(/[ ]+/);
					if (self._readCommandLineTokens[0] === '>') {
						self._readBodyLength = parseInt(self._readCommandLineTokens[1]);
					}
					else {
						self._handleCommand(null);
					}
				}
			}
			
			if (self._readBodyLength !== null) {
				if (self._readBuffer.length >= (self._readBodyLength + 2)) {
					var bodyBuffer = self._readBuffer.slice(0, self._readBodyLength);
					var sepBuffer = self._readBuffer.slice(self._readBodyLength, self._readBodyLength + 2);
					
					if (bufferIndex(sepBuffer, [13, 10]) !== 0) {
						this._handleError(new Error("message body from server wasn't terminated with \\r\\n"));
						return;
					}
					
					self._readBuffer = self._readBuffer.slice(self._readBodyLength + 2, self._readBuffer.length);
					
					self._handleCommand(bodyBuffer);
				}
			}
		});
		
		this._conn.addListener('error', function(err) {
			self._handleError(err);
		});
	}
	
	Client.prototype._flushSendQueue = function() {
		if (this._conn.readyState !== 'open' && this._conn.readyState !== 'writeOnly') {
			return;
		}
		
		while (this._sendQueue.length > 0) {
			this._conn.write(this._sendQueue.shift());
		}
	}
	
	Client.prototype._sendCommand = function(body, tokens) {
		var sendStr = tokens.join(' ') + "\r\n";
		
		var firstLineLength = Buffer.byteLength(sendStr, 'utf8');
		var bodyLength = 0;
		
		if (body !== null && body.length > 0) {
			bodyLength = body.length + 2;
		}
		
		var sendBuf = new Buffer(firstLineLength + bodyLength);
		sendBuf.write(sendStr, 'utf8', 0);
		
		if (bodyLength > 0) {
			body.copy(sendBuf, firstLineLength)
			sendBuf.write("\r\n", 'ascii', sendBuf.length - 2);
		}
		
		this._sendQueue.push(sendBuf);
		this._flushSendQueue();
	}
	
	Client.prototype._handleCommand = function(body) {
		var callback = this._callbackQueue.shift();
		if (this._readCommandLineTokens[0] === '>') {
			callback(null, {
				body: body,
				timeout: parseInt(this._readCommandLineTokens[2]),
				toAddress: this._readCommandLineTokens[3],
				replyAddress: this._readCommandLineTokens[4]
			});
		}
		else if (this._readCommandLineTokens[0] === '*') {
			callback(null, null);
		}
		else if (this._readCommandLineTokens[0] === '-') {
			callback(new Error(this._readCommandLineTokens.join(' ')));
		}
		else {
			this._callbackQueue.unshift(callback);
			this._handleError(new Error("unexpected command from server"));
			return;
		}
		
		this._readCommandLineTokens = null;
		this._readBodyLength = null;
	}
	
	Client.prototype._handleError = function(err) {
		this._error = err;
		this._conn.end();
		while (this._callbackQueue.length > 0) {
			this._callbackQueue.shift()(err);
		}
	}
	
	// send a msglite message, body must be a Buffer
	Client.prototype.send = function(body, timeout, toAddress, replyAddress) {
		var bodyLength = 0;
		if (body !== null) {
			bodyLength = body.length;
		}
		
		var tokens = ['>', bodyLength, timeout, toAddress];
		if (replyAddress !== undefined) {
			tokens.push(replyAddress);
		}
		
		this._sendCommand(body, tokens);
	}
	
	// receive the next message on any address in the onAddresses array
	// callback(err, msg)
	// err and msg will both be null on timeout
	Client.prototype.ready = function(timeout, onAddresses, callback) {
		if (this._error !== null) {
			callback(this._error);
			return;
		}
	
		var tokens = ['<', timeout];
		for (var i = 0; i < onAddresses.length; i++) {
			tokens.push(onAddresses[i]);
		}
		
		this._callbackQueue.push(callback);
		this._sendCommand(null, tokens);
	}
	
	// send a message and await reply
	// callback(err, msg)
	// err and msg will both be null on timeout
	Client.prototype.query = function(body, timeout, toAddress, callback) {
		if (this._error !== null) {
			callback(this._error);
			return;
		}
	
		var bodyLength = 0;
		if (body !== null) {
			bodyLength = body.length;
		}
		
		this._callbackQueue.push(callback);
		this._sendCommand(body, ['?', bodyLength, timeout, toAddress]);
	}
	
	// disconnect from msglite server
	Client.prototype.quit = function() {
		this._sendCommand(null, ['.']);
		this._conn.end()
	}
	
	exports.Client = Client;
})();
