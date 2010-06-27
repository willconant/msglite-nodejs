var sys = require('sys');
var msglite = require('../msglite');
var Buffer = require('buffer').Buffer;

var c1 = new msglite.Client('/tmp/msglite.socket');
c1.ready(5, ['questions'], function(err, msg) {
	if (err) { throw err }
	c1.send(new Buffer("nothin!"), 5, msg.replyAddress);
	c1.quit();
});

var c2 = new msglite.Client('/tmp/msglite.socket');
c2.query(new Buffer("what?"), 5, 'questions', function(err, msg) {
	if (err) { throw err }
	sys.puts(msg.body);
	c2.quit();
});
