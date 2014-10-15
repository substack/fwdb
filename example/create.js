var db = require('level')('/tmp/edit.db');
var fdb = require('../')(db);
var minimist = require('minimist');

var argv = minimist(process.argv.slice(2));
if (argv.debug) fdb.on('batch', console.log);

fdb.create(argv, function (err) {
    if (err) throw err;
});
